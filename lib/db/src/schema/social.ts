import { pgTable, serial, text, timestamp, integer, boolean, varchar, jsonb, index } from "drizzle-orm/pg-core";

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

export const usersTable = pgTable("users", {
  id: serial("id").primaryKey(),
  username: text("username").notNull().unique(),
  passwordHash: text("password_hash").notNull(),
  isAdmin: boolean("is_admin").notNull().default(false),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const guestbookTable = pgTable("guestbook_entries", {
  id: serial("id").primaryKey(),
  author: text("author").notNull().default("anon"),
  body: text("body").notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const photosTable = pgTable("photos", {
  id: serial("id").primaryKey(),
  caption: text("caption").notNull().default(""),
  dataUrl: text("data_url").notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const bannedUsersTable = pgTable("banned_users", {
  id: serial("id").primaryKey(),
  username: text("username").notNull().unique(),
  bannedBy: text("banned_by").notNull(),
  reason: text("reason").notNull().default(""),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const chatAuditTable = pgTable("chat_audit_log", {
  id: serial("id").primaryKey(),
  action: text("action").notNull(), // 'post' | 'delete' | 'clear' | 'ban' | 'unban' | 'blocked'
  actor: text("actor").notNull(),
  target: text("target").notNull().default(""),
  body: text("body").notNull().default(""),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const sessionsTable = pgTable(
  "session",
  {
    sid: varchar("sid").primaryKey(),
    sess: jsonb("sess").notNull(),
    expire: timestamp("expire", { precision: 6 }).notNull(),
  },
  (t) => ({
    expireIdx: index("IDX_session_expire").on(t.expire),
  }),
);
