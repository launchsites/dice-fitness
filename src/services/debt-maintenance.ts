import { createHash, randomInt } from "node:crypto";
import { and, asc, eq, inArray, isNull, sql } from "drizzle-orm";
import { db } from "../db/client.js";
import { appRolls, assignments, groupPlayers } from "../db/schema.js";
import { env } from "../config/env.js";
import { exerciseForKey, optionForDice } from "../config/exercises.js";
import { getPlayer } from "./game-service.js";
import { AppError } from "../web/errors.js";
import { gameDate } from "../utils/time.js";

export const REPLACEMENT_EXERCISES = ["dead-bugs", "russian-twists", "sit-ups", "crunches", "flutter-kicks"] as const;
const groupId = env.gameChatId;
const owed = (row: typeof assignments.$inferSelect, targetId: number) => row.targetPlayerId === targetId && !row.completedAt && !row.undoneAt;
const fingerprint = (rows: unknown) => createHash("sha256").update(JSON.stringify(rows)).digest("hex");

async function identities(targetTelegramId: number, operatorTelegramId: number) {
  const target = await getPlayer(groupId, targetTelegramId), operator = await getPlayer(groupId, operatorTelegramId);
  if (!target?.active || !operator?.active) throw new AppError(409, "Target and operator must be active members of the configured game group.");
  return { target, operator };
}

export async function debtSnapshot(targetTelegramId: number, operatorTelegramId: number) {
  const people = await identities(targetTelegramId, operatorTelegramId);
  const rows = await db.select().from(assignments).where(eq(assignments.groupId, groupId)).orderBy(asc(assignments.id));
  const pending = await db.select().from(appRolls).where(and(eq(appRolls.groupId, groupId), eq(appRolls.targetPlayerId, people.target.id), isNull(appRolls.assignmentId)));
  const current = rows.filter((row) => owed(row, people.target.id));
  return { groupId, ...people, owed: current, pending: pending.map((row) => ({ id: row.id, exerciseKey: row.exerciseKey })), owedIds: current.map((row) => row.id), fingerprint: fingerprint(current), preservedFingerprint: fingerprint(rows.filter((row) => !owed(row, people.target.id))), totalAssignments: rows.length };
}

export function replacementRequestIds(batchId: string) {
  return Array.from({ length: 40 }, (_, i) => {
    const bytes = createHash("sha256").update(`${batchId}:${i}`).digest().subarray(0, 16);
    bytes[6] = (bytes[6]! & 15) | 64; bytes[8] = (bytes[8]! & 63) | 128;
    const hex = bytes.toString("hex"); return `${hex.slice(0,8)}-${hex.slice(8,12)}-${hex.slice(12,16)}-${hex.slice(16,20)}-${hex.slice(20)}`;
  });
}

/** CLI-only, snapshot-guarded and retry-safe. Never available as a public app endpoint. */
export async function replaceCoreDebt(targetTelegramId: number, operatorTelegramId: number, expectedFingerprint: string, batchId: string) {
  const { target, operator } = await identities(targetTelegramId, operatorTelegramId);
  const requestIds = replacementRequestIds(batchId);
  return db.transaction(async (tx) => {
    const members = await tx.select().from(groupPlayers).where(eq(groupPlayers.groupId, groupId)).orderBy(asc(groupPlayers.playerId));
    // Block in-flight/new rolls while the exact target queue is replaced.
    for (const member of members) await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(${`dice:operator:${groupId}:${member.playerId}`}, 0))`);
    for (const member of members) await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(${`dice:target:${groupId}:${member.playerId}`}, 0))`);
    const rows = await tx.select().from(assignments).where(eq(assignments.groupId, groupId)).orderBy(asc(assignments.id)).for("update");
    const existing = await tx.select().from(assignments).where(inArray(assignments.entryRequestId, requestIds));
    if (existing.length) {
      if (existing.length !== 40 || existing.some((row) => row.groupId !== groupId || row.targetPlayerId !== target.id || row.operatorPlayerId !== operator.id || row.entryType !== "import")) throw new AppError(409, "Batch identity conflict. No records were changed.");
      return { alreadyApplied: true, target, createdIds: existing.map((row) => row.id), owedCount: rows.filter((row) => owed(row, target.id)).length };
    }
    const current = rows.filter((row) => owed(row, target.id));
    if (fingerprint(current) !== expectedFingerprint) throw new AppError(409, "Debt changed since the backup. Take a fresh snapshot before applying.");
    const pending = await tx.select().from(appRolls).where(and(eq(appRolls.groupId, groupId), eq(appRolls.targetPlayerId, target.id), isNull(appRolls.assignmentId)));
    if (pending.length) throw new AppError(409, "This player has an unfinished roll. Finish it before replacing the debt.");
    const preserved = rows.filter((row) => !owed(row, target.id));
    if (current.length) await tx.update(assignments).set({ undoneAt: new Date(), undoneByPlayerId: operator.id }).where(and(eq(assignments.groupId, groupId), eq(assignments.targetPlayerId, target.id), inArray(assignments.id, current.map((row) => row.id)), isNull(assignments.completedAt), isNull(assignments.undoneAt)));
    const choices = Array.from({ length: 40 }, (_, i) => {
      const exerciseKey = REPLACEMENT_EXERCISES[i % REPLACEMENT_EXERCISES.length]!;
      const exercise = exerciseForKey(exerciseKey), round = Math.floor(i / REPLACEMENT_EXERCISES.length);
      const option = round < exercise.options.length ? round : randomInt(exercise.options.length);
      const diceResult = exercise.options.length === 6 ? option + 1 : option * 2 + randomInt(1, 3);
      return { exerciseKey, diceResult, ...optionForDice(exerciseForKey(exerciseKey), diceResult) };
    });
    for (let i = choices.length - 1; i > 0; i--) { const j = randomInt(i + 1); [choices[i], choices[j]] = [choices[j]!, choices[i]!]; }
    const time = Date.now();
    const created = await tx.insert(assignments).values(choices.map((choice, i) => ({ ...choice, groupId, targetPlayerId: target.id, operatorPlayerId: operator.id, gameDate: gameDate(), assignedAt: new Date(time + i), entryType: "import" as const, entryRequestId: requestIds[i]! }))).returning();
    const after = await tx.select().from(assignments).where(eq(assignments.groupId, groupId)).orderBy(asc(assignments.id));
    const preservedIds = new Set(preserved.map((row) => row.id));
    const unchanged = fingerprint(after.filter((row) => preservedIds.has(row.id))) === fingerprint(preserved);
    if (!unchanged || after.filter((row) => owed(row, target.id)).length !== 40 || after.length !== rows.length + 40) throw new Error("Replacement verification failed");
    return { alreadyApplied: false, target, clearedIds: current.map((row) => row.id), createdIds: created.map((row) => row.id), owedCount: 40, preservedDataUnchanged: unchanged, byExercise: REPLACEMENT_EXERCISES.map((key) => ({ key, count: created.filter((row) => row.exerciseKey === key).length })), entries: created.map((row) => ({ id: row.id, exerciseKey: row.exerciseKey, amount: row.amount, measurement: row.measurement, diceResult: row.diceResult })) };
  });
}
