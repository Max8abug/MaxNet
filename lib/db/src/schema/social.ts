import { pgTable, serial, text, timestamp, integer, boolean, varchar, jsonb, index, uniqueIndex } from "drizzle-orm/pg-core";

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
  room: text("room").notNull().default("lobby"),
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
  darkBackgroundUrl: text("dark_background_url"),
  backgroundColor: text("background_color"),
  rank: text("rank"),
  timeZone: text("time_zone"),
  // Persistent cafe character: { color: string, hat: string, accessory: string | null }.
  // Saved by the in-cafe character editor so users keep their look across sessions.
  cafeAvatar: jsonb("cafe_avatar").notNull().default({}),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  // Bumped (throttled to ~once a minute) by the auth middleware whenever a
  // logged-in user makes a request, so the user list can show online status
  // and a "last seen" timestamp.
  lastSeen: timestamp("last_seen").defaultNow().notNull(),
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

export const musicPlaylistsTable = pgTable("music_playlists", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  createdBy: text("created_by").notNull(),
  trackIds: jsonb("track_ids").notNull().default([]),
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
  groupId: integer("group_id"),
  body: text("body").notNull().default(""),
  imageUrl: text("image_url"),
  readAt: timestamp("read_at"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const dmGroupsTable = pgTable("dm_groups", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  createdBy: text("created_by").notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const dmGroupMembersTable = pgTable("dm_group_members", {
  id: serial("id").primaryKey(),
  groupId: integer("group_id").notNull(),
  username: text("username").notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const dmReportsTable = pgTable("dm_reports", {
  id: serial("id").primaryKey(),
  messageId: integer("message_id").notNull(),
  reporter: text("reporter").notNull(),
  reason: text("reason").notNull().default(""),
  status: text("status").notNull().default("open"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  reviewedAt: timestamp("reviewed_at"),
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
  votes: jsonb("votes").notNull().default({}),
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

// Admin-uploaded custom cafe rooms. The `slug` is the value stored in
// cafe_settings.theme when the room is active. Built-in themes (cafe, library,
// holiday, park, city) are NOT stored here — they're hard-coded in the client.
export const cafeRoomsTable = pgTable("cafe_rooms", {
  id: serial("id").primaryKey(),
  slug: text("slug").notNull().unique(),
  name: text("name").notNull(),
  backgroundDataUrl: text("background_data_url").notNull(),
  floorColor: text("floor_color").notNull().default("#444444"),
  createdBy: text("created_by").notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

// Admin-placed clickable objects within a cafe room. `room` matches a built-in
// theme slug or a cafeRoomsTable.slug. Coordinates are in the cafe's 800×500
// world space.
export const cafeObjectsTable = pgTable("cafe_objects", {
  id: serial("id").primaryKey(),
  room: text("room").notNull(),
  name: text("name").notNull(),
  x: integer("x").notNull(),
  y: integer("y").notNull(),
  width: integer("width").notNull().default(48),
  height: integer("height").notNull().default(48),
  emoji: text("emoji"),
  drawingDataUrl: text("drawing_data_url"),
  actionType: text("action_type").notNull(),
  actionValue: text("action_value").notNull(),
  createdBy: text("created_by").notNull(),
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

export const chatMutesTable = pgTable("chat_mutes", {
  id: serial("id").primaryKey(),
  username: text("username").notNull().unique(),
  mutedBy: text("muted_by").notNull(),
  reason: text("reason").notNull().default(""),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

// Track which IPs each registered username has logged in from. Used by the admin
// "scan IPs" tool to detect alts (multiple usernames coming from the same address).
export const userIpsTable = pgTable("user_ips", {
  id: serial("id").primaryKey(),
  username: text("username").notNull(),
  ip: text("ip").notNull(),
  firstSeen: timestamp("first_seen").defaultNow().notNull(),
  lastSeen: timestamp("last_seen").defaultNow().notNull(),
  hits: integer("hits").notNull().default(1),
}, (t) => ({
  byUser: index("user_ips_username_idx").on(t.username),
  byIp: index("user_ips_ip_idx").on(t.ip),
}));

// IP-level bans. Any request coming from one of these IPs is blocked from
// signing up or logging in (existing sessions on those IPs still work until
// they log out — a soft restriction so we don't accidentally lock everyone out
// behind a shared NAT mid-session).
export const ipBansTable = pgTable("ip_bans", {
  id: serial("id").primaryKey(),
  ip: text("ip").notNull().unique(),
  bannedBy: text("banned_by").notNull().default("admin"),
  reason: text("reason").notNull().default(""),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

// Browser-scoped moderation signals. The server stores only a hash of the
// opaque cookie value; this is not a hardware identifier or fingerprint.
export const deviceTokensTable = pgTable("device_tokens", {
  id: serial("id").primaryKey(),
  tokenHash: text("token_hash").notNull().unique(),
  status: text("status").notNull().default("active"),
  reason: text("reason").notNull().default(""),
  flaggedBy: text("flagged_by"),
  firstSeen: timestamp("first_seen").defaultNow().notNull(),
  lastSeen: timestamp("last_seen").defaultNow().notNull(),
  reviewedAt: timestamp("reviewed_at"),
  reviewedBy: text("reviewed_by"),
}, (t) => ({
  statusIdx: index("device_tokens_status_idx").on(t.status),
}));

export const deviceAssociationsTable = pgTable("device_associations", {
  id: serial("id").primaryKey(),
  deviceTokenId: integer("device_token_id").notNull(),
  userId: integer("user_id").notNull(),
  username: text("username").notNull(),
  firstSeen: timestamp("first_seen").defaultNow().notNull(),
  lastSeen: timestamp("last_seen").defaultNow().notNull(),
}, (t) => ({
  deviceIdx: index("device_associations_device_idx").on(t.deviceTokenId),
  userIdx: index("device_associations_user_idx").on(t.userId),
  uniqueAssociation: uniqueIndex("device_associations_device_user_idx").on(t.deviceTokenId, t.userId),
}));

export const deviceAppealsTable = pgTable("device_appeals", {
  id: serial("id").primaryKey(),
  deviceTokenId: integer("device_token_id").notNull(),
  userId: integer("user_id").notNull(),
  username: text("username").notNull(),
  message: text("message").notNull(),
  status: text("status").notNull().default("open"),
  adminResponse: text("admin_response").notNull().default(""),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  reviewedAt: timestamp("reviewed_at"),
  reviewedBy: text("reviewed_by"),
}, (t) => ({
  deviceIdx: index("device_appeals_device_idx").on(t.deviceTokenId),
  statusIdx: index("device_appeals_status_idx").on(t.status),
  userIdx: index("device_appeals_user_idx").on(t.userId),
}));

// Site news / announcements posted by moderators+. Each post can carry an
// arbitrary number of inline image attachments stored as data URLs (capped on
// the API side so total payload stays sane).
export const newsPostsTable = pgTable("news_posts", {
  id: serial("id").primaryKey(),
  author: text("author").notNull(),
  title: text("title").notNull().default(""),
  body: text("body").notNull().default(""),
  images: jsonb("images").notNull().default([]),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export const newsCommentsTable = pgTable("news_comments", {
  id: serial("id").primaryKey(),
  newsPostId: integer("news_post_id").notNull(),
  author: text("author").notNull(),
  body: text("body").notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

// Site-wide settings (singleton row, id=1) — owner-configurable branding such as the start-menu logo.
// vapidPublicKey/vapidPrivateKey are auto-generated on first server startup and persisted here so
// browser push subscriptions remain valid across restarts.
export const siteSettingsTable = pgTable("site_settings", {
  id: serial("id").primaryKey(),
  logoDataUrl: text("logo_data_url").notNull().default(""),
  darkLogoDataUrl: text("dark_logo_data_url").notNull().default(""),
  backgroundDataUrl: text("background_data_url").notNull().default(""),
  darkBackgroundDataUrl: text("dark_background_data_url").notNull().default(""),
  mobileBackgroundDataUrl: text("mobile_background_data_url").notNull().default(""),
  mobileDarkBackgroundDataUrl: text("mobile_dark_background_data_url").notNull().default(""),
  chatCooldownEnabled: boolean("chat_cooldown_enabled").notNull().default(true),
  siteName: text("site_name").notNull().default("Portfolio 98"),
  vapidPublicKey: text("vapid_public_key").notNull().default(""),
  vapidPrivateKey: text("vapid_private_key").notNull().default(""),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

// Web Push subscriptions — one row per (user, browser/device). Used to send
// browser-level notifications (via the Push API + Service Worker) when the
// user has the site closed but the browser is still running. The endpoint
// uniquely identifies the subscription on the push service.
export const pushSubscriptionsTable = pgTable("push_subscriptions", {
  id: serial("id").primaryKey(),
  username: text("username").notNull(),
  endpoint: text("endpoint").notNull().unique(),
  p256dh: text("p256dh").notNull(),
  auth: text("auth").notNull(),
  userAgent: text("user_agent").notNull().default(""),
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
  passwordHash: text("password_hash"),
  pinned: boolean("pinned").notNull().default(false),
  lastActivityAt: timestamp("last_activity_at").defaultNow().notNull(),
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
  queue: jsonb("queue").notNull().default([]),
  skipVotes: jsonb("skip_votes").notNull().default({}),
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
