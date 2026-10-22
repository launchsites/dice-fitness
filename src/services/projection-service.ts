import { InlineKeyboard, type Api } from "grammy";
import { env } from "../config/env.js";
import { gameDate } from "../utils/time.js";
import { logger } from "../logger.js";
import { assignmentsForDay, completedAssignments, dailyBoardMessage, leaderboardMessage, listPlayers, outstandingAssignments, reserveDailyBoard, reserveLeaderboard, setDailyBoardMessage, setLeaderboardMessage } from "./game-service.js";
import { dailyBoardView } from "../renderers/daily-board.js";
import { leaderboardView } from "../renderers/leaderboard.js";
import { singleFlight } from "../utils/single-flight.js";

const options = { parse_mode: "HTML" as const, link_preview_options: { is_disabled: true } };
const missingMessage = (error: unknown): boolean => String(error).includes("message to edit not found") || String(error).includes("message can't be edited");
const unchangedMessage = (error: unknown): boolean => String(error).includes("message is not modified");

export const miniAppLink = () => `https://t.me/${env.botUsername}?startapp=rolls`;

export async function refreshDailyBoard(api: Api, date = gameDate()): Promise<void> {
  if (env.miniAppEnabled) return;
  await singleFlight(`daily:${env.gameChatId}:${date}`, async () => {
    const rows = await assignmentsForDay(env.gameChatId, date);
    if (!rows.length) return;
    await reserveDailyBoard(env.gameChatId, date);
    const board = await dailyBoardMessage(env.gameChatId, date);
    const text = dailyBoardView(date, rows);
    try {
      if (board?.telegramMessageId) await api.editMessageText(env.gameChatId, board.telegramMessageId, text, options);
      else { const sent = await api.sendMessage(env.gameChatId, text, options); await setDailyBoardMessage(env.gameChatId, date, sent.message_id); }
    } catch (error) {
      if (unchangedMessage(error)) return;
      if (!missingMessage(error)) throw error;
      logger.warn({ err: error, date }, "Daily board missing; recreating");
      const sent = await api.sendMessage(env.gameChatId, text, options); await setDailyBoardMessage(env.gameChatId, date, sent.message_id);
    }
  });
}

export async function refreshLeaderboard(api: Api, pinNew = false): Promise<void> {
  await singleFlight(`leaderboard:${env.gameChatId}`, async () => {
    const groupId = env.gameChatId;
    await reserveLeaderboard(groupId);
    const players = await listPlayers(groupId, false);
    const completed = await completedAssignments(groupId);
    const outstanding = new Map<number, number>();
    for (const player of players) outstanding.set(player.id, (await outstandingAssignments(groupId, player.id)).length);
    const text = leaderboardView(players, completed, outstanding);
    const messageId = await leaderboardMessage(groupId);
    const messageOptions = { ...options, ...(env.miniAppEnabled ? { reply_markup: new InlineKeyboard().url("🎲 Open dice rolls", miniAppLink()) } : {}) };
    try {
      if (messageId) await api.editMessageText(groupId, messageId, text, messageOptions);
      else {
        const sent = await api.sendMessage(groupId, text, messageOptions); await setLeaderboardMessage(groupId, sent.message_id);
        if (pinNew) await api.pinChatMessage(groupId, sent.message_id, { disable_notification: true }).catch((error) => logger.info({ err: error }, "Could not pin leaderboard"));
      }
    } catch (error) {
      if (unchangedMessage(error)) return;
      if (!missingMessage(error)) throw error;
      const sent = await api.sendMessage(groupId, text, messageOptions); await setLeaderboardMessage(groupId, sent.message_id);
    }
  });
}
