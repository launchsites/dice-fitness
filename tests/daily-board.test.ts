import { describe, expect, it } from "vitest";
import { dailyBoardView } from "../src/renderers/daily-board.js";

describe("daily board", () => {
  it("keeps every assignment in exact order instead of aggregating duplicates", () => {
    const base = { id: 1, targetPlayerId: 1, operatorPlayerId: 2, measurement: "reps" as const, diceResult: 1, gameDate: "2026-09-24", assignedAt: new Date(), completedAt: null, undoneAt: null, targetName: "Jamie" };
    const board = dailyBoardView("2026-09-24", [
      { ...base, exerciseKey: "push-ups", amount: 10 }, { ...base, id: 2, exerciseKey: "squats", amount: 30 }, { ...base, id: 3, exerciseKey: "push-ups", amount: 10 },
    ]);
    expect(board).toContain("⬜ 1. Push-ups — 10 reps");
    expect(board).toContain("⬜ 2. Squats — 30 reps");
    expect(board).toContain("⬜ 3. Push-ups — 10 reps");
  });
  it("keeps completed history while later assignments remain outstanding", () => {
    const base = { id: 1, targetPlayerId: 1, operatorPlayerId: 2, measurement: "reps" as const, diceResult: 1, gameDate: "2026-09-24", assignedAt: new Date(), undoneAt: null, targetName: "Greg" };
    const board = dailyBoardView("2026-09-24", [
      { ...base, exerciseKey: "push-ups", amount: 10, completedAt: new Date() },
      { ...base, id: 2, exerciseKey: "squats", amount: 30, completedAt: null },
    ]);
    expect(board).toContain("✅ 1. Push-ups — 10 reps");
    expect(board).toContain("⬜ 2. Squats — 30 reps");
  });
});
