import { pgTable, serial, text, timestamp, integer, boolean, varchar, jsonb, index } from "drizzle-orm/pg-core";

export const drawingsTable = pgTable("drawings", {
  id: serial("id").primaryKey(),
  author: text("author").notNull().default("anon"),
  dataUrl: text("data_url").notNull(),
  votes: jsonb("votes").notNull().default({}),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const chatMessagesTable = pgTable("chat_messages", {
  id: serial("id").primaryKey(),
  author: text("author").notNull().default("anon"),
  body: text("body").notNull(),
  imageUrl: text("image_url"),
  videoUrl: text("video_url"),
  replyTo: integer("reply_to"),
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
  rank: text("rank"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const ranksTable = pgTable("ranks", {
  id: serial("id").primaryKey(),
  name: text("name").notNull().unique(),
  color: text("color").notNull().default("#888888"),
  permissions: jsonb("permissions").notNull().default([]),
  tier: integer("tier").notNull().default(1),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const tracksTable = pgTable("tracks", {
  id: serial("id").primaryKey(),
  uploader: text("uploader").notNull(),
  title: text("title").notNull(),
  dataUrl: text("data_url").notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const pollsTable = pgTable("polls", {
  id: serial("id").primaryKey(),
  question: text("question").notNull(),
  creator: text("creator").notNull(),
  options: jsonb("options").notNull().default([]),
  votes: jsonb("votes").notNull().default({}),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const dmsTable = pgTable("dms", {
  id: serial("id").primaryKey(),
  fromUser: text("from_user").notNull(),
  toUser: text("to_user").notNull(),
  body: text("body").notNull().default(""),
  imageUrl: text("image_url"),
  readAt: timestamp("read_at"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const chessLobbiesTable = pgTable("chess_lobbies", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  hostUser: text("host_user").notNull(),
  whiteUser: text("white_user"),
  blackUser: text("black_user"),
  fen: text("fen").notNull().default("rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1"),
  moves: jsonb("moves").notNull().default([]),
  status: text("status").notNull().default("waiting"),
  winner: text("winner"),
  chat: jsonb("chat").notNull().default([]),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const userPagesTable = pgTable("user_pages", {
  username: text("username").primaryKey(),
  dataUrl: text("data_url").notNull(),
  elements: jsonb("elements").notNull().default([]),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export const cafePresenceTable = pgTable("cafe_presence", {
  username: text("username").primaryKey(),
  x: integer("x").notNull().default(200),
  y: integer("y").notNull().default(200),
  avatar: jsonb("avatar").notNull().default({}),
  lastSeen: timestamp("last_seen").defaultNow().notNull(),
});

export const cafeChatTable = pgTable("cafe_chat", {
  id: serial("id").primaryKey(),
  author: text("author").notNull(),
  body: text("body").notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const cafeSettingsTable = pgTable("cafe_settings", {
  id: serial("id").primaryKey(),
  theme: text("theme").notNull().default("cafe"),
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

// Site-wide settings (singleton row, id=1) — owner-configurable branding such as the start-menu logo.
export const siteSettingsTable = pgTable("site_settings", {
  id: serial("id").primaryKey(),
  logoDataUrl: text("logo_data_url").notNull().default(""),
  siteName: text("site_name").notNull().default("Portfolio 98"),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
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
  passwordHash: text("password_hash"),
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
