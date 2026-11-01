import { EXERCISES, type MeasurementType } from "./exercises.js";

export function manualEntryValues(request: { exerciseKey: unknown; amount: unknown; measurement: unknown }) {
  if (typeof request.exerciseKey !== "string" || !EXERCISES.some((exercise) => exercise.key === request.exerciseKey)) throw new Error("Choose a valid exercise.");
  if (typeof request.amount !== "number" || !Number.isSafeInteger(request.amount) || request.amount < 1 || request.amount > 10000) throw new Error("Enter a whole amount from 1 to 10000.");
  if (request.measurement !== "reps" && request.measurement !== "seconds") throw new Error("Choose reps or seconds.");
  return { exerciseKey: request.exerciseKey, amount: request.amount, measurement: request.measurement as MeasurementType };
}
