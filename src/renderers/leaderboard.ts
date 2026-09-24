import type { Assignment, Player } from "../services/game-service.js";
import { EXERCISES, exerciseForKey } from "../config/exercises.js";
import { formatSeconds } from "../utils/time.js";
import { displayName } from "../utils/text.js";

export function leaderboardView(players: Player[], completed: Assignment[], outstanding: Map<number, number>): string {
  const sections = players.map((player) => {
    const mine = completed.filter((assignment) => assignment.targetPlayerId === player.id);
    const lines = EXERCISES.flatMap((exercise) => {
      const entries = mine.filter((assignment) => assignment.exerciseKey === exercise.key);
      const reps = entries.filter((entry) => entry.measurement === "reps").reduce((total, entry) => total + entry.amount, 0);
      const seconds = entries.filter((entry) => entry.measurement === "seconds").reduce((total, entry) => total + entry.amount, 0);
      if (!reps && !seconds) return [];
      return `${exerciseForKey(exercise.key).name} — ${[reps ? `${reps.toLocaleString("en-GB")} reps` : "", seconds ? formatSeconds(seconds) : ""].filter(Boolean).join(" · ")}`;
    });
    return `<b>${displayName(player.displayName).toUpperCase()}</b>\n${lines.length ? lines.join("\n") : "No completed exercises yet."}\n\n✅ ${mine.length} completed · 📋 ${outstanding.get(player.id) ?? 0} owed`;
  });
  return `<b>🏆 ALL-TIME</b>\n\n${sections.join("\n\n") || "No registered players yet."}`;
}
