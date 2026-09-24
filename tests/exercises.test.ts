import { describe, expect, it } from "vitest";
import { exerciseForKey, optionForDice } from "../src/config/exercises.js";

describe("Telegram dice amount mapping", () => {
  it("maps three options over paired dice faces", () => {
    const pushUps = exerciseForKey("push-ups");
    expect([1, 2, 3, 4, 5, 6].map((face) => optionForDice(pushUps, face).amount)).toEqual([10, 10, 20, 20, 30, 30]);
  });
  it("maps walking lunges face by face, including timed outcomes", () => {
    const lunges = exerciseForKey("walking-lunges");
    expect([1, 2, 3, 4, 5, 6].map((face) => optionForDice(lunges, face))).toEqual([
      { amount: 10, measurement: "reps" }, { amount: 20, measurement: "reps" }, { amount: 30, measurement: "reps" },
      { amount: 30, measurement: "seconds" }, { amount: 60, measurement: "seconds" }, { amount: 90, measurement: "seconds" },
    ]);
  });
});
