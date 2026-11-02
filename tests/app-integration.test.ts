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
let botApi: import("grammy").Api;
let profileLookups = 0, avatarDownloads = 0;
const avatarPng = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg==", "base64");

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
    botApi = bot.api;
    bot.api.config.use(async (_previous, method, payload) => {
      if (method === "getChatMember") return { ok: true, result: { status: (payload as { user_id: number }).user_id === 9999 ? "left" : (payload as { user_id: number }).user_id === 1001 ? "administrator" : "member", user: { id: 1001, is_bot: false, first_name: "Test" } } };
      if (method === "getUserProfilePhotos") { profileLookups++; return { ok: true, result: { total_count: (payload as { user_id: number }).user_id === 1001 ? 1 : 0, photos: (payload as { user_id: number }).user_id === 1001 ? [[{ file_id: "test-photo", file_unique_id: "unique-photo", width: 160, height: 160 }]] : [] } }; }
      if (method === "getFile") return { ok: true, result: { file_id: "test-photo", file_unique_id: "unique-photo", file_path: "photos/test.png" } };
      return { ok: true, result: true };
    });
    const { createAppServer } = await import("../src/web/server.js"); server = createAppServer(bot, { avatarDownload: async () => { avatarDownloads++; return new Response(avatarPng, { headers: { "Content-Type": "image/png" } }); } });
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
  it("dismisses any exact owed row with an audit trail, without completion credit", async () => {
    const owed = await game.outstandingAssignments(group, target.id);
    const original = owed[0]!;
    const before = (await game.completedAssignments(group)).map((row) => row.id);
    const otherOwed = (await game.outstandingAssignments(group, operator.id)).map((row) => row.id);
    // A different member may dismiss an older roll, unlike legacy last-roll undo.
    const dismiss = () => fetch(base + "/api/dismiss", { method: "POST", headers: { Authorization: auth(1002), "Content-Type": "application/json" }, body: JSON.stringify({ assignmentId: original.id }) });
    const responses = await Promise.all(Array.from({ length: 5 }, dismiss));
    for (const response of responses) {
      expect(response.status).toBe(200);
      const { assignment } = await response.json();
      expect(assignment.undoneAt).toBeTruthy(); expect(assignment.undoneByPlayerId).toBe(target.id); expect(assignment.completedAt).toBeNull();
    }
    expect((await game.outstandingAssignments(group, target.id)).some((row) => row.id === original.id)).toBe(false);
    expect((await game.completedAssignments(group)).map((row) => row.id)).toEqual(before);
    expect((await game.outstandingAssignments(group, operator.id)).map((row) => row.id)).toEqual(otherOwed);
    expect((await database.pool.query("SELECT count(*)::int AS count FROM assignments WHERE id=$1", [original.id])).rows[0].count).toBe(1);
  });
  it("rejects dismissal of completed, missing, foreign-group or unsigned rows", async () => {
    const completed = (await game.completedAssignments(group))[0]!;
    await expect(app.dismissAppAssignment(operator, completed.id)).rejects.toThrow("already complete");
    await expect(app.dismissAppAssignment(operator, 999999)).rejects.toThrow("not found");
    const foreignGroup = -7777;
    await game.addPlayer(foreignGroup, { id: 1002, first_name: "Test target" });
    const foreign = await database.pool.query("INSERT INTO assignments (group_id,target_player_id,operator_player_id,exercise_key,measurement,amount,dice_result,game_date) VALUES ($1,$2,$3,'squats','reps',10,1,CURRENT_DATE) RETURNING id", [foreignGroup, target.id, operator.id]);
    await expect(app.dismissAppAssignment(operator, foreign.rows[0].id)).rejects.toThrow("not found");
    expect((await fetch(base + "/api/dismiss", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ assignmentId: completed.id }) })).status).toBe(401);
  });
  it("serializes completion against dismissal so an item cannot be both", async () => {
    const pending = await app.beginRoll(operator, { id: randomUUID(), targetPlayerId: target.id, injuryFilters: [] });
    const row = await app.finishRoll(operator, pending.id);
    await Promise.allSettled([app.completeAppAssignments(target.id, [row.id], false), app.dismissAppAssignment(operator, row.id)]);
    const saved = (await database.pool.query("SELECT completed_at,undone_at FROM assignments WHERE id=$1", [row.id])).rows[0];
    expect(Boolean(saved.completed_at) !== Boolean(saved.undone_at)).toBe(true);
  });
  it("adds one manual assignment under repeated requests, with audit metadata and no die value", async () => {
    const body = { id: randomUUID(), targetPlayerId: target.id, exerciseKey: "crunches", amount: 17, measurement: "reps" };
    const before = (await game.outstandingAssignments(group, target.id)).length;
    const post = (value = body, userId = 1001) => fetch(base + "/api/assignments", { method: "POST", headers: { Authorization: auth(userId), "Content-Type": "application/json" }, body: JSON.stringify(value) });
    const results = await Promise.all(Array.from({ length: 8 }, () => post()));
    const rows = await Promise.all(results.map(async (response) => { expect(response.status).toBe(200); return (await response.json()).assignment; }));
    expect(new Set(rows.map((row) => row.id)).size).toBe(1);
    expect(rows[0]).toMatchObject({ entryType: "manual", entryRequestId: body.id, diceResult: null, amount: 17, operatorPlayerId: operator.id, completedAt: null });
    expect((await game.outstandingAssignments(group, target.id)).length).toBe(before + 1);
    expect((await post({ ...body, amount: 18 })).status).toBe(409);
    expect((await post(body, 1002)).status).toBe(409);
    await app.dismissAppAssignment(operator, rows[0].id);
    const retry = await post(); expect((await retry.json()).assignment.undoneAt).toBeTruthy();
    expect((await game.outstandingAssignments(group, target.id)).length).toBe(before);
  });
  it("rejects invalid manual additions and foreign targets without creating rows", async () => {
    const before = (await database.pool.query("SELECT count(*)::int AS count FROM assignments")).rows[0].count;
    for (const extra of [{ amount: 0 }, { amount: 1.5 }, { amount: 10001 }, { exerciseKey: "unknown" }, { measurement: "minutes" }, { id: "invalid" }]) {
      const response = await fetch(base + "/api/assignments", { method: "POST", headers: { Authorization: auth(), "Content-Type": "application/json" }, body: JSON.stringify({ id: randomUUID(), targetPlayerId: target.id, exerciseKey: "crunches", amount: 20, measurement: "reps", ...extra }) });
      expect(response.status).toBe(400);
    }
    const foreign = await fetch(base + "/api/assignments", { method: "POST", headers: { Authorization: auth(), "Content-Type": "application/json" }, body: JSON.stringify({ id: randomUUID(), targetPlayerId: 99999, exerciseKey: "crunches", amount: 20, measurement: "reps" }) });
    expect(foreign.status).toBe(409);
    expect((await database.pool.query("SELECT count(*)::int AS count FROM assignments")).rows[0].count).toBe(before);
  });
  it("serializes a conflicting manual request ID across different group members", async () => {
    const request = { id: randomUUID(), targetPlayerId: target.id, exerciseKey: "crunches", amount: 20, measurement: "reps", diceResult: 6, entryType: "roll" };
    const responses = await Promise.all([1001, 1002].map((id) => fetch(base + "/api/assignments", { method: "POST", headers: { Authorization: auth(id), "Content-Type": "application/json" }, body: JSON.stringify(request) })));
    expect(responses.map((response) => response.status).sort()).toEqual([200, 409]);
    const rows = (await database.pool.query("SELECT * FROM assignments WHERE entry_request_id=$1", [request.id])).rows;
    expect(rows).toHaveLength(1); expect(rows[0].entry_type).toBe("manual"); expect(rows[0].dice_result).toBeNull();
    await app.dismissAppAssignment(operator, rows[0].id);
  });
  it("persists manual exclusions across an unfinished roll and clears them for the next roll", async () => {
    const { EXERCISES } = await import("../src/config/exercises.js");
    const exclusions = EXERCISES.filter((item) => item.key !== "dead-bugs").map((item) => item.key);
    const pending = await app.beginRoll(operator, { id: randomUUID(), targetPlayerId: target.id, injuryFilters: [], exerciseExclusions: exclusions });
    expect(pending.exerciseKey).toBe("dead-bugs"); expect(pending.exerciseExclusions).toEqual([...exclusions].sort());
    const resumed = await app.beginRoll(operator, { id: randomUUID(), targetPlayerId: operator.id, injuryFilters: [], exerciseExclusions: [] });
    expect(resumed.id).toBe(pending.id); expect(resumed.exerciseExclusions).toEqual(pending.exerciseExclusions);
    await app.finishRoll(operator, pending.id);
    await expect(app.beginRoll(operator, { id: randomUUID(), targetPlayerId: target.id, injuryFilters: [], exerciseExclusions: ["unknown"] })).rejects.toThrow("valid exercises");
    await expect(app.beginRoll(operator, { id: randomUUID(), targetPlayerId: target.id, injuryFilters: [], exerciseExclusions: EXERCISES.map((item) => item.key) })).rejects.toThrow("exclude every");
    const next = await app.beginRoll(operator, { id: randomUUID(), targetPlayerId: target.id, injuryFilters: [], exerciseExclusions: [] });
    expect(next.exerciseExclusions).toEqual([]); await app.finishRoll(operator, next.id);
  });
  it("replaces only the target's owed debt with forty valid core entries, preserving history and retry safety", async () => {
    const maintenance = await import("../src/services/debt-maintenance.js");
    const snapshot = await maintenance.debtSnapshot(1002, 1001);
    const batch = randomUUID();
    const foreignBefore = (await database.pool.query("SELECT * FROM assignments WHERE group_id <> $1 ORDER BY id", [group])).rows;
    const result = await maintenance.replaceCoreDebt(1002, 1001, snapshot.fingerprint, batch);
    expect(result).toMatchObject({ alreadyApplied: false, owedCount: 40, preservedDataUnchanged: true });
    expect(result.byExercise!.every((item) => item.count === 8)).toBe(true);
    for (const key of maintenance.REPLACEMENT_EXERCISES) expect(new Set(result.entries!.filter((row) => row.exerciseKey === key).map((row) => `${row.amount}:${row.measurement}`)).size).toBe(3);
    const rows = await game.outstandingAssignments(group, target.id);
    expect(rows).toHaveLength(40);
    const { exerciseForKey, optionForDice } = await import("../src/config/exercises.js");
    for (const row of rows) expect({ amount: row.amount, measurement: row.measurement }).toEqual(optionForDice(exerciseForKey(row.exerciseKey), row.diceResult!));
    const original = await database.pool.query("SELECT * FROM assignments WHERE id=ANY($1::int[])", [snapshot.owedIds]);
    expect(original.rows).toHaveLength(snapshot.owedIds.length);
    expect(original.rows.every((row) => row.undone_at && !row.completed_at)).toBe(true);
    const after = await maintenance.debtSnapshot(1002, 1001);
    expect(after.preservedFingerprint).not.toBe(snapshot.preservedFingerprint); // Includes now-dismissed rows.
    const allCount = (await database.pool.query("SELECT count(*)::int AS count FROM assignments")).rows[0].count;
    expect(await maintenance.replaceCoreDebt(1002, 1001, snapshot.fingerprint, batch)).toMatchObject({ alreadyApplied: true, owedCount: 40 });
    expect((await database.pool.query("SELECT count(*)::int AS count FROM assignments")).rows[0].count).toBe(allCount);
    expect((await database.pool.query("SELECT * FROM assignments WHERE group_id <> $1 ORDER BY id", [group])).rows).toEqual(foreignBefore);
  });
  it("refuses a stale debt snapshot or unfinished target roll before changing any data", async () => {
    const maintenance = await import("../src/services/debt-maintenance.js");
    const snapshot = await maintenance.debtSnapshot(1002, 1001);
    await app.addManualAssignment(operator, { id: randomUUID(), targetPlayerId: target.id, exerciseKey: "crunches", amount: 20, measurement: "reps" });
    await expect(maintenance.replaceCoreDebt(1002, 1001, snapshot.fingerprint, randomUUID())).rejects.toThrow("Debt changed");
    const fresh = await maintenance.debtSnapshot(1002, 1001);
    const pending = await app.beginRoll(operator, { id: randomUUID(), targetPlayerId: target.id, injuryFilters: [] });
    await expect(maintenance.replaceCoreDebt(1002, 1001, fresh.fingerprint, randomUUID())).rejects.toThrow("unfinished roll");
    expect((await maintenance.debtSnapshot(1002, 1001)).fingerprint).toBe(fresh.fingerprint);
    await app.finishRoll(operator, pending.id);
  });
  it("pages the combined completion timeline without losing tied timestamps, and filters by person/completion time", async () => {
    const inserted = await database.pool.query("INSERT INTO assignments (group_id,target_player_id,operator_player_id,exercise_key,measurement,amount,dice_result,game_date,assigned_at,completed_at) SELECT $1, CASE WHEN n%2=0 THEN $2::int ELSE $3::int END,$2,'crunches','reps',20,1,'2026-07-01','2026-07-01T00:00:00Z','2026-07-03T12:00:00Z' FROM generate_series(1,60) n RETURNING id,target_player_id", [group, operator.id, target.id]);
    const ignored = await database.pool.query("INSERT INTO assignments (group_id,target_player_id,operator_player_id,exercise_key,measurement,amount,dice_result,game_date,completed_at,undone_at) VALUES ($1,$2,$2,'crunches','reps',20,1,'2026-07-03','2026-07-03T12:00:00Z','2026-07-03T13:00:00Z'), ($1,$2,$2,'crunches','reps',20,1,'2026-07-03',NULL,NULL) RETURNING id", [group, operator.id]);
    await database.pool.query("INSERT INTO assignments (group_id,target_player_id,operator_player_id,exercise_key,measurement,amount,dice_result,game_date,completed_at) VALUES (-7777,$1,$1,'crunches','reps',20,1,'2026-07-03','2026-07-03T12:00:00Z')", [target.id]);
    const get = async (query: string) => { const response = await fetch(base + "/api/history?" + query, { headers: { Authorization: auth() } }); expect(response.status).toBe(200); return response.json(); };
    const query = "from=2026-07-03&to=2026-07-03";
    const first = await get(query); expect(first.entries).toHaveLength(50); expect(first.nextCursor).toBeTruthy();
    const second = await get(query + "&cursor=" + encodeURIComponent(first.nextCursor));
    expect(second.entries).toHaveLength(10); expect(second.nextCursor).toBeNull();
    const ids = [...first.entries, ...second.entries].map((row: { id: number }) => row.id);
    expect(ids).toEqual(inserted.rows.map((row) => row.id).sort((a, b) => b - a));
    expect(ids.some((id) => ignored.rows.some((row) => row.id === id))).toBe(false);
    const mine = await get(query + `&playerId=${target.id}`);
    expect(mine.entries).toHaveLength(30); expect(mine.entries.every((row: { targetPlayerId: number }) => row.targetPlayerId === target.id)).toBe(true);
    // 12:00 UTC is 13:00 London. Filter completion time, not the earlier assigned date.
    expect((await get("from=2026-07-03T13:00&to=2026-07-03T13:00")).entries).toHaveLength(50);
    expect((await get("from=2026-07-03T12:00&to=2026-07-03T12:59")).entries).toHaveLength(0);
    expect((await fetch(base + "/api/history")).status).toBe(401);
    for (const bad of ["playerId=999999", "from=invalid", "cursor=bad", "from=2026-07-04&to=2026-07-03"]) expect((await fetch(base + "/api/history?" + bad, { headers: { Authorization: auth() } })).status).toBe(400);
  });
  it("serves cached Telegram photo bytes only to authenticated game members without exposing file URLs", async () => {
    const path = base + `/api/players/${operator.id}/avatar`;
    expect((await fetch(path)).status).toBe(401);
    expect((await fetch(path, { headers: { Authorization: auth(9999) } })).status).toBe(403);
    const response = await fetch(path, { headers: { Authorization: auth() } });
    expect(response.status).toBe(200); expect(response.headers.get("content-type")).toBe("image/png");
    expect(response.headers.get("location")).toBeNull(); expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(Buffer.from(await response.arrayBuffer())).toEqual(avatarPng);
    expect((await fetch(path, { headers: { Authorization: auth() } })).status).toBe(200);
    expect(profileLookups).toBe(1); expect(avatarDownloads).toBe(1);
    expect((await fetch(base + `/api/players/${target.id}/avatar`, { headers: { Authorization: auth() } })).status).toBe(404);
    expect((await fetch(base + "/api/players/999999/avatar", { headers: { Authorization: auth() } })).status).toBe(404);
  });
  it("permits only a group admin to manage private photo overrides and preserves exercise records", async () => {
    const { setPlayerAvatar } = await import("../src/services/avatar-service.js");
    const before = (await database.pool.query("SELECT * FROM assignments ORDER BY id")).rows;
    await expect(setPlayerAvatar(botApi, 1002, 1002, avatarPng)).rejects.toThrow("Only a group admin");
    await expect(setPlayerAvatar(botApi, 1002, 1001, Buffer.from("<svg></svg>"))).rejects.toThrow("JPEG, PNG or WebP");
    await expect(setPlayerAvatar(botApi, 1002, 1001, Buffer.alloc(1048577))).rejects.toThrow("smaller than 1 MB");
    expect(await setPlayerAvatar(botApi, 1002, 1001, avatarPng)).toEqual({ player: target.displayName, override: true });
    const path = base + `/api/players/${target.id}/avatar`;
    const override = await fetch(path, { headers: { Authorization: auth() } });
    expect(override.status).toBe(200); expect(Buffer.from(await override.arrayBuffer())).toEqual(avatarPng);
    expect(avatarDownloads).toBe(1); // Override wins even after the empty Telegram result was cached.
    expect((await database.pool.query("SELECT updated_by_player_id FROM player_avatars")).rows).toEqual([{ updated_by_player_id: operator.id }]);
    expect(await setPlayerAvatar(botApi, 1002, 1001, null)).toEqual({ player: target.displayName, override: false });
    expect((await fetch(path, { headers: { Authorization: auth() } })).status).toBe(404);
    expect((await database.pool.query("SELECT * FROM assignments ORDER BY id")).rows).toEqual(before);
    expect((await fetch(base + `/api/players/${target.id}/avatar`, { method: "POST", headers: { Authorization: auth(), "Content-Type": "application/json" }, body: "{}" })).status).toBe(404);
  });
});
