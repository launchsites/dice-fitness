import type { Assignment } from "../services/game-service.js";
import { exerciseForKey } from "../config/exercises.js";
import { formatAmount, gameDateTitle } from "../utils/time.js";
import { displayName } from "../utils/text.js";

export function dailyBoardView(date: string, rows: (Assignment & { targetName: string })[]): string {
  const grouped = new Map<number, { name: string; items: (Assignment & { targetName: string })[] }>();
  for (const row of rows) {
    const existing = grouped.get(row.targetPlayerId);
    if (existing) existing.items.push(row);
    else grouped.set(row.targetPlayerId, { name: row.targetName, items: [row] });
  }
  const blocks = [...grouped.values()].map(({ name, items }) => `<b>${displayName(name).toUpperCase()}</b>\n${items.map((row, index) => `${row.completedAt ? "✅" : "⬜"} ${index + 1}. ${exerciseForKey(row.exerciseKey).name} — ${formatAmount(row.amount, row.measurement)}`).join("\n")}`);
  return `<b>📅 ${gameDateTitle(date)}</b>\n\n${blocks.join("\n\n") || "No exercises assigned."}`;
}
