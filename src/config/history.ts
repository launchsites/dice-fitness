import { DateTime } from "luxon";

/** Local calendar filters use the game's timezone, not the server/browser timezone. */
export function historyFilters(params: URLSearchParams, zone: string) {
  const player = params.get("playerId");
  const playerId = player === null ? null : Number(player);
  if (player !== null && (!/^\d+$/.test(player) || !Number.isSafeInteger(playerId) || playerId! <= 0)) throw new Error("Choose a valid person.");
  const bound = (key: "from" | "to") => {
    const value = params.get(key);
    if (!value) return null;
    if (!/^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2})?$/.test(value)) throw new Error("Choose a valid date and time.");
    let date = DateTime.fromISO(value, { zone });
    if (!date.isValid || date.toFormat(value.includes("T") ? "yyyy-MM-dd'T'HH:mm" : "yyyy-MM-dd") !== value) throw new Error("Choose a valid date and time.");
    // The selected end day/minute is inclusive; SQL uses an exclusive bound.
    if (key === "to") date = value.includes("T") ? date.plus({ minutes: 1 }) : date.plus({ days: 1 });
    return date.toJSDate();
  };
  const from = bound("from"), until = bound("to");
  if (from && until && from >= until) throw new Error("The end must be on or after the start.");
  let cursor: { completedAt: Date; id: number } | null = null;
  const value = params.get("cursor");
  if (value !== null) {
    const match = /^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z)\|(\d+)$/.exec(value);
    if (!match || !Number.isSafeInteger(Number(match[2])) || Number(match[2]) < 1 || !DateTime.fromISO(match[1]!).isValid) throw new Error("Refresh history to continue.");
    cursor = { completedAt: new Date(match[1]!), id: Number(match[2]) };
  }
  return { playerId, from, until, cursor };
}
