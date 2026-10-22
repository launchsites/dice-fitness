import { EXERCISES, optionForDice } from "../src/config/exercises.js";
import { INJURY_FILTERS, eligibleExercises } from "../src/config/injuries.js";
import type { State, Assignment, Roll } from "./types.js";

const now = new Date().toISOString();
let nextId = 4;
let pending: Roll | null = null;
const history: Assignment[] = [
  { id: 3, groupId: -1, targetPlayerId: 2, operatorPlayerId: 1, exerciseKey: "squat-jumps", measurement: "reps", amount: 20, diceResult: 3, gameDate: now.slice(0, 10), assignedAt: now, completedAt: null, completionBatchId: null, undoneAt: null, undoneByPlayerId: null },
  { id: 2, groupId: -1, targetPlayerId: 1, operatorPlayerId: 1, exerciseKey: "walking-lunges", measurement: "seconds", amount: 60, diceResult: 5, gameDate: now.slice(0, 10), assignedAt: now, completedAt: null, completionBatchId: null, undoneAt: null, undoneByPlayerId: null },
  { id: 1, groupId: -1, targetPlayerId: 2, operatorPlayerId: 1, exerciseKey: "push-ups", measurement: "reps", amount: 30, diceResult: 6, gameDate: now.slice(0, 10), assignedAt: now, completedAt: now, completionBatchId: 1, undoneAt: null, undoneByPlayerId: null },
];
export async function demoRequest(path: string, body?: Record<string, unknown>): Promise<unknown> {
  await new Promise((resolve) => setTimeout(resolve, 160));
  if (path === "/api/state") {
    const players = ["Alex", "Sam"].map((name, index) => ({
      id: index + 1, name, active: true,
      completed: history.filter((row) => row.targetPlayerId === index + 1 && row.completedAt && !row.undoneAt).length,
      owed: history.filter((row) => row.targetPlayerId === index + 1 && !row.completedAt && !row.undoneAt).toReversed(),
      totals: EXERCISES.flatMap((exercise) => {
        const mine = history.filter((row) => row.targetPlayerId === index + 1 && row.exerciseKey === exercise.key && row.completedAt && !row.undoneAt);
        return mine.length ? [{ name: exercise.name, reps: mine.filter((row) => row.measurement === "reps").reduce((n, row) => n + row.amount, 0), seconds: mine.filter((row) => row.measurement === "seconds").reduce((n, row) => n + row.amount, 0) }] : [];
      }),
    }));
    return { me: { id: 1, name: "Alex" }, players, exercises: EXERCISES.map((exercise) => ({ ...exercise, options: [...exercise.options] })), injuries: INJURY_FILTERS.map((filter) => ({ ...filter, excludes: [...filter.excludes] })), history: history.filter((row) => !row.undoneAt), pending, lastRoll: history.find((row) => !row.undoneAt) ?? null } satisfies State;
  }
  if (path === "/api/rolls") {
    const filters = body!.injuryFilters as string[];
    const options = eligibleExercises(filters);
    pending ??= { id: body!.id as string, groupId: -1, operatorPlayerId: 1, targetPlayerId: body!.targetPlayerId as number, exerciseKey: options[Math.floor(Math.random() * options.length)]!.key, injuryFilters: filters, assignmentId: null, createdAt: now };
    return { roll: pending };
  }
  if (path.endsWith("/finish") && pending) {
    const diceResult = 1 + Math.floor(Math.random() * 6);
    const option = optionForDice(EXERCISES.find((exercise) => exercise.key === pending!.exerciseKey)!, diceResult);
    const assignment: Assignment = { ...history[0]!, ...option, id: nextId++, targetPlayerId: pending.targetPlayerId, exerciseKey: pending.exerciseKey, diceResult, completedAt: null, assignedAt: new Date().toISOString() };
    history.unshift(assignment); pending = null; return { assignment };
  }
  if (path === "/api/complete") {
    let completed = 0;
    for (const row of history) if ((body!.assignmentIds as number[]).includes(row.id) && !row.completedAt) { row.completedAt = new Date().toISOString(); completed++; }
    return { completed };
  }
  if (path === "/api/dismiss" || path === "/api/undo") {
    const row = history.find((item) => item.id === body!.assignmentId);
    if (row?.completedAt && path === "/api/dismiss") throw new Error("This exercise is already complete.");
    if (row) { row.undoneAt = now; row.undoneByPlayerId = 1; }
    return { assignment: row };
  }
  throw new Error("Preview action unavailable.");
}
