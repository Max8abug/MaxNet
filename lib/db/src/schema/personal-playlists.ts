import { index, integer, jsonb, pgTable, serial, text, timestamp } from "drizzle-orm/pg-core";
import { usersTable } from "./social";

export const personalYouTubePlaylistsTable = pgTable("personal_youtube_playlists", {
  id: serial("id").primaryKey(),
  username: text("username").notNull().references(() => usersTable.username, { onDelete: "cascade" }),
  name: text("name").notNull(),
  revision: integer("revision").notNull().default(0),
  tracks: jsonb("tracks").$type<{ id: string; videoId: string; title: string }[]>().notNull().default([]),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [index("personal_youtube_playlists_user_idx").on(table.username)]);
