import { and, desc, eq, gte, isNotNull, isNull, lt, or } from "drizzle-orm";
import { historyFilters } from "../config/history.js";
import { env } from "../config/env.js";
import { db } from "../db/client.js";
import { assignments, groupPlayers } from "../db/schema.js";
import { AppError } from "../web/errors.js";

export async function completedHistory(params: URLSearchParams) {
  let filters: ReturnType<typeof historyFilters>;
  try { filters = historyFilters(params, env.timezone); } catch (error) { throw new AppError(400, (error as Error).message); }
  const { playerId, from, until, cursor } = filters;
  if (playerId !== null) {
    const [member] = await db.select({ id: groupPlayers.id }).from(groupPlayers).where(and(eq(groupPlayers.groupId, env.gameChatId), eq(groupPlayers.playerId, playerId)));
    if (!member) throw new AppError(400, "Choose a person from this game.");
  }
  const rows = await db.select().from(assignments).where(and(
    eq(assignments.groupId, env.gameChatId), isNotNull(assignments.completedAt), isNull(assignments.undoneAt),
    playerId === null ? undefined : eq(assignments.targetPlayerId, playerId),
    from ? gte(assignments.completedAt, from) : undefined,
    until ? lt(assignments.completedAt, until) : undefined,
    cursor ? or(lt(assignments.completedAt, cursor.completedAt), and(eq(assignments.completedAt, cursor.completedAt), lt(assignments.id, cursor.id))) : undefined,
  )).orderBy(desc(assignments.completedAt), desc(assignments.id)).limit(51);
  const entries = rows.slice(0, 50), last = entries.at(-1);
  return { entries, nextCursor: rows.length > 50 && last ? `${last.completedAt!.toISOString()}|${last.id}` : null };
}
