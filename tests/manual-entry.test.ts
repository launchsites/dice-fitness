import { expect, it } from "vitest";
import { manualEntryValues } from "../src/config/manual-entry.js";
import { exerciseForKey, optionForDice } from "../src/config/exercises.js";

it("permits a valid custom manual quantity without fabricating a roll", () => {
  expect(manualEntryValues({ exerciseKey: "crunches", amount: 17, measurement: "reps" })).toEqual({ exerciseKey: "crunches", amount: 17, measurement: "reps" });
  expect(manualEntryValues({ exerciseKey: "crunches", amount: 30, measurement: "seconds" }).measurement).toBe("seconds");
  for (const amount of [0, -1, 1.5, "20", null, NaN, 10001]) expect(() => manualEntryValues({ exerciseKey: "crunches", amount, measurement: "reps" })).toThrow();
  expect(() => manualEntryValues({ exerciseKey: "unknown", amount: 20, measurement: "reps" })).toThrow();
  expect(() => manualEntryValues({ exerciseKey: "crunches", amount: 20, measurement: "minutes" })).toThrow();
});
it("gives Sit-ups the approved 20/30/40-rep options", () => {
  expect([1,2,3,4,5,6].map((face) => optionForDice(exerciseForKey("sit-ups"), face).amount)).toEqual([20,20,30,30,40,40]);
});
