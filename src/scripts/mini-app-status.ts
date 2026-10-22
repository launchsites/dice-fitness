import { Bot } from "grammy";
import { count, eq, isNull, and } from "drizzle-orm";
import { env } from "../config/env.js";
import { db, closeDatabase } from "../db/client.js";
import { appRolls, assignments, groupPlayers } from "../db/schema.js";

try {
  const bot = new Bot(env.botToken);
  const [me, playerRows, assignmentRows, pendingRows] = await Promise.all([
    bot.api.getMe(),
    db.select({ count: count() }).from(groupPlayers).where(eq(groupPlayers.groupId, env.gameChatId)),
    db.select({ count: count() }).from(assignments).where(eq(assignments.groupId, env.gameChatId)),
    db.select({ count: count() }).from(appRolls).where(and(eq(appRolls.groupId, env.gameChatId), isNull(appRolls.assignmentId))),
  ]);
  console.log(JSON.stringify({ username: me.username, hasMainWebApp: "has_main_web_app" in me ? me.has_main_web_app : false, miniAppEnabled: env.miniAppEnabled, players: playerRows[0]?.count, assignments: assignmentRows[0]?.count, pendingRolls: pendingRows[0]?.count }));
} finally { await closeDatabase(); }
