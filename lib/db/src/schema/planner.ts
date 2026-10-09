import { pgTable, serial, text, date, timestamp, boolean, index } from "drizzle-orm/pg-core";
import { usersTable } from "./social";

export const plannerEntriesTable = pgTable("planner_entries", {
  id: serial("id").primaryKey(),
  username: text("username").notNull().references(() => usersTable.username, { onDelete: "cascade" }),
  kind: text("kind").notNull(),
  title: text("title").notNull(),
  notes: text("notes").notNull().default(""),
  day: date("day", { mode: "string" }).notNull(),
  startsAt: timestamp("starts_at", { withTimezone: true }),
  remindAt: timestamp("remind_at", { withTimezone: true }),
  notifiedAt: timestamp("notified_at", { withTimezone: true }),
  dismissed: boolean("dismissed").notNull().default(false),
}, (table) => [index("planner_user_day_idx").on(table.username, table.day)]);
