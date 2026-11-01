import { Bot } from "grammy";
import { env } from "../config/env.js";
import { closeDatabase } from "../db/client.js";
import { debtSnapshot, replaceCoreDebt } from "../services/debt-maintenance.js";
import { refreshLeaderboard } from "../services/projection-service.js";
import { AppError } from "../web/errors.js";
const report = (value: unknown) => JSON.stringify(value, (key, item) => ["groupId", "telegramUserId", "username"].includes(key) ? undefined : item);

try {
  const [mode, targetValue, operatorValue, expected, batch] = process.argv.slice(2);
  const target = Number(targetValue), operator = Number(operatorValue);
  if (![target, operator].every((value) => Number.isSafeInteger(value) && value > 0)) throw new AppError(400, "Provide target and operator Telegram IDs.");
  if (mode === "plan") console.log(report({ ok: true, mode, snapshot: await debtSnapshot(target, operator) }));
  else if (mode === "apply" && /^[0-9a-f]{64}$/.test(expected ?? "") && /^[0-9a-f-]{36}$/.test(batch ?? "")) {
    const result = await replaceCoreDebt(target, operator, expected!, batch!);
    let leaderboardRefreshed = false;
    try { await refreshLeaderboard(new Bot(env.botToken).api, true); leaderboardRefreshed = true; } catch { /* Database result is durable; retry the same batch to refresh. */ }
    console.log(report({ ok: true, mode, ...result, leaderboardRefreshed }));
  } else throw new AppError(400, "Use plan, or apply with the snapshot fingerprint and a unique batch UUID.");
} catch (error) {
  console.log(JSON.stringify({ ok: false, error: error instanceof AppError ? error.message : "Operation failed. Inspect safely before retrying; the same batch ID prevents duplicates." }));
  process.exitCode = 1;
} finally { await closeDatabase(); }
