export type MeasurementType = "reps" | "seconds";

export interface ExerciseOption {
  amount: number;
  measurement: MeasurementType;
}

export interface Exercise {
  key: string;
  name: string;
  options: readonly ExerciseOption[];
}

const reps = (options: readonly number[]): readonly ExerciseOption[] =>
  options.map((amount) => ({ amount, measurement: "reps" }));
const seconds = (options: readonly number[]): readonly ExerciseOption[] =>
  options.map((amount) => ({ amount, measurement: "seconds" }));

export const EXERCISES: readonly Exercise[] = [
  { key: "push-ups", name: "Push-ups", options: reps([10, 20, 30]) },
  { key: "squats", name: "Squats", options: reps([30, 40, 60]) },
  { key: "crunches", name: "Crunches", options: reps([20, 30, 40]) },
  { key: "squat-jumps", name: "Squat jumps", options: reps([10, 20, 30]) },
  { key: "bicycle-crunches", name: "Bicycle crunches", options: reps([20, 30, 40]) },
  { key: "dead-bugs", name: "Dead bugs", options: reps([15, 25, 35]) },
  { key: "plank-shoulder-taps", name: "Plank shoulder taps", options: reps([20, 30, 40]) },
  { key: "burpees", name: "Burpees", options: seconds([30, 45, 60]) },
  { key: "jumping-jacks", name: "Jumping jacks", options: seconds([60, 90, 120]) },
  { key: "wall-sit", name: "Wall sit", options: seconds([30, 60, 90]) },
  { key: "plank", name: "Plank", options: seconds([45, 60, 90]) },
  { key: "flutter-kicks", name: "Flutter kicks", options: seconds([30, 45, 60]) },
  { key: "bear-crawls", name: "Bear crawls", options: seconds([30, 45, 60]) },
  { key: "russian-twists", name: "Russian twists", options: seconds([30, 45, 60]) },
  { key: "mountain-climbers", name: "Mountain climbers", options: seconds([45, 90, 120]) },
  {
    key: "walking-lunges",
    name: "Walking lunges",
    options: [
      { amount: 10, measurement: "reps" }, { amount: 20, measurement: "reps" },
      { amount: 30, measurement: "reps" }, { amount: 30, measurement: "seconds" },
      { amount: 60, measurement: "seconds" }, { amount: 90, measurement: "seconds" },
    ],
  },
] as const;

export function exerciseForKey(key: string): Exercise {
  const exercise = EXERCISES.find((item) => item.key === key);
  if (!exercise) throw new Error(`Unknown exercise key: ${key}`);
  return exercise;
}

export function optionForDice(exercise: Exercise, dice: number): ExerciseOption {
  if (!Number.isInteger(dice) || dice < 1 || dice > 6) throw new Error("Dice must be 1 through 6");
  if (exercise.options.length === 6) return exercise.options[dice - 1]!;
  return exercise.options[Math.floor((dice - 1) / 2)]!;
}
