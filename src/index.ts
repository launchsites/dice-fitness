import { migrate } from "drizzle-orm/node-postgres/migrator";
import { createBot, initialiseGame } from "./bot/index.js";
import { db, closeDatabase } from "./db/client.js";
import { logger } from "./logger.js";

const bot = createBot();
let stopping = false;

async function shutdown(signal: string): Promise<void> {
  if (stopping) return;
  stopping = true;
  logger.info({ signal }, "Shutting down gracefully");
  bot.stop();
  await closeDatabase();
  process.exit(0);
}

try {
  await migrate(db, { migrationsFolder: "drizzle" });
  await initialiseGame(bot);
  bot.start({ onStart: (info) => logger.info({ username: info.username }, "Long polling started") });
  process.once("SIGINT", () => void shutdown("SIGINT"));
  process.once("SIGTERM", () => void shutdown("SIGTERM"));
} catch (error) {
  logger.fatal({ err: error }, "Bot startup failed");
  await closeDatabase();
  process.exit(1);
}
