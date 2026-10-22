import { createHmac, randomUUID } from "node:crypto";
import { once } from "node:events";
import type { Server } from "node:http";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

const connection = process.env.TEST_DATABASE_URL;
const token = "123456:test-token";
const group = -123456;
let game: typeof import("../src/services/game-service.js");
let app: typeof import("../src/services/app-service.js");
let database: typeof import("../src/db/client.js");
let operator: Awaited<ReturnType<typeof import("../src/services/game-service.js")["addPlayer"]>>;
let target: typeof operator;
let server: Server;
let base: string;

function auth(id = 1001) {
  const values = { auth_date: String(Math.floor(Date.now() / 1000)), user: JSON.stringify({ id, first_name: "Test" }) };
  const content = Object.entries(values).sort(([a], [b]) => a.localeCompare(b)).map(([key, value]) => `${key}=${value}`).join("\n");
  const secret = createHmac("sha256", "WebAppData").update(token).digest();
  return "tma " + new URLSearchParams({ ...values, hash: createHmac("sha256", secret).update(content).digest("hex") });
}

describe.skipIf(!connection)("Mini App PostgreSQL integration", () => {
  beforeAll(async () => {
    const url = new URL(connection!);
    if (!["127.0.0.1", "localhost"].includes(url.hostname) || url.pathname !== "/dice_test") throw new Error("Integration tests require the disposable localhost dice_test database");
    vi.stubEnv("BOT_TOKEN", token); vi.stubEnv("GAME_CHAT_ID", String(group)); vi.stubEnv("DATABASE_URL", connection!);
    database = await import("../src/db/client.js");
    const { migrate } = await import("drizzle-orm/node-postgres/migrator");
    await migrate(database.db, { migrationsFolder: "drizzle" });
    await database.pool.query("TRUNCATE app_rolls, assignments, completion_batches, operator_preferences, group_players, bot_messages, daily_boards, players, groups RESTART IDENTITY CASCADE");
    game = await import("../src/services/game-service.js"); app = await import("../src/services/app-service.js");
    operator = await game.addPlayer(group, { id: 1001, first_name: "Test operator" });
    target = await game.addPlayer(group, { id: 1002, first_name: "Test target" });
    const { Bot } = await import("grammy"); const bot = new Bot(token);
    bot.api.config.use(async (_previous, method, payload) => {
      if (method === "getChatMember") return { ok: true, result: { status: (payload as { user_id: number }).user_id === 9999 ? "left" : "member", user: { id: 1001, is_bot: false, first_name: "Test" } } };
      return { ok: true, result: true };
    });
    const { createAppServer } = await import("../src/web/server.js"); server = createAppServer(bot);
    server.listen(0, "127.0.0.1"); await once(server, "listening");
    base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  });
  afterAll(async () => {
    if (server) { server.closeAllConnections(); await new Promise<void>((resolve) => server.close(() => resolve())); }
    if (database) await database.closeDatabase(); vi.unstubAllEnvs();
  });

  it("persists one activity under concurrent retries and resumes the original filters", async () => {
    const id = randomUUID();
    const results = await Promise.all(Array.from({ length: 10 }, () => app.beginRoll(operator, { id, targetPlayerId: target.id, injuryFilters: ["knee"] })));
    expect(new Set(results.map((roll) => roll.id)).size).toBe(1);
    expect(results[0]!.injuryFilters).toEqual(["knee"]);
    const resumed = await app.beginRoll(operator, { id: randomUUID(), targetPlayerId: operator.id, injuryFilters: [] });
    expect(resumed.id).toBe(id); expect(resumed.targetPlayerId).toBe(target.id);
    expect(["jumping-jacks", "squat-jumps", "squats", "walking-lunges"]).not.toContain(resumed.exerciseKey);
    expect((await game.outstandingAssignments(group, target.id)).length).toBe(0);
    const assignments = await Promise.all(Array.from({ length: 10 }, () => app.finishRoll(operator, id)));
    expect(new Set(assignments.map((item) => item.id)).size).toBe(1);
    expect((await game.outstandingAssignments(group, target.id)).length).toBe(1);
    expect((await app.appState(operator)).pending).toBeNull();
    const next = await app.beginRoll(operator, { id: randomUUID(), targetPlayerId: target.id, injuryFilters: [] });
    expect(next.injuryFilters).toEqual([]);
    await app.finishRoll(operator, next.id);
  });
  it("makes tick-one retries harmless and checks the exact oldest exercise", async () => {
    const owed = await game.outstandingAssignments(group, target.id);
    expect(owed.length).toBe(2);
    await expect(app.completeAppAssignments(target.id, [owed[1]!.id], true)).rejects.toThrow("queue changed");
    const completions = await Promise.all(Array.from({ length: 10 }, () => app.completeAppAssignments(target.id, [owed[0]!.id], true)));
    expect(completions.reduce((sum, count) => sum + count, 0)).toBe(1);
    expect((await game.outstandingAssignments(group, target.id)).map((row) => row.id)).toEqual([owed[1]!.id]);
    expect((await game.completedAssignments(group)).length).toBe(1);
  });
  it("undoes only this operator's explicitly displayed last assignment", async () => {
    const last = (await app.appState(operator)).lastRoll!;
    const completions = await game.completedAssignments(group);
    await expect(app.undoAppAssignment(target, last.id)).rejects.toThrow("not found");
    await expect(app.undoAppAssignment(operator, completions[0]!.id)).rejects.toThrow("newer roll");
    await Promise.all(Array.from({ length: 5 }, () => app.undoAppAssignment(operator, last.id)));
    expect((await game.outstandingAssignments(group, target.id)).length).toBe(0);
    expect((await game.completedAssignments(group)).length).toBe(1);
  });
  it("rejects unsigned requests, tampered sessions, non-members and foreign targets", async () => {
    expect((await fetch(base + "/api/state")).status).toBe(401);
    expect((await fetch(base + "/api/state", { headers: { Authorization: auth().replace("Test", "Fake") } })).status).toBe(401);
    expect((await fetch(base + "/api/state", { headers: { Authorization: auth(9999) } })).status).toBe(403);
    const response = await fetch(base + "/api/state", { headers: { Authorization: auth() } });
    expect(response.status).toBe(200); expect((await response.json()).players.length).toBe(2);
    const invalid = await fetch(base + "/api/rolls", { method: "POST", headers: { Authorization: auth(), "Content-Type": "application/json" }, body: JSON.stringify({ id: randomUUID(), targetPlayerId: 9999, injuryFilters: [] }) });
    expect(invalid.status).toBe(409);
    expect((await fetch(base + "/health")).status).toBe(200);
  });
  it("completes an individually selected exercise without completing older or other players' items", async () => {
    for (const player of [target, target, operator]) {
      const pending = await app.beginRoll(operator, { id: randomUUID(), targetPlayerId: player.id, injuryFilters: [] });
      await app.finishRoll(operator, pending.id);
    }
    const owed = await game.outstandingAssignments(group, target.id);
    const otherOwed = await game.outstandingAssignments(group, operator.id);
    const completedBefore = (await game.completedAssignments(group)).length;
    expect(owed).toHaveLength(2);
    const payload = { targetPlayerId: target.id, assignmentIds: [owed[1]!.id], nextOnly: false };
    const complete = () => fetch(base + "/api/complete", { method: "POST", headers: { Authorization: auth(), "Content-Type": "application/json" }, body: JSON.stringify(payload) });
    const response = await complete();
    expect(response.status).toBe(200); expect(await response.json()).toEqual({ completed: 1 });
    expect((await game.outstandingAssignments(group, target.id)).map((row) => row.id)).toEqual([owed[0]!.id]);
    expect((await game.outstandingAssignments(group, operator.id)).map((row) => row.id)).toEqual(otherOwed.map((row) => row.id));
    expect((await game.completedAssignments(group)).length).toBe(completedBefore + 1);
    const retry = await complete();
    expect(retry.status).toBe(200); expect(await retry.json()).toEqual({ completed: 0 });
  });
});
