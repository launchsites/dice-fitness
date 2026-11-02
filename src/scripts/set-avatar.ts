import { readFile, stat } from "node:fs/promises";
import { Bot } from "grammy";
import { env } from "../config/env.js";
import { closeDatabase } from "../db/client.js";
import { setPlayerAvatar } from "../services/avatar-service.js";
import { AppError } from "../web/errors.js";

try {
  const [targetValue, operatorValue, file] = process.argv.slice(2);
  const target = Number(targetValue), operator = Number(operatorValue);
  if (![target, operator].every((value) => Number.isSafeInteger(value) && value > 0) || !file) throw new AppError(400, "Use set-avatar <targetTelegramId> <adminTelegramId> <imagePath|--remove>.");
  if (file !== "--remove" && (await stat(file)).size > 1024 * 1024) throw new AppError(400, "Use a profile image smaller than 1 MB.");
  console.log(JSON.stringify({ ok: true, ...await setPlayerAvatar(new Bot(env.botToken).api, target, operator, file === "--remove" ? null : await readFile(file)) }));
} catch (error) {
  console.log(JSON.stringify({ ok: false, error: error instanceof AppError ? error.message : "Could not update the avatar. Check the image and admin access." }));
  process.exitCode = 1;
} finally { await closeDatabase(); }
