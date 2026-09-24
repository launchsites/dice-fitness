import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import { env } from "../config/env.js";
import * as schema from "./schema.js";

export const pool = new Pool({ connectionString: env.databaseUrl, max: 10 });
export const db = drizzle(pool, { schema });

export async function closeDatabase(): Promise<void> { await pool.end(); }
