import { Bot, Context, InlineKeyboard } from "grammy";
import { env } from "../config/env.js";
import { EXERCISES, optionForDice } from "../config/exercises.js";
import { logger } from "../logger.js";
import { addPlayer, completeOutstanding, createAssignment, deactivatePlayer, ensureGroup, getPlayer, getSelectedTarget, listPlayers, outstandingAssignments, setSelectedTarget, undoLastByOperator } from "../services/game-service.js";
import { refreshDailyBoard, refreshLeaderboard } from "../services/projection-service.js";
import { controllerView, owedView, playerPicker } from "../renderers/controller.js";
import { withUserLock } from "../utils/lock.js";
import { displayName } from "../utils/text.js";

const html = { parse_mode: "HTML" as const, link_preview_options: { is_disabled: true } };
const wait = (milliseconds: number) => new Promise<void>((resolve) => setTimeout(resolve, milliseconds));
const controllerShortcutKeyboard = {
  keyboard: [[{ text: "/controller" }]],
  resize_keyboard: true,
  is_persistent: true,
  input_field_placeholder: "Dice Fitness controls",
};

function isGameGroup(ctx: Context): boolean { return ctx.chat?.id === env.gameChatId; }
function isGroupController(ctx: Context): boolean { return isGameGroup(ctx) && ctx.chat?.type !== "private"; }
async function isAdmin(ctx: Context): Promise<boolean> {
  if (!ctx.from || !isGameGroup(ctx)) return false;
  const member = await ctx.api.getChatMember(env.gameChatId, ctx.from.id);
  return member.status === "administrator" || member.status === "creator";
}
async function requirePlayer(ctx: Context) {
  if (!ctx.from || (ctx.chat?.type !== "private" && !isGameGroup(ctx))) return undefined;
  return getPlayer(env.gameChatId, ctx.from.id);
}

async function replaceControllerMessage(ctx: Context, text: string, keyboard: InlineKeyboard): Promise<void> {
  if (isGroupController(ctx) && ctx.from && ctx.callbackQuery) {
    const ephemeralMessageId = ctx.callbackQuery.message?.ephemeral_message_id;
    // A callback from the public leaderboard creates the first private panel.
    // Later callbacks originate inside that panel and must edit it directly.
    if (ephemeralMessageId !== undefined) {
      await ctx.api.editEphemeralMessageText(env.gameChatId, ctx.from.id, ephemeralMessageId, text, {
        parse_mode: "HTML",
        reply_markup: keyboard,
      });
      return;
    }
    await ctx.api.sendMessage(env.gameChatId, text, {
      parse_mode: "HTML",
      reply_markup: keyboard,
      ephemeral_message_parameters: {
        receiver_user_id: ctx.from.id,
        callback_query_id: ctx.callbackQuery.id,
        replace_callback_query_message: true,
      },
    });
    return;
  }
  await ctx.editMessageText(text, { parse_mode: "HTML", reply_markup: keyboard })
    .catch((error) => logger.debug({ err: error }, "Controller edit skipped"));
}

async function selectedTarget(operatorId: number) {
  let target = await getSelectedTarget(env.gameChatId, operatorId);
  if (target) return target;
  const candidates = await listPlayers(env.gameChatId);
  const first = candidates.find((candidate) => candidate.id !== operatorId) ?? candidates[0];
  if (!first) return undefined;
  await setSelectedTarget(env.gameChatId, operatorId, first.id);
  target = first;
  return target;
}
async function updateController(ctx: Context, operatorId: number): Promise<void> {
  const target = await selectedTarget(operatorId);
  const owed = target ? await outstandingAssignments(env.gameChatId, target.id) : [];
  const view = controllerView(target, owed);
  await replaceControllerMessage(ctx, view.text, view.keyboard);
}

async function sendControllerForEphemeralCommand(ctx: Context, operatorId: number): Promise<void> {
  if (!ctx.from || !isGameGroup(ctx)) return;
  const ephemeralMessageId = ctx.message?.ephemeral_message_id;
  if (ephemeralMessageId === undefined) {
    await ctx.reply("Open this from Telegram's bot command menu to keep it private.");
    return;
  }
  const target = await selectedTarget(operatorId);
  const owed = target ? await outstandingAssignments(env.gameChatId, target.id) : [];
  const view = controllerView(target, owed);
  await ctx.api.sendMessage(env.gameChatId, view.text, {
    parse_mode: "HTML",
    reply_markup: view.keyboard,
    ephemeral_message_parameters: { receiver_user_id: ctx.from.id },
    reply_parameters: { ephemeral_message_id: ephemeralMessageId },
  });
}

export function createBot(): Bot {
  const bot = new Bot(env.botToken);
  bot.catch((error) => logger.error({ err: error.error, updateId: error.ctx.update.update_id }, "Telegram update failed"));

  bot.command("start", async (ctx) => {
    if (ctx.chat?.type !== "private") {
      if (isGameGroup(ctx)) { await refreshLeaderboard(ctx.api); return; }
      logger.info({ chatId: ctx.chat?.id, chatType: ctx.chat?.type }, "Received /start in unconfigured chat");
      return;
    }
    const player = await requirePlayer(ctx);
    if (!player) { await ctx.reply("This controller is for registered game players. Ask a group admin to add you first."); return; }
    const target = await selectedTarget(player.id);
    const view = controllerView(target, target ? await outstandingAssignments(env.gameChatId, target.id) : []);
    await ctx.reply(view.text, { parse_mode: "HTML", reply_markup: view.keyboard });
  });

  bot.command("controller", async (ctx) => {
    if (!isGameGroup(ctx) || !ctx.from || ctx.from.is_bot) return;
    let player = await requirePlayer(ctx);
    const joined = !player;
    if (!player) player = await addPlayer(env.gameChatId, ctx.from);
    await sendControllerForEphemeralCommand(ctx, player.id);
    if (joined) await refreshLeaderboard(ctx.api);
  });

  bot.command("addplayer", async (ctx) => {
    if (!isGameGroup(ctx)) return;
    if (!await isAdmin(ctx)) { await ctx.reply("Only group administrators can add players."); return; }
    const user = ctx.message?.reply_to_message?.from;
    if (!user || user.is_bot) { await ctx.reply("Reply to a person's message with /addplayer."); return; }
    const player = await addPlayer(env.gameChatId, user);
    await ctx.reply(`✅ ${displayName(player.displayName)} is now an active player. They can use the private <code>/controller</code> command from Telegram's bot menu.`, html);
    await refreshLeaderboard(ctx.api, true);
  });

  bot.command("removeplayer", async (ctx) => {
    if (!isGameGroup(ctx)) return;
    if (!await isAdmin(ctx)) { await ctx.reply("Only group administrators can remove players."); return; }
    const user = ctx.message?.reply_to_message?.from;
    if (!user) { await ctx.reply("Reply to a player's message with /removeplayer."); return; }
    const removed = await deactivatePlayer(env.gameChatId, user.id);
    await ctx.reply(removed ? "✅ Player deactivated. Existing history remains intact." : "That person is not an active player.");
    await refreshLeaderboard(ctx.api);
  });

  bot.command("players", async (ctx) => {
    if (!isGameGroup(ctx)) return;
    const players = await listPlayers(env.gameChatId);
    await ctx.reply(players.length ? `<b>👥 PLAYERS</b>\n\n${players.map((player, index) => `${index + 1}. ${displayName(player.displayName)}${player.username ? ` (@${player.username})` : ""}`).join("\n")}` : "No active players yet.", html);
  });

  bot.command(["refresh", "leaderboard", "today"], async (ctx) => {
    if (!isGameGroup(ctx)) return;
    if (ctx.match === "refresh" && !await isAdmin(ctx)) { await ctx.reply("Only group administrators can refresh projections."); return; }
    if (ctx.match !== "today") await refreshLeaderboard(ctx.api);
    if (ctx.match !== "leaderboard") await refreshDailyBoard(ctx.api);
    await ctx.reply("✅ Messages refreshed from the database.");
  });

  bot.on("callback_query:data", async (ctx) => {
    const data = ctx.callbackQuery.data;
    let operator = await requirePlayer(ctx);
    if (!operator && data === "open-controller" && isGroupController(ctx) && ctx.from && !ctx.from.is_bot) {
      operator = await addPlayer(env.gameChatId, ctx.from);
      await ctx.answerCallbackQuery({ text: "You joined the game ✅" });
      await refreshLeaderboard(ctx.api);
      await updateController(ctx, operator.id);
      return;
    }
    if (!operator) {
      if (isGroupController(ctx)) {
        await ctx.answerCallbackQuery();
        await replaceControllerMessage(ctx, "<b>🎲 EXERCISE DICE</b>\n\nTap <b>JOIN / OPEN MY CONTROLLER</b> on the leaderboard to join the game.", new InlineKeyboard());
      } else await ctx.answerCallbackQuery({ text: "You are not an active player.", show_alert: true });
      return;
    }
    if (data === "open-controller" || data === "controller") { await ctx.answerCallbackQuery(); await updateController(ctx, operator.id); return; }
    if (data === "choose") {
      const view = playerPicker(await listPlayers(env.gameChatId));
      await ctx.answerCallbackQuery(); await replaceControllerMessage(ctx, view.text, view.keyboard); return;
    }
    if (data.startsWith("target:")) {
      const targetId = Number(data.slice(7));
      if (!Number.isSafeInteger(targetId)) { await ctx.answerCallbackQuery({ text: "Invalid selection.", show_alert: true }); return; }
      try { await setSelectedTarget(env.gameChatId, operator.id, targetId); await ctx.answerCallbackQuery(); await updateController(ctx, operator.id); }
      catch { await ctx.answerCallbackQuery({ text: "That player is no longer active.", show_alert: true }); }
      return;
    }
    const target = await getSelectedTarget(env.gameChatId, operator.id);
    if (!target) { await ctx.answerCallbackQuery({ text: "Choose an active player first.", show_alert: true }); return; }
    if (data === "view-owed") {
      const owed = await outstandingAssignments(env.gameChatId, target.id);
      await ctx.answerCallbackQuery(); await replaceControllerMessage(ctx, owedView(target, owed), new InlineKeyboard().text("↩️ BACK", "controller")); return;
    }
    if (data === "caught-up") {
      const count = await completeOutstanding(env.gameChatId, target.id);
      await ctx.answerCallbackQuery({ text: count ? `${target.displayName} caught up ✅` : `${target.displayName} is already caught up ✅` });
      if (count) { await refreshDailyBoard(ctx.api); await refreshLeaderboard(ctx.api); }
      await updateController(ctx, operator.id); return;
    }
    if (data === "undo") {
      const undone = await undoLastByOperator(env.gameChatId, operator.id);
      await ctx.answerCallbackQuery({ text: undone ? "Last roll undone." : "You have no active rolls to undo." });
      if (undone) { await refreshDailyBoard(ctx.api, undone.gameDate); await refreshLeaderboard(ctx.api); }
      await updateController(ctx, operator.id); return;
    }
    if (data !== "roll") { await ctx.answerCallbackQuery({ text: "That button has expired.", show_alert: true }); return; }
    const result = await withUserLock(operator.telegramUserId, async () => {
      const currentTarget = await getSelectedTarget(env.gameChatId, operator.id);
      if (!currentTarget) { await ctx.answerCallbackQuery({ text: "Choose an active player first.", show_alert: true }); return; }
      await ctx.answerCallbackQuery({ text: "Rolling…" });
      const exercise = EXERCISES[Math.floor(Math.random() * EXERCISES.length)]!;
      const resultMessage = await ctx.api.sendMessage(env.gameChatId, `<b>🎲 ${displayName(currentTarget.displayName).toUpperCase()}</b>\n\n<b>${exercise.name.toUpperCase()}</b>\n\nRolling amount...`, html);
      const dice = await ctx.api.sendDice(env.gameChatId, "🎲");
      await wait(5_000);
      const option = optionForDice(exercise, dice.dice.value);
      await ctx.api.editMessageText(env.gameChatId, resultMessage.message_id, `<b>🎲 ${displayName(currentTarget.displayName).toUpperCase()}</b>\n\n<b>${exercise.name.toUpperCase()} — ${option.measurement === "reps" ? `${option.amount} REPS` : `${option.amount} SECONDS`}</b>`, html)
        .catch((error) => logger.warn({ err: error }, "Could not reveal roll result; assignment will still be stored"));
      // The dice and result are only a reveal animation; the daily board is the
      // persistent record that remains in the chat.
      await ctx.api.deleteMessage(env.gameChatId, dice.message_id)
        .catch((error) => logger.warn({ err: error }, "Could not remove roll animation"));
      await createAssignment({ groupId: env.gameChatId, targetPlayerId: currentTarget.id, operatorPlayerId: operator.id, exerciseKey: exercise.key, measurement: option.measurement, amount: option.amount, diceResult: dice.dice.value });
      await refreshDailyBoard(ctx.api); await refreshLeaderboard(ctx.api);
      await wait(2_000);
      await ctx.api.deleteMessage(env.gameChatId, resultMessage.message_id)
        .catch((error) => logger.warn({ err: error }, "Could not remove roll result"));
      await updateController(ctx, operator.id);
      logger.info({ operator: operator.telegramUserId, target: currentTarget.telegramUserId, exercise: exercise.key, dice: dice.dice.value }, "Exercise assigned");
    });
    if (result === undefined) await ctx.answerCallbackQuery({ text: "A roll is already in progress.", show_alert: false }).catch(() => undefined);
  });
  return bot;
}

export async function initialiseGame(bot: Bot): Promise<void> {
  await ensureGroup(env.gameChatId);
  try {
    await bot.api.setMyCommands([
      { command: "controller", description: "Open my private game controller", is_ephemeral: true },
    ], { scope: { type: "chat", chat_id: env.gameChatId } });
  } catch (error) {
    logger.error({ err: error, chatId: env.gameChatId }, "Could not configure private controller command");
  }
  try {
    // Reply keyboards are Telegram's persistent controls above the input field.
    // The setup message can disappear immediately; the keyboard remains available.
    const shortcut = await bot.api.sendMessage(env.gameChatId, "🎲 Dice Fitness controls ready.", {
      disable_notification: true,
      reply_markup: controllerShortcutKeyboard,
    });
    await bot.api.deleteMessage(env.gameChatId, shortcut.message_id);
  } catch (error) {
    logger.error({ err: error, chatId: env.gameChatId }, "Could not configure bottom controller shortcut");
  }
  try {
    await refreshLeaderboard(bot.api, true);
  } catch (error) {
    // Keep long polling available to recover once the bot is added to the configured group.
    logger.error({ err: error, chatId: env.gameChatId }, "Could not initialise group projections");
  }
}
