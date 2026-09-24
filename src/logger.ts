import pino from "pino";
import { env } from "./config/env.js";

export const logger = pino({ level: env.logLevel, redact: ["token", "BOT_TOKEN", "botToken", "req.headers.authorization"] });
