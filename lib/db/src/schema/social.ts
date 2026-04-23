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
  imageUrl: text("image_url"),
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
  avatarUrl: text("avatar_url"),
  backgroundUrl: text("background_url"),
  backgroundColor: text("background_color"),
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

// Generalized moderation audit log across chat, guestbook, drawings, forum
export const chatAuditTable = pgTable("chat_audit_log", {
  id: serial("id").primaryKey(),
  area: text("area").notNull().default("chat"),
  action: text("action").notNull(),
  actor: text("actor").notNull(),
  target: text("target").notNull().default(""),
  body: text("body").notNull().default(""),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

// Forum
export const forumThreadsTable = pgTable("forum_threads", {
  id: serial("id").primaryKey(),
  title: text("title").notNull(),
  author: text("author").notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const forumPostsTable = pgTable("forum_posts", {
  id: serial("id").primaryKey(),
  threadId: integer("thread_id").notNull(),
  author: text("author").notNull(),
  body: text("body").notNull(),
  imageUrl: text("image_url"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

// Synchronized YouTube playback (singleton row id=1)
export const youtubeSyncTable = pgTable("youtube_sync", {
  id: serial("id").primaryKey(),
  videoId: text("video_id").notNull().default(""),
  startedAt: timestamp("started_at").defaultNow().notNull(),
  setBy: text("set_by").notNull().default(""),
});

// Blackjack
export const blackjackTablesTable = pgTable("blackjack_tables", {
  id: serial("id").primaryKey(),
  name: text("name").notNull().default("Table 1"),
  state: jsonb("state").notNull().default({}),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

// Flappy: per-session obstacles + live player positions + scores
export const flappyPlayersTable = pgTable("flappy_players", {
  username: text("username").primaryKey(),
  y: integer("y").notNull().default(0),
  score: integer("score").notNull().default(0),
  alive: boolean("alive").notNull().default(true),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export const flappyScoresTable = pgTable("flappy_scores", {
  id: serial("id").primaryKey(),
  username: text("username").notNull(),
  score: integer("score").notNull(),
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
