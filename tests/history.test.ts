import { describe, expect, it } from "vitest";
import { historyFilters } from "../src/config/history.js";
import { emptyRange, historyQuery, relativeDay } from "../web/history.js";

const parse = (values: Record<string, string>) => historyFilters(new URLSearchParams(values), "Europe/London");
describe("completion history calendar filters", () => {
  it("uses local calendar boundaries across both clock changes", () => {
    const spring = parse({ from: "2026-03-29", to: "2026-03-29" });
    expect(spring.from!.toISOString()).toBe("2026-03-29T00:00:00.000Z");
    expect(spring.until!.toISOString()).toBe("2026-03-29T23:00:00.000Z");
    const autumn = parse({ from: "2026-10-25", to: "2026-10-25" });
    expect(autumn.from!.toISOString()).toBe("2026-10-24T23:00:00.000Z");
    expect(autumn.until!.toISOString()).toBe("2026-10-26T00:00:00.000Z");
  });
  it("includes the full selected end minute and rejects invalid or reversed ranges", () => {
    const range = parse({ from: "2026-07-01T12:30", to: "2026-07-01T12:30" });
    expect(range.from!.toISOString()).toBe("2026-07-01T11:30:00.000Z");
    expect(range.until!.toISOString()).toBe("2026-07-01T11:31:00.000Z");
    for (const values of [{ from: "2026-02-30" }, { from: "2026-03-29T01:30" }, { from: "2026-11-03", to: "2026-11-01" }, { playerId: "-1" }, { cursor: "bad" }]) expect(() => parse(values)).toThrow();
  });
  it("resolves Today/Yesterday in the game timezone even when the device day differs", () => {
    const now = new Date("2026-07-01T23:30:00Z");
    expect(relativeDay("Europe/London", 0, now)).toBe("2026-07-02");
    expect(relativeDay("Europe/London", -1, now)).toBe("2026-07-01");
    const query = historyQuery(2, { ...emptyRange(), mode: "custom", from: "2026-11-01", to: "2026-11-02", withTimes: true, fromTime: "13:00", toTime: "18:00" }, "Europe/London");
    expect(Object.fromEntries(query)).toEqual({ playerId: "2", from: "2026-11-01T13:00", to: "2026-11-02T18:00" });
  });
});
