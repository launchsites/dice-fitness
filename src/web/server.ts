import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { readFile } from "node:fs/promises";
import { resolve, extname, sep } from "node:path";
import type { Bot } from "grammy";
import { env } from "../config/env.js";
import { logger } from "../logger.js";
import { verifyInitData } from "./auth.js";
import { AppError } from "./errors.js";
import { addPlayer, getPlayer, type Player } from "../services/game-service.js";
import { appState, beginRoll, completeAppAssignments, dismissAppAssignment, finishRoll, undoAppAssignment } from "../services/app-service.js";
import { refreshLeaderboard } from "../services/projection-service.js";

const root = resolve("web-dist");
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const mime: Record<string, string> = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8", ".svg": "image/svg+xml", ".png": "image/png", ".woff2": "font/woff2", ".txt": "text/plain; charset=utf-8" };
const limits = new Map<string, { count: number; reset: number }>();
function limit(key: string, max: number) {
  const now = Date.now();
  if (limits.size > 5000) for (const [id, entry] of limits) if (entry.reset < now) limits.delete(id);
  const entry = limits.get(key);
  if (!entry || entry.reset < now) { limits.set(key, { count: 1, reset: now + 60_000 }); return; }
  if (++entry.count > max) throw new AppError(429, "Too many requests. Wait a moment and try again.");
}
function json(res: ServerResponse, status: number, value: unknown) {
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" });
  res.end(JSON.stringify(value));
}
async function body(req: IncomingMessage): Promise<Record<string, unknown>> {
  if (!req.headers["content-type"]?.startsWith("application/json")) throw new AppError(415, "Send JSON.");
  let raw = "";
  for await (const chunk of req) {
    raw += String(chunk);
    if (Buffer.byteLength(raw) > 8192) throw new AppError(413, "Request too large.");
  }
  try {
    const value = JSON.parse(raw) as unknown;
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error();
    return value as Record<string, unknown>;
  } catch { throw new AppError(400, "Invalid JSON."); }
}
const positiveInt = (value: unknown): value is number => typeof value === "number" && Number.isSafeInteger(value) && value > 0;

export function createAppServer(bot: Bot) {
  const members = new Map<number, number>();
  async function authenticate(req: IncomingMessage): Promise<Player> {
    const auth = req.headers.authorization;
    if (!auth?.startsWith("tma ")) throw new AppError(401, "Open Dice Fitness from Telegram.");
    let user;
    try { user = verifyInitData(auth.slice(4), env.botToken); } catch (error) { throw new AppError(401, (error as Error).message); }
    limit(`user:${user.id}`, 120);
    if ((members.get(user.id) ?? 0) < Date.now()) {
      const member = await bot.api.getChatMember(env.gameChatId, user.id);
      if (member.status === "left" || member.status === "kicked" || (member.status === "restricted" && !member.is_member)) throw new AppError(403, "This game is for members of the Dice Fitness group.");
      members.set(user.id, Date.now() + 60_000);
    }
    const existing = await getPlayer(env.gameChatId, user.id);
    if (existing && !existing.active) throw new AppError(403, "Ask a group admin to reactivate your player.");
    return existing ?? addPlayer(env.gameChatId, user);
  }

  let projectionDirty = false;
  async function project() {
    try { await refreshLeaderboard(bot.api); projectionDirty = false; }
    catch (error) { projectionDirty = true; logger.warn({ error: String(error) }, "Leaderboard refresh will retry"); }
  }
  const retry = setInterval(() => { if (projectionDirty) void project(); }, 30_000);
  retry.unref();
  const server = createServer(async (req, res) => {
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Referrer-Policy", "no-referrer");
    res.setHeader("Content-Security-Policy", "default-src 'self'; script-src 'self' https://telegram.org; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; connect-src 'self'; object-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors https://web.telegram.org https://*.telegram.org");
    try {
      const pathname = new URL(req.url || "/", "http://localhost").pathname;
      if (pathname === "/health") { json(res, 200, { ok: true }); return; }
      if (pathname.startsWith("/api/")) {
        if (req.headers.origin && env.miniAppUrl && req.headers.origin !== new URL(env.miniAppUrl).origin && req.headers.origin !== "http://127.0.0.1:5173") throw new AppError(403, "Origin not allowed.");
        const operator = await authenticate(req);
        if (pathname === "/api/state" && req.method === "GET") { json(res, 200, await appState(operator)); return; }
        if (req.method !== "POST") throw new AppError(405, "Method not allowed.");
        const data = await body(req);
        if (pathname === "/api/rolls") {
          limit(`roll:${operator.id}`, 12);
          if (typeof data.id !== "string" || !uuid.test(data.id) || !positiveInt(data.targetPlayerId)) throw new AppError(400, "Invalid roll request.");
          const roll = await beginRoll(operator, { id: data.id, targetPlayerId: data.targetPlayerId, injuryFilters: data.injuryFilters });
          json(res, 200, { roll }); return;
        }
        const finish = /^\/api\/rolls\/([0-9a-f-]+)\/finish$/i.exec(pathname);
        if (finish && uuid.test(finish[1]!)) {
          const assignment = await finishRoll(operator, finish[1]!);
          await project(); json(res, 200, { assignment }); return;
        }
        if (pathname === "/api/complete") {
          const ids = data.assignmentIds;
          if (!positiveInt(data.targetPlayerId) || !Array.isArray(ids) || ids.length < 1 || ids.length > 1000 || !ids.every(positiveInt) || typeof data.nextOnly !== "boolean" || (data.nextOnly && ids.length !== 1)) throw new AppError(400, "Invalid completion request.");
          const completed = await completeAppAssignments(data.targetPlayerId, ids as number[], data.nextOnly);
          await project(); json(res, 200, { completed }); return;
        }
        if (pathname === "/api/dismiss") {
          if (!positiveInt(data.assignmentId)) throw new AppError(400, "Choose a valid roll.");
          const assignment = await dismissAppAssignment(operator, data.assignmentId);
          await project(); json(res, 200, { assignment }); return;
        }
        if (pathname === "/api/undo") {
          if (!positiveInt(data.assignmentId)) throw new AppError(400, "Choose a valid roll.");
          const assignment = await undoAppAssignment(operator, data.assignmentId);
          await project(); json(res, 200, { assignment }); return;
        }
        throw new AppError(404, "Not found.");
      }
      if (req.method !== "GET" && req.method !== "HEAD") throw new AppError(405, "Method not allowed.");
      const path = pathname === "/" ? "/index.html" : decodeURIComponent(pathname);
      const file = resolve(root, `.${path}`);
      if (!file.startsWith(root + sep) || !mime[extname(file)]) throw new AppError(404, "Not found.");
      let bytes;
      try { bytes = await readFile(file); } catch { throw new AppError(404, "Not found."); }
      res.writeHead(200, { "Content-Type": mime[extname(file)]!, "Cache-Control": path.startsWith("/assets/") ? "public, max-age=31536000, immutable" : "no-cache" });
      res.end(req.method === "HEAD" ? undefined : bytes);
    } catch (error) {
      const status = error instanceof AppError ? error.status : 500;
      if (status === 500) logger.error({ error: String(error) }, "Mini App request failed");
      if (!res.headersSent) json(res, status, { error: error instanceof AppError ? error.message : "Something went wrong. Try again; saved rolls are kept." });
      else res.end();
    }
  });
  server.requestTimeout = 15_000;
  server.headersTimeout = 10_000;
  server.on("close", () => clearInterval(retry));
  return server;
}
