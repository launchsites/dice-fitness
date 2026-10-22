import { Bot } from "grammy";
import { count, eq } from "drizzle-orm";
import { env } from "../config/env.js";
import { closeDatabase, db } from "../db/client.js";
import { assignments, botMessages, completionBatches, dailyBoards, groupPlayers, groups, operatorPreferences } from "../db/schema.js";
import { initialiseGame } from "../bot/index.js";
import { refreshDailyBoard } from "../services/projection-service.js";

function parseGroupId(value: string | undefined, label: string): number {
  const groupId = Number(value);
  if (!Number.isSafeInteger(groupId)) throw new Error(`${label} must be a numeric Telegram group ID`);
  return groupId;
}

const sourceGroupId = parseGroupId(process.argv[2], "Source group ID");
const targetGroupId = parseGroupId(process.argv[3], "Target group ID");

if (sourceGroupId === targetGroupId) throw new Error("Source and target group IDs must be different");
if (targetGroupId !== env.gameChatId) throw new Error("Target group ID must match GAME_CHAT_ID");

try {
  await db.transaction(async (tx) => {
    const [source] = await tx.select({ id: groups.id }).from(groups).where(eq(groups.id, sourceGroupId));
    const [target] = await tx.select({ id: groups.id }).from(groups).where(eq(groups.id, targetGroupId));
    if (!source) throw new Error("Source group does not exist");
    if (!target) throw new Error("Target group does not exist");

    const stateChecks = await Promise.all([
      tx.select({ total: count() }).from(assignments).where(eq(assignments.groupId, targetGroupId)),
      tx.select({ total: count() }).from(completionBatches).where(eq(completionBatches.groupId, targetGroupId)),
      tx.select({ total: count() }).from(operatorPreferences).where(eq(operatorPreferences.groupId, targetGroupId)),
    ]);
    const targetStateRows = stateChecks.flat().reduce((total, row) => total + Number(row.total), 0);
    if (targetStateRows > 0) throw new Error("Target group already has game state; refusing to merge automatically");

    const sourcePlayers = await tx.select({ playerId: groupPlayers.playerId }).from(groupPlayers).where(eq(groupPlayers.groupId, sourceGroupId));
    const targetPlayers = await tx.select({ playerId: groupPlayers.playerId }).from(groupPlayers).where(eq(groupPlayers.groupId, targetGroupId));
    const sourcePlayerIds = new Set(sourcePlayers.map((player) => player.playerId));
    if (targetPlayers.some((player) => !sourcePlayerIds.has(player.playerId))) {
      throw new Error("Target group contains a player not present in the source group; refusing to merge automatically");
    }

    // Message IDs are only valid in their original chat. Keep the target's newly-created
    // controls/leaderboard pointers, discard stale source projections, and regenerate them later.
    await tx.delete(dailyBoards).where(eq(dailyBoards.groupId, sourceGroupId));
    await tx.delete(botMessages).where(eq(botMessages.groupId, sourceGroupId));
    await tx.delete(groupPlayers).where(eq(groupPlayers.groupId, targetGroupId));
    await tx.update(assignments).set({ groupId: targetGroupId }).where(eq(assignments.groupId, sourceGroupId));
    await tx.update(completionBatches).set({ groupId: targetGroupId }).where(eq(completionBatches.groupId, sourceGroupId));
    await tx.update(operatorPreferences).set({ groupId: targetGroupId }).where(eq(operatorPreferences.groupId, sourceGroupId));
    await tx.update(groupPlayers).set({ groupId: targetGroupId }).where(eq(groupPlayers.groupId, sourceGroupId));
    await tx.delete(groups).where(eq(groups.id, sourceGroupId));
  });

  const api = new Bot(env.botToken);
  await initialiseGame(api);
  await refreshDailyBoard(api.api);
  console.log(`Migrated game state from ${sourceGroupId} to ${targetGroupId}.`);
} finally {
  await closeDatabase();
}
