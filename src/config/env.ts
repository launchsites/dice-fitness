import "dotenv/config";

function required(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`Missing required environment variable: ${name}`);
  return value;
}

const chatId = Number(required("GAME_CHAT_ID"));
if (!Number.isSafeInteger(chatId)) throw new Error("GAME_CHAT_ID must be a numeric Telegram chat ID");

export const env = {
  botToken: required("BOT_TOKEN"),
  databaseUrl: required("DATABASE_URL"),
  gameChatId: chatId,
  timezone: process.env.TZ || "Europe/London",
  logLevel: process.env.LOG_LEVEL || "info",
  miniAppUrl: process.env.MINI_APP_URL?.trim() || "",
  miniAppEnabled: process.env.MINI_APP_ENABLED === "true",
  botUsername: process.env.BOT_USERNAME?.trim() || "dicefitnessbot",
  port: Number(process.env.PORT || 3000),
} as const;
