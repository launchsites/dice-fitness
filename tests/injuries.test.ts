import { describe, expect, it } from "vitest";
import { eligibleExercises, INJURY_FILTERS, parseInjuryFilters } from "../src/config/injuries.js";
import { EXERCISES } from "../src/config/exercises.js";

describe("per-roll injury exclusions", () => {
  it("keeps the full exercise set for an unfiltered subsequent roll", () => {
    eligibleExercises(["knee"]);
    expect(eligibleExercises([])).toEqual(EXERCISES);
  });
  it("removes impact and knee-loading moves for the knee setting", () => {
    const keys = eligibleExercises(["knee"]).map((exercise) => exercise.key);
    expect(keys).not.toEqual(expect.arrayContaining(["jumping-jacks"]));
    for (const key of ["squat-jumps", "squats", "walking-lunges", "burpees", "jumping-jacks"]) expect(keys).not.toContain(key);
    expect(keys).toContain("crunches");
  });
  it("applies the union of multiple filters and handles an empty eligible set", () => {
    expect(eligibleExercises(INJURY_FILTERS.map((filter) => filter.key))).toEqual([]);
    const keys = eligibleExercises(["knee", "wrist"]).map((exercise) => exercise.key);
    expect(keys).not.toContain("push-ups"); expect(keys).not.toContain("squats");
  });
  it("rejects unknown filters instead of silently accepting them", () => {
    expect(() => parseInjuryFilters(["unknown"])).toThrow();
    expect(() => parseInjuryFilters("knee")).toThrow();
    expect(parseInjuryFilters(["knee", "knee"])).toEqual(["knee"]);
  });
});
