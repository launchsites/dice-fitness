export type HistoryRange = { mode: "all" | "today" | "yesterday" | "custom"; from: string; to: string; withTimes: boolean; fromTime: string; toTime: string };
export const emptyRange = (): HistoryRange => ({ mode: "all", from: "", to: "", withTimes: false, fromTime: "00:00", toTime: "23:59" });
export function dayInZone(value: string | Date, zone: string) {
  const parts = new Intl.DateTimeFormat("en-GB", { timeZone: zone, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(new Date(value));
  const get = (kind: string) => parts.find((part) => part.type === kind)!.value;
  return `${get("year")}-${get("month")}-${get("day")}`;
}
export function relativeDay(zone: string, days = 0, now = new Date()) {
  const date = new Date(`${dayInZone(now, zone)}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}
export function historyQuery(playerId: number, range: HistoryRange, zone: string, cursor?: string | null) {
  const params = new URLSearchParams();
  if (playerId) params.set("playerId", String(playerId));
  if (range.mode !== "all") {
    const day = relativeDay(zone, range.mode === "yesterday" ? -1 : 0);
    const from = range.mode === "custom" ? range.from : day;
    const to = range.mode === "custom" ? range.to : day;
    if (from) params.set("from", from + (range.mode === "custom" && range.withTimes ? `T${range.fromTime}` : ""));
    if (to) params.set("to", to + (range.mode === "custom" && range.withTimes ? `T${range.toTime}` : ""));
  }
  if (cursor) params.set("cursor", cursor);
  return params;
}
export const shortDay = (day: string) => new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" }).format(new Date(`${day}T12:00:00Z`));
export function rangeLabel(range: HistoryRange) {
  if (range.mode === "all") return "All dates";
  if (range.mode === "today") return "Today";
  if (range.mode === "yesterday") return "Yesterday";
  return range.from && range.from === range.to ? shortDay(range.from) : "Date range";
}
