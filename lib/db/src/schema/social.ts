import { pgTable, serial, text, timestamp, integer } from "drizzle-orm/pg-core";

export const drawingsTable = pgTable("drawings", {
  id: serial("id").primaryKey(),
  author: text("author").notNull().default("anon"),
  dataUrl: text("data_url").notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const chatMessagesTable = pgTable("chat_messages", {
  id: serial("id").primaryKey(),
  author: text("author").notNull().default("anon"),
  body: text("body").notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const visitCounterTable = pgTable("visit_counter", {
  id: serial("id").primaryKey(),
  count: integer("count").notNull().default(0),
});
