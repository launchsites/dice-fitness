import { EXERCISES, optionForDice } from "../src/config/exercises.js";
import { INJURY_FILTERS, eligibleExercises } from "../src/config/injuries.js";
import { manualEntryValues } from "../src/config/manual-entry.js";
import { historyFilters } from "../src/config/history.js";
import type { State, Assignment, Roll } from "./types.js";

const now = new Date().toISOString();
const rollMetadata = { entryType: "roll" as const, entryRequestId: null };
let nextId = 7;
let pending: Roll | null = null;
const history: Assignment[] = [
  { ...rollMetadata, id: 3, groupId: -1, targetPlayerId: 2, operatorPlayerId: 1, exerciseKey: "squat-jumps", measurement: "reps", amount: 20, diceResult: 3, gameDate: now.slice(0, 10), assignedAt: now, completedAt: null, completionBatchId: null, undoneAt: null, undoneByPlayerId: null },
  { ...rollMetadata, id: 2, groupId: -1, targetPlayerId: 1, operatorPlayerId: 1, exerciseKey: "walking-lunges", measurement: "seconds", amount: 60, diceResult: 5, gameDate: now.slice(0, 10), assignedAt: now, completedAt: null, completionBatchId: null, undoneAt: null, undoneByPlayerId: null },
  { ...rollMetadata, id: 1, groupId: -1, targetPlayerId: 2, operatorPlayerId: 1, exerciseKey: "push-ups", measurement: "reps", amount: 30, diceResult: 6, gameDate: now.slice(0, 10), assignedAt: now, completedAt: now, completionBatchId: 1, undoneAt: null, undoneByPlayerId: null },
];
// Mixed completion times make the combined timeline and date filters useful in preview.
for (const [id, targetPlayerId, hours, exerciseKey, amount] of [[4, 1, 1, "crunches", 30], [5, 2, 24, "sit-ups", 20], [6, 1, 48, "dead-bugs", 25]] as const) {
  const completedAt = new Date(Date.now() - hours * 3_600_000).toISOString();
  history.push({ ...history[2]!, id, targetPlayerId, exerciseKey, amount, completedAt, assignedAt: completedAt, gameDate: completedAt.slice(0, 10) });
}
export async function demoRequest(path: string, body?: Record<string, unknown>): Promise<unknown> {
  await new Promise((resolve) => setTimeout(resolve, 160));
  if (path.startsWith("/api/history?")) {
    const filters = historyFilters(new URL(path, location.origin).searchParams, "Europe/London");
    const rows = history.filter((row) => row.completedAt && !row.undoneAt && (!filters.playerId || row.targetPlayerId === filters.playerId) && (!filters.from || new Date(row.completedAt) >= filters.from) && (!filters.until || new Date(row.completedAt) < filters.until) && (!filters.cursor || row.completedAt < filters.cursor.completedAt.toISOString() || row.completedAt === filters.cursor.completedAt.toISOString() && row.id < filters.cursor.id)).sort((a, b) => b.completedAt!.localeCompare(a.completedAt!) || b.id - a.id);
    const entries = rows.slice(0, 50), last = entries.at(-1);
    return { entries, nextCursor: rows.length > 50 && last ? `${last.completedAt}|${last.id}` : null };
  }
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
    return { me: { id: 1, name: "Alex" }, timezone: "Europe/London", players, exercises: EXERCISES.map((exercise) => ({ ...exercise, options: [...exercise.options] })), injuries: INJURY_FILTERS.map((filter) => ({ ...filter, excludes: [...filter.excludes] })), history: history.filter((row) => !row.undoneAt), pending, lastRoll: history.find((row) => !row.undoneAt) ?? null } satisfies State;
  }
  if (path === "/api/rolls") {
    const filters = body!.injuryFilters as string[];
    const exerciseExclusions = (body!.exerciseExclusions ?? []) as string[];
    const options = eligibleExercises(filters, exerciseExclusions);
    pending ??= { id: body!.id as string, groupId: -1, operatorPlayerId: 1, targetPlayerId: body!.targetPlayerId as number, exerciseKey: options[Math.floor(Math.random() * options.length)]!.key, injuryFilters: filters, exerciseExclusions, assignmentId: null, createdAt: now };
    return { roll: pending };
  }
  if (path.endsWith("/finish") && pending) {
    const diceResult = 1 + Math.floor(Math.random() * 6);
    const option = optionForDice(EXERCISES.find((exercise) => exercise.key === pending!.exerciseKey)!, diceResult);
    const assignment: Assignment = { ...history[0]!, ...rollMetadata, ...option, id: nextId++, targetPlayerId: pending.targetPlayerId, exerciseKey: pending.exerciseKey, diceResult, completedAt: null, completionBatchId: null, undoneAt: null, undoneByPlayerId: null, assignedAt: new Date().toISOString() };
    history.unshift(assignment); pending = null; return { assignment };
  }
  if (path === "/api/assignments") {
    const values = manualEntryValues({ exerciseKey: body!.exerciseKey, amount: body!.amount, measurement: body!.measurement });
    const existing = history.find((row) => row.entryRequestId === body!.id);
    if (existing) return { assignment: existing };
    const assignment: Assignment = { ...history[0]!, ...values, id: nextId++, targetPlayerId: body!.targetPlayerId as number, operatorPlayerId: 1, diceResult: null, entryType: "manual", entryRequestId: body!.id as string, completedAt: null, completionBatchId: null, undoneAt: null, undoneByPlayerId: null, assignedAt: new Date().toISOString() };
    history.unshift(assignment); return { assignment };
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
