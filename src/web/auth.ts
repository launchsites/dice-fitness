import { createHmac, timingSafeEqual } from "node:crypto";

export type TelegramUser = { id: number; first_name: string; last_name?: string; username?: string; is_bot?: boolean };

/** Verify Telegram's original query string before trusting any user-supplied fields. */
export function verifyInitData(raw: string, botToken: string, clock = Date.now()): TelegramUser {
  if (!raw || raw.length > 8192) throw new Error("Open Dice Fitness from Telegram.");
  const values = new URLSearchParams(raw);
  const keys = [...values.keys()];
  if (new Set(keys).size !== keys.length) throw new Error("Invalid Telegram session.");
  const hash = values.get("hash") || "";
  if (!/^[a-f0-9]{64}$/i.test(hash)) throw new Error("Invalid Telegram session.");
  values.delete("hash");
  const dataCheck = [...values.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([key, value]) => `${key}=${value}`).join("\n");
  const secret = createHmac("sha256", "WebAppData").update(botToken).digest();
  const expected = createHmac("sha256", secret).update(dataCheck).digest();
  if (!timingSafeEqual(expected, Buffer.from(hash, "hex"))) throw new Error("Invalid Telegram session.");
  const authDate = Number(values.get("auth_date"));
  const age = Math.floor(clock / 1000) - authDate;
  if (!Number.isSafeInteger(authDate) || age < -30 || age > 86400) throw new Error("Session expired. Close and reopen Dice Fitness.");
  let user: TelegramUser;
  try { user = JSON.parse(values.get("user") || "null") as TelegramUser; } catch { throw new Error("Invalid Telegram user."); }
  if (!user || !Number.isSafeInteger(user.id) || user.id <= 0 || typeof user.first_name !== "string" || user.is_bot) throw new Error("Invalid Telegram user.");
  return user;
}
