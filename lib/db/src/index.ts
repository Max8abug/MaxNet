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

export * from "./schema";
