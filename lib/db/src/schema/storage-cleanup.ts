import { pgTable, text, integer, timestamp, primaryKey, index } from "drizzle-orm/pg-core";

export const storageCleanupTable = pgTable("storage_cleanup", {
  scope: text("scope").notNull(),
  objectKey: text("object_key").notNull(),
  lockKey: text("lock_key").notNull(),
  attempts: integer("attempts").notNull().default(0),
  nextAttemptAt: timestamp("next_attempt_at", { withTimezone: true }).notNull().defaultNow(),
}, table => [
  primaryKey({ columns: [table.scope, table.objectKey] }),
  index("storage_cleanup_due_idx").on(table.nextAttemptAt),
]);
