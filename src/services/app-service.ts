import { randomInt } from "node:crypto";
import { and, asc, desc, eq, inArray, isNull, sql } from "drizzle-orm";
import { db } from "../db/client.js";
import { appRolls, assignments, completionBatches, groupPlayers } from "../db/schema.js";
import { env } from "../config/env.js";
import { EXERCISES, exerciseForKey, optionForDice } from "../config/exercises.js";
import { eligibleExercises, INJURY_FILTERS, parseInjuryFilters } from "../config/injuries.js";
import { gameDate } from "../utils/time.js";
import { AppError } from "../web/errors.js";
import { completedAssignments, listPlayers, outstandingAssignments, type Player } from "./game-service.js";

const groupId = env.gameChatId;
type Transaction = Parameters<Parameters<typeof db.transaction>[0]>[0];
const operatorLock = (tx: Transaction, playerId: number) => tx.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(${`dice:operator:${groupId}:${playerId}`}, 0))`);
const targetLock = (tx: Transaction, playerId: number) => tx.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(${`dice:target:${groupId}:${playerId}`}, 0))`);

async function activeTarget(tx: Transaction, playerId: number): Promise<void> {
  const [target] = await tx.select().from(groupPlayers).where(and(eq(groupPlayers.groupId, groupId), eq(groupPlayers.playerId, playerId), eq(groupPlayers.active, true)));
  if (!target) throw new AppError(409, "That player is no longer active. Reopen the app.");
}

export async function appState(operator: Player) {
  const [players, completed, history, pending, latest] = await Promise.all([
    listPlayers(groupId, false),
    completedAssignments(groupId),
    db.select().from(assignments).where(and(eq(assignments.groupId, groupId), isNull(assignments.undoneAt))).orderBy(desc(assignments.assignedAt), desc(assignments.id)).limit(100),
    db.select().from(appRolls).where(and(eq(appRolls.groupId, groupId), eq(appRolls.operatorPlayerId, operator.id), isNull(appRolls.assignmentId))).limit(1),
    db.select().from(assignments).where(and(eq(assignments.groupId, groupId), eq(assignments.operatorPlayerId, operator.id), isNull(assignments.undoneAt))).orderBy(desc(assignments.assignedAt), desc(assignments.id)).limit(1),
  ]);
  const playerState = await Promise.all(players.map(async (player) => {
    const mine = completed.filter((item) => item.targetPlayerId === player.id);
    return {
      id: player.id, name: player.displayName, active: player.active, completed: mine.length,
      owed: await outstandingAssignments(groupId, player.id),
      totals: EXERCISES.flatMap((exercise) => {
        const entries = mine.filter((item) => item.exerciseKey === exercise.key);
        const reps = entries.filter((item) => item.measurement === "reps").reduce((total, item) => total + item.amount, 0);
        const seconds = entries.filter((item) => item.measurement === "seconds").reduce((total, item) => total + item.amount, 0);
        return reps || seconds ? [{ name: exercise.name, reps, seconds }] : [];
      }),
    };
  }));
  return { me: { id: operator.id, name: operator.displayName }, players: playerState, exercises: EXERCISES, injuries: INJURY_FILTERS, history, pending: pending[0] ?? null, lastRoll: latest[0] ?? null };
}

export async function beginRoll(operator: Player, request: { id: string; targetPlayerId: number; injuryFilters: unknown }) {
  let filters: string[];
  try { filters = parseInjuryFilters(request.injuryFilters); } catch (error) { throw new AppError(400, (error as Error).message); }
  const eligible = eligibleExercises(filters);
  if (!eligible.length) throw new AppError(400, "These filters exclude every activity. Change the filters before rolling.");
  return db.transaction(async (tx) => {
    await operatorLock(tx, operator.id);
    const [existing] = await tx.select().from(appRolls).where(eq(appRolls.id, request.id));
    if (existing) {
      if (existing.operatorPlayerId !== operator.id || existing.groupId !== groupId) throw new AppError(409, "Roll ID already used.");
      return existing;
    }
    const [pending] = await tx.select().from(appRolls).where(and(eq(appRolls.groupId, groupId), eq(appRolls.operatorPlayerId, operator.id), isNull(appRolls.assignmentId)));
    if (pending) return pending;
    await activeTarget(tx, request.targetPlayerId);
    const exercise = eligible[randomInt(eligible.length)]!;
    const [roll] = await tx.insert(appRolls).values({ id: request.id, groupId, operatorPlayerId: operator.id, targetPlayerId: request.targetPlayerId, exerciseKey: exercise.key, injuryFilters: filters }).returning();
    if (!roll) throw new Error("Roll creation failed");
    return roll;
  });
}

export async function finishRoll(operator: Player, rollId: string) {
  return db.transaction(async (tx) => {
    await operatorLock(tx, operator.id);
    const [roll] = await tx.select().from(appRolls).where(and(eq(appRolls.id, rollId), eq(appRolls.groupId, groupId), eq(appRolls.operatorPlayerId, operator.id)));
    if (!roll) throw new AppError(404, "Roll not found.");
    if (roll.assignmentId) {
      const [existing] = await tx.select().from(assignments).where(eq(assignments.id, roll.assignmentId));
      if (!existing) throw new Error("Saved roll assignment missing");
      return existing;
    }
    await targetLock(tx, roll.targetPlayerId);
    await activeTarget(tx, roll.targetPlayerId);
    const diceResult = randomInt(1, 7);
    const option = optionForDice(exerciseForKey(roll.exerciseKey), diceResult);
    const [assignment] = await tx.insert(assignments).values({ groupId, operatorPlayerId: operator.id, targetPlayerId: roll.targetPlayerId, exerciseKey: roll.exerciseKey, ...option, diceResult, gameDate: gameDate() }).returning();
    if (!assignment) throw new Error("Assignment creation failed");
    await tx.update(appRolls).set({ assignmentId: assignment.id }).where(eq(appRolls.id, roll.id));
    return assignment;
  });
}

/** Complete exactly the displayed oldest row; retries cannot tick a second exercise. */
export async function completeAppAssignments(targetId: number, expectedIds: number[], nextOnly: boolean) {
  return db.transaction(async (tx) => {
    await targetLock(tx, targetId);
    await activeTarget(tx, targetId);
    const owed = await tx.select().from(assignments).where(and(eq(assignments.groupId, groupId), eq(assignments.targetPlayerId, targetId), isNull(assignments.completedAt), isNull(assignments.undoneAt))).orderBy(asc(assignments.assignedAt), asc(assignments.id));
    const selected = owed.filter((item) => expectedIds.includes(item.id));
    if (nextOnly && selected.length && selected[0]?.id !== owed[0]?.id) throw new AppError(409, "The queue changed. Refresh and tick the top exercise.");
    if (!selected.length) return 0;
    const [batch] = await tx.insert(completionBatches).values({ groupId, targetPlayerId: targetId }).returning();
    if (!batch) throw new Error("Completion batch creation failed");
    await tx.update(assignments).set({ completedAt: new Date(), completionBatchId: batch.id }).where(inArray(assignments.id, selected.map((item) => item.id)));
    return selected.length;
  });
}

export async function undoAppAssignment(operator: Player, expectedId: number) {
  return db.transaction(async (tx) => {
    await operatorLock(tx, operator.id);
    const [expected] = await tx.select().from(assignments).where(and(eq(assignments.id, expectedId), eq(assignments.groupId, groupId), eq(assignments.operatorPlayerId, operator.id)));
    if (!expected) throw new AppError(404, "Roll not found.");
    if (expected.undoneAt) return expected;
    const [last] = await tx.select().from(assignments).where(and(eq(assignments.groupId, groupId), eq(assignments.operatorPlayerId, operator.id), isNull(assignments.undoneAt))).orderBy(desc(assignments.assignedAt), desc(assignments.id)).limit(1);
    if (last?.id !== expectedId) throw new AppError(409, "A newer roll exists. Refresh before undoing.");
    await targetLock(tx, expected.targetPlayerId);
    await tx.update(assignments).set({ undoneAt: new Date(), undoneByPlayerId: operator.id }).where(eq(assignments.id, expectedId));
    return expected;
  });
}
