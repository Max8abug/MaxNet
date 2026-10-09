import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import * as schema from "./schema";

const { Pool } = pg;

if (!process.env.DATABASE_URL) {
  throw new Error(
    "DATABASE_URL must be set. Did you forget to provision a database?",
  );
}

// Timestamp columns are normalized as UTC wall-clock values for legacy
// compatibility. Lock every PostgreSQL session to UTC so node-postgres cannot
// reinterpret the same value differently depending on the host timezone.
export const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  options: "-c timezone=UTC",
});
export const db = drizzle(pool, { schema });

// Upload intents must commit independently of the file-metadata transaction.
// Reserve a separate small pool so writers waiting on advisory locks cannot
// exhaust the main pool and deadlock the intent write.
export const storageJournalPool = new Pool({
  connectionString: process.env.DATABASE_URL,
  options: "-c timezone=UTC",
  max: 2,
});

export * from "./schema";
