import { migrate } from "drizzle-orm/node-postgres/migrator";
import { db, closeDatabase } from "./client.js";

try { await migrate(db, { migrationsFolder: "drizzle" }); }
finally { await closeDatabase(); }
