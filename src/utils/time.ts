import { DateTime } from "luxon";

export const GAME_ZONE = "Europe/London";
export const gameDate = (date = new Date()): string => DateTime.fromJSDate(date, { zone: "utc" }).setZone(GAME_ZONE).toISODate()!;
export const gameDateTitle = (date: string): string => DateTime.fromISO(date, { zone: GAME_ZONE }).toFormat("cccc d LLLL").toUpperCase();
export const now = (): Date => new Date();

export function formatSeconds(total: number): string {
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const seconds = total % 60;
  if (hours) return `${hours}h ${String(minutes).padStart(2, "0")}m ${String(seconds).padStart(2, "0")}s`;
  if (minutes) return `${minutes}m ${String(seconds).padStart(2, "0")}s`;
  return `${seconds}s`;
}

export const formatAmount = (amount: number, measurement: "reps" | "seconds"): string =>
  measurement === "reps" ? `${amount} reps` : formatSeconds(amount);
