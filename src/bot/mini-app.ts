import { Bot, InlineKeyboard, type Context } from "grammy";
import { and, eq } from "drizzle-orm";
import { env } from "../config/env.js";
import { db } from "../db/client.js";
import { botMessages, dailyBoards } from "../db/schema.js";
import { logger } from "../logger.js";
import { addPlayer, completedAssignments, deactivatePlayer, ensureGroup, leaderboardMessage, listPlayers, outstandingAssignments, reserveLeaderboard, setLeaderboardMessage } from "../services/game-service.js";
import { miniAppLink, refreshLeaderboard } from "../services/projection-service.js";
import { leaderboardView } from "../renderers/leaderboard.js";

async function admin(ctx: Context) {
  if (!ctx.from || ctx.chat?.id !== env.gameChatId) return false;
  const member = await ctx.api.getChatMember(env.gameChatId, ctx.from.id);
  return member.status === "administrator" || member.status === "creator";
}

export function createMiniAppBot(): Bot {
  const bot = new Bot(env.botToken);
  bot.catch((error) => logger.error({ error: String(error.error), updateId: error.ctx.update.update_id }, "Telegram update failed"));
  bot.command(["start", "controller", "rolls"], async (ctx) => {
    if (ctx.chat.type === "private") {
      await ctx.reply("Your dice, owed list and leaderboard are all in Dice Fitness.", { reply_markup: new InlineKeyboard().webApp("🎲 Open dice rolls", env.miniAppUrl) });
    } else if (ctx.chat.id === env.gameChatId) await refreshLeaderboard(ctx.api);
  });
  bot.command(["refresh", "leaderboard", "today", "players"], async (ctx) => {
    if (ctx.chat.id === env.gameChatId) await refreshLeaderboard(ctx.api);
  });
  bot.command("addplayer", async (ctx) => {
    if (!await admin(ctx)) return;
    const user = ctx.message?.reply_to_message?.from;
    if (!user || user.is_bot) return;
    await addPlayer(env.gameChatId, user); await refreshLeaderboard(ctx.api);
  });
  bot.command("removeplayer", async (ctx) => {
    if (!await admin(ctx)) return;
    const user = ctx.message?.reply_to_message?.from;
    if (!user) return;
    await deactivatePlayer(env.gameChatId, user.id); await refreshLeaderboard(ctx.api);
  });
  bot.on("callback_query:data", async (ctx) => { await ctx.answerCallbackQuery({ text: "Use Open dice rolls on the leaderboard.", show_alert: true }); });
  return bot;
}

export async function initialiseMiniApp(bot: Bot): Promise<void> {
  if (!env.miniAppUrl || !env.miniAppUrl.startsWith("https://")) throw new Error("MINI_APP_URL must be HTTPS when the Mini App is enabled");
  await ensureGroup(env.gameChatId);
  await bot.api.setChatMenuButton({ menu_button: { type: "web_app", text: "Dice rolls", web_app: { url: env.miniAppUrl } } });
  await bot.api.setMyCommands([{ command: "rolls", description: "Open Dice Fitness" }, { command: "leaderboard", description: "Refresh the leaderboard" }], { scope: { type: "chat", chat_id: env.gameChatId } });
  const [marker] = await db.select().from(botMessages).where(and(eq(botMessages.groupId, env.gameChatId), eq(botMessages.key, "mini_app_layout_v1")));
  if (!marker?.telegramMessageId) {
    // A single replacement leaderboard also removes Telegram's old reply keyboard.
    // Store its ID before cleaning up tracked bot projections; no exercise records change.
    const oldLeaderboard = await leaderboardMessage(env.gameChatId);
    const players = await listPlayers(env.gameChatId, false);
    const owed = new Map<number, number>();
    for (const player of players) owed.set(player.id, (await outstandingAssignments(env.gameChatId, player.id)).length);
    const text = leaderboardView(players, await completedAssignments(env.gameChatId), owed);
    const keyboardRemoval = await bot.api.sendMessage(env.gameChatId, "Dice Fitness controls are now in the Mini App.", { disable_notification: true, reply_markup: { remove_keyboard: true } });
    // Telegram cannot edit a message sent with ReplyKeyboardRemove. Create the
    // durable projection with its inline keyboard present from the beginning.
    const sent = await bot.api.sendMessage(env.gameChatId, text, { parse_mode: "HTML", disable_notification: true, reply_markup: new InlineKeyboard().url("🎲 Open dice rolls", miniAppLink()) });
    await reserveLeaderboard(env.gameChatId); await setLeaderboardMessage(env.gameChatId, sent.message_id);
    await db.insert(botMessages).values({ groupId: env.gameChatId, key: "mini_app_layout_v1", telegramMessageId: sent.message_id }).onConflictDoUpdate({ target: [botMessages.groupId, botMessages.key], set: { telegramMessageId: sent.message_id } });
    await bot.api.pinChatMessage(env.gameChatId, sent.message_id, { disable_notification: true }).catch(() => {});
    const controls = await db.select().from(botMessages).where(and(eq(botMessages.groupId, env.gameChatId), eq(botMessages.key, "bottom_controls")));
    const boards = await db.select().from(dailyBoards).where(eq(dailyBoards.groupId, env.gameChatId));
    const obsoleteIds = new Set([keyboardRemoval.message_id, oldLeaderboard, ...controls.map((row) => row.telegramMessageId), ...boards.map((row) => row.telegramMessageId)]);
    for (const messageId of obsoleteIds) if (messageId && messageId !== sent.message_id) {
      await bot.api.deleteMessage(env.gameChatId, messageId).catch((error) => logger.info({ messageId, error: String(error) }, "Older bot projection could not be removed"));
    }
  }
  await refreshLeaderboard(bot.api, true);
}
