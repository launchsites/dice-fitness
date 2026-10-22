import { EXERCISES } from "./exercises.js";

// These are explicit movement exclusions, not medical assessments of suitability.
export const INJURY_FILTERS = [
  { key: "knee", name: "Knee", detail: "No jumping, squats, lunges or kneeling", excludes: ["squats", "squat-jumps", "jumping-jacks", "burpees", "walking-lunges", "wall-sit", "bear-crawls", "mountain-climbers"] },
  { key: "ankle", name: "Ankle / foot", detail: "No impact, lunges or toe-supported moves", excludes: ["squat-jumps", "jumping-jacks", "burpees", "walking-lunges", "bear-crawls", "mountain-climbers", "push-ups", "plank", "plank-shoulder-taps"] },
  { key: "wrist", name: "Wrist / hand", detail: "No weight through the hands", excludes: ["push-ups", "burpees", "plank", "plank-shoulder-taps", "bear-crawls", "mountain-climbers"] },
  { key: "shoulder", name: "Shoulder", detail: "No arm loading or overhead jumping", excludes: ["push-ups", "burpees", "plank", "plank-shoulder-taps", "bear-crawls", "mountain-climbers", "jumping-jacks"] },
  { key: "back", name: "Back", detail: "No loaded bends, twists, impact or floor core", excludes: ["crunches", "bicycle-crunches", "dead-bugs", "russian-twists", "flutter-kicks", "squat-jumps", "jumping-jacks", "burpees", "mountain-climbers", "bear-crawls", "plank", "plank-shoulder-taps", "push-ups"] },
] as const;

export function parseInjuryFilters(value: unknown): string[] {
  if (!Array.isArray(value) || value.length > INJURY_FILTERS.length || value.some((key) => !INJURY_FILTERS.some((filter) => filter.key === key))) {
    throw new Error("Choose valid injury filters.");
  }
  return [...new Set(value as string[])].sort();
}

export function eligibleExercises(filters: readonly string[]) {
  const excluded = new Set<string>(INJURY_FILTERS.filter((filter) => filters.includes(filter.key)).flatMap((filter) => [...filter.excludes]));
  return EXERCISES.filter((exercise) => !excluded.has(exercise.key));
}
