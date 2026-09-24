import { and, asc, desc, eq, inArray, isNotNull, isNull } from "drizzle-orm";
import { db } from "../db/client.js";
import { assignments, botMessages, completionBatches, dailyBoards, groupPlayers, groups, operatorPreferences, players } from "../db/schema.js";
import type { MeasurementType } from "../config/exercises.js";
import { gameDate, now } from "../utils/time.js";

export type Player = { id: number; telegramUserId: number; displayName: string; username: string | null; active: boolean };
export type Assignment = { id: number; targetPlayerId: number; operatorPlayerId: number; exerciseKey: string; measurement: MeasurementType; amount: number; diceResult: number; gameDate: string; assignedAt: Date; completedAt: Date | null; undoneAt: Date | null };

export async function ensureGroup(groupId: number): Promise<void> {
  await db.insert(groups).values({ id: groupId }).onConflictDoNothing();
}

export async function getPlayer(groupId: number, telegramUserId: number): Promise<Player | undefined> {
  const [row] = await db.select({ id: players.id, telegramUserId: players.telegramUserId, displayName: players.displayName, username: players.username, active: groupPlayers.active })
    .from(groupPlayers).innerJoin(players, eq(groupPlayers.playerId, players.id))
    .where(and(eq(groupPlayers.groupId, groupId), eq(players.telegramUserId, telegramUserId)));
  return row;
}

export async function listPlayers(groupId: number, activeOnly = true): Promise<Player[]> {
  return db.select({ id: players.id, telegramUserId: players.telegramUserId, displayName: players.displayName, username: players.username, active: groupPlayers.active })
    .from(groupPlayers).innerJoin(players, eq(groupPlayers.playerId, players.id))
    .where(activeOnly ? and(eq(groupPlayers.groupId, groupId), eq(groupPlayers.active, true)) : eq(groupPlayers.groupId, groupId))
    .orderBy(asc(players.displayName));
}

export async function addPlayer(groupId: number, user: { id: number; first_name: string; last_name?: string; username?: string }): Promise<Player> {
  await ensureGroup(groupId);
  const displayName = [user.first_name, user.last_name].filter(Boolean).join(" ");
  await db.insert(players).values({ telegramUserId: user.id, displayName, username: user.username ?? null })
    .onConflictDoUpdate({ target: players.telegramUserId, set: { displayName, username: user.username ?? null } });
  const [player] = await db.select().from(players).where(eq(players.telegramUserId, user.id));
  if (!player) throw new Error("Player upsert failed");
  await db.insert(groupPlayers).values({ groupId, playerId: player.id, active: true })
    .onConflictDoUpdate({ target: [groupPlayers.groupId, groupPlayers.playerId], set: { active: true } });
  return { id: player.id, telegramUserId: player.telegramUserId, displayName: player.displayName, username: player.username, active: true };
}

export async function deactivatePlayer(groupId: number, telegramUserId: number): Promise<boolean> {
  const player = await getPlayer(groupId, telegramUserId);
  if (!player || !player.active) return false;
  await db.update(groupPlayers).set({ active: false }).where(and(eq(groupPlayers.groupId, groupId), eq(groupPlayers.playerId, player.id)));
  return true;
}

export async function getSelectedTarget(groupId: number, operatorId: number): Promise<Player | undefined> {
  const [row] = await db.select({ id: players.id, telegramUserId: players.telegramUserId, displayName: players.displayName, username: players.username, active: groupPlayers.active })
    .from(operatorPreferences).innerJoin(players, eq(operatorPreferences.selectedTargetPlayerId, players.id))
    .innerJoin(groupPlayers, and(eq(groupPlayers.playerId, players.id), eq(groupPlayers.groupId, operatorPreferences.groupId)))
    .where(and(eq(operatorPreferences.groupId, groupId), eq(operatorPreferences.operatorPlayerId, operatorId), eq(groupPlayers.active, true)));
  return row;
}

export async function setSelectedTarget(groupId: number, operatorId: number, targetId: number): Promise<void> {
  const targets = await db.select({ id: groupPlayers.playerId }).from(groupPlayers).where(and(eq(groupPlayers.groupId, groupId), eq(groupPlayers.playerId, targetId), eq(groupPlayers.active, true)));
  if (!targets.length) throw new Error("Selected target is not active in this group");
  await db.insert(operatorPreferences).values({ groupId, operatorPlayerId: operatorId, selectedTargetPlayerId: targetId })
    .onConflictDoUpdate({ target: [operatorPreferences.groupId, operatorPreferences.operatorPlayerId], set: { selectedTargetPlayerId: targetId, updatedAt: now() } });
}

export async function createAssignment(input: { groupId: number; targetPlayerId: number; operatorPlayerId: number; exerciseKey: string; measurement: MeasurementType; amount: number; diceResult: number }): Promise<Assignment> {
  const [assignment] = await db.insert(assignments).values({ ...input, gameDate: gameDate() }).returning();
  if (!assignment) throw new Error("Assignment insert failed");
  return assignment as Assignment;
}

export async function assignmentsForDay(groupId: number, date: string): Promise<(Assignment & { targetName: string })[]> {
  const rows = await db.select({ id: assignments.id, targetPlayerId: assignments.targetPlayerId, operatorPlayerId: assignments.operatorPlayerId, exerciseKey: assignments.exerciseKey, measurement: assignments.measurement, amount: assignments.amount, diceResult: assignments.diceResult, gameDate: assignments.gameDate, assignedAt: assignments.assignedAt, completedAt: assignments.completedAt, undoneAt: assignments.undoneAt, targetName: players.displayName })
    .from(assignments).innerJoin(players, eq(assignments.targetPlayerId, players.id))
    .where(and(eq(assignments.groupId, groupId), eq(assignments.gameDate, date), isNull(assignments.undoneAt))).orderBy(asc(assignments.assignedAt), asc(assignments.id));
  return rows as (Assignment & { targetName: string })[];
}

export async function outstandingAssignments(groupId: number, targetPlayerId: number): Promise<Assignment[]> {
  const rows = await db.select().from(assignments).where(and(eq(assignments.groupId, groupId), eq(assignments.targetPlayerId, targetPlayerId), isNull(assignments.completedAt), isNull(assignments.undoneAt))).orderBy(asc(assignments.assignedAt), asc(assignments.id));
  return rows as Assignment[];
}

export async function completeOutstanding(groupId: number, targetPlayerId: number): Promise<number> {
  return db.transaction(async (tx) => {
    const owed = await tx.select({ id: assignments.id }).from(assignments).where(and(eq(assignments.groupId, groupId), eq(assignments.targetPlayerId, targetPlayerId), isNull(assignments.completedAt), isNull(assignments.undoneAt))).orderBy(asc(assignments.id));
    if (!owed.length) return 0;
    const [batch] = await tx.insert(completionBatches).values({ groupId, targetPlayerId }).returning({ id: completionBatches.id });
    if (!batch) throw new Error("Completion batch creation failed");
    await tx.update(assignments).set({ completedAt: now(), completionBatchId: batch.id }).where(inArray(assignments.id, owed.map((item) => item.id)));
    return owed.length;
  });
}

export async function undoLastByOperator(groupId: number, operatorPlayerId: number): Promise<Assignment | undefined> {
  return db.transaction(async (tx) => {
    const [last] = await tx.select().from(assignments).where(and(eq(assignments.groupId, groupId), eq(assignments.operatorPlayerId, operatorPlayerId), isNull(assignments.undoneAt))).orderBy(desc(assignments.assignedAt), desc(assignments.id)).limit(1);
    if (!last) return undefined;
    await tx.update(assignments).set({ undoneAt: now(), undoneByPlayerId: operatorPlayerId }).where(eq(assignments.id, last.id));
    return last as Assignment;
  });
}

export async function completedAssignments(groupId: number): Promise<Assignment[]> {
  const rows = await db.select().from(assignments).where(and(eq(assignments.groupId, groupId), isNull(assignments.undoneAt), isNotNull(assignments.completedAt)));
  return rows as Assignment[];
}

export async function dailyBoardMessage(groupId: number, date: string): Promise<{ id: number; telegramMessageId: number | null } | undefined> {
  const [row] = await db.select({ id: dailyBoards.id, telegramMessageId: dailyBoards.telegramMessageId }).from(dailyBoards).where(and(eq(dailyBoards.groupId, groupId), eq(dailyBoards.gameDate, date)));
  return row;
}

export async function reserveDailyBoard(groupId: number, date: string): Promise<void> {
  await db.insert(dailyBoards).values({ groupId, gameDate: date }).onConflictDoNothing();
}
export async function setDailyBoardMessage(groupId: number, date: string, telegramMessageId: number): Promise<void> {
  await db.update(dailyBoards).set({ telegramMessageId }).where(and(eq(dailyBoards.groupId, groupId), eq(dailyBoards.gameDate, date)));
}
export async function leaderboardMessage(groupId: number): Promise<number | null> {
  const [row] = await db.select({ telegramMessageId: botMessages.telegramMessageId }).from(botMessages).where(and(eq(botMessages.groupId, groupId), eq(botMessages.key, "leaderboard")));
  return row?.telegramMessageId ?? null;
}
export async function reserveLeaderboard(groupId: number): Promise<void> { await db.insert(botMessages).values({ groupId, key: "leaderboard" }).onConflictDoNothing(); }
export async function setLeaderboardMessage(groupId: number, telegramMessageId: number): Promise<void> {
  await db.update(botMessages).set({ telegramMessageId, updatedAt: now() }).where(and(eq(botMessages.groupId, groupId), eq(botMessages.key, "leaderboard")));
}
export async function bottomControlsMessage(groupId: number): Promise<number | null> {
  const [row] = await db.select({ telegramMessageId: botMessages.telegramMessageId }).from(botMessages).where(and(eq(botMessages.groupId, groupId), eq(botMessages.key, "bottom_controls")));
  return row?.telegramMessageId ?? null;
}
export async function reserveBottomControls(groupId: number): Promise<void> { await db.insert(botMessages).values({ groupId, key: "bottom_controls" }).onConflictDoNothing(); }
export async function setBottomControlsMessage(groupId: number, telegramMessageId: number): Promise<void> {
  await db.update(botMessages).set({ telegramMessageId, updatedAt: now() }).where(and(eq(botMessages.groupId, groupId), eq(botMessages.key, "bottom_controls")));
}
