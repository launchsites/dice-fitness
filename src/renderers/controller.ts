import { InlineKeyboard } from "grammy";
import type { Player } from "../services/game-service.js";
import type { Assignment } from "../services/game-service.js";
import { formatAmount, formatSeconds } from "../utils/time.js";
import { exerciseForKey } from "../config/exercises.js";
import { displayName } from "../utils/text.js";

export function controllerView(target: Player | undefined, owed: Assignment[]): { text: string; keyboard: InlineKeyboard } {
  if (!target) return { text: "<b>🎲 EXERCISE DICE</b>\n\nNo target selected. Choose a player to begin.", keyboard: new InlineKeyboard().text("👤 CHOOSE PERSON", "choose") };
  const name = displayName(target.displayName);
  const plural = owed.length === 1 ? "exercise" : "exercises";
  return {
    text: `<b>🎲 EXERCISE DICE</b>\n\nTarget: <b>${name}</b>\n${name} currently owes: <b>${owed.length} ${plural}</b>`,
    keyboard: new InlineKeyboard().text(`🎲 ROLL FOR ${target.displayName.toUpperCase().slice(0, 28)}`, "roll").row()
      .text("👤 CHANGE PERSON", "choose").row().text(`✅ ${target.displayName.toUpperCase().slice(0, 22)} IS CAUGHT UP`, "caught-up").row()
      .text("↩️ UNDO LAST ROLL", "undo").row().text("📋 VIEW OWED", "view-owed"),
  };
}

export function playerPicker(players: Player[]): { text: string; keyboard: InlineKeyboard } {
  const keyboard = new InlineKeyboard();
  players.forEach((player, index) => { keyboard.text(player.displayName.slice(0, 30), `target:${player.id}`); if (index % 2 === 1) keyboard.row(); });
  keyboard.row().text("↩️ BACK", "controller");
  return { text: "<b>👤 CHOOSE PERSON</b>\n\nWho is the next exercise for?", keyboard };
}

export function owedView(target: Player, owed: Assignment[]): string {
  const lines = owed.map((assignment, index) => `${index + 1}. ${exerciseForKey(assignment.exerciseKey).name} — ${formatAmount(assignment.amount, assignment.measurement)}`);
  const reps = owed.filter((item) => item.measurement === "reps").reduce((sum, item) => sum + item.amount, 0);
  const seconds = owed.filter((item) => item.measurement === "seconds").reduce((sum, item) => sum + item.amount, 0);
  const summary = [reps ? `${reps} reps` : "", seconds ? formatSeconds(seconds) + " timed" : ""].filter(Boolean).join(" + ");
  return `<b>📋 ${displayName(target.displayName).toUpperCase()} CURRENTLY OWES</b>\n\n${lines.length ? lines.join("\n") : "✅ Nothing — caught up!"}${lines.length ? `\n\n<b>${owed.length} ${owed.length === 1 ? "exercise" : "exercises"}</b>\n${summary}` : ""}`;
}
