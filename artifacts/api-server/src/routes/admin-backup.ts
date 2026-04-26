import { Router, type IRouter } from "express";
import {
  db,
  drawingsTable,
  chatMessagesTable,
  visitCounterTable,
  usersTable,
  ranksTable,
  tracksTable,
  pollsTable,
  dmsTable,
  chessLobbiesTable,
  userPagesTable,
  cafePresenceTable,
  cafeChatTable,
  cafeSettingsTable,
  cafeRoomsTable,
  cafeObjectsTable,
  guestbookTable,
  photosTable,
  bannedUsersTable,
  userIpsTable,
  ipBansTable,
  newsPostsTable,
  siteSettingsTable,
  chatAuditTable,
  forumThreadsTable,
  forumPostsTable,
  youtubeSyncTable,
  blackjackTablesTable,
  flappyPlayersTable,
  flappyScoresTable,
} from "@workspace/db";
import { sql } from "drizzle-orm";
import { requireAdmin } from "../lib/auth";

const router: IRouter = Router();

// Centralized list of every table the backup tool understands. Order matters:
// when restoring we insert parents before children so foreign-key constraints
// stay happy. The session table is intentionally omitted — restoring it would
// log out whichever admin is performing the restore (and stale sessions across
// machines are rarely useful anyway).
type Entry = { name: string; pgName: string; table: any };
const TABLES: Entry[] = [
  { name: "users", pgName: "users", table: usersTable },
  { name: "ranks", pgName: "ranks", table: ranksTable },
  { name: "site_settings", pgName: "site_settings", table: siteSettingsTable },
  { name: "user_pages", pgName: "user_pages", table: userPagesTable },
  { name: "banned_users", pgName: "banned_users", table: bannedUsersTable },
  { name: "user_ips", pgName: "user_ips", table: userIpsTable },
  { name: "ip_bans", pgName: "ip_bans", table: ipBansTable },
  { name: "drawings", pgName: "drawings", table: drawingsTable },
  { name: "chat_messages", pgName: "chat_messages", table: chatMessagesTable },
  { name: "guestbook_entries", pgName: "guestbook_entries", table: guestbookTable },
  { name: "photos", pgName: "photos", table: photosTable },
  { name: "news_posts", pgName: "news_posts", table: newsPostsTable },
  { name: "polls", pgName: "polls", table: pollsTable },
  { name: "tracks", pgName: "tracks", table: tracksTable },
  { name: "dms", pgName: "dms", table: dmsTable },
  { name: "chess_lobbies", pgName: "chess_lobbies", table: chessLobbiesTable },
  { name: "cafe_settings", pgName: "cafe_settings", table: cafeSettingsTable },
  { name: "cafe_rooms", pgName: "cafe_rooms", table: cafeRoomsTable },
  { name: "cafe_objects", pgName: "cafe_objects", table: cafeObjectsTable },
  { name: "cafe_presence", pgName: "cafe_presence", table: cafePresenceTable },
  { name: "cafe_chat", pgName: "cafe_chat", table: cafeChatTable },
  { name: "forum_threads", pgName: "forum_threads", table: forumThreadsTable },
  { name: "forum_posts", pgName: "forum_posts", table: forumPostsTable },
  { name: "youtube_sync", pgName: "youtube_sync", table: youtubeSyncTable },
  { name: "blackjack_tables", pgName: "blackjack_tables", table: blackjackTablesTable },
  { name: "flappy_players", pgName: "flappy_players", table: flappyPlayersTable },
  { name: "flappy_scores", pgName: "flappy_scores", table: flappyScoresTable },
  { name: "visit_counter", pgName: "visit_counter", table: visitCounterTable },
  { name: "chat_audit_log", pgName: "chat_audit_log", table: chatAuditTable },
];

router.get("/admin/export", requireAdmin, async (_req, res) => {
  const data: Record<string, any[]> = {};
  for (const t of TABLES) {
    try { data[t.name] = await db.select().from(t.table); }
    catch { data[t.name] = []; }
  }
  res.setHeader("Content-Disposition", `attachment; filename="site-backup-${new Date().toISOString().slice(0, 10)}.json"`);
  res.json({
    version: 1,
    exportedAt: new Date().toISOString(),
    tables: data,
  });
});

router.post("/admin/import", requireAdmin, async (req, res) => {
  const payload = req.body ?? {};
  if (payload.confirm !== true) {
    res.status(400).json({ error: "Refusing to import without { confirm: true } — this replaces ALL site data." });
    return;
  }
  const tables = (payload.data && payload.data.tables) || payload.tables;
  if (!tables || typeof tables !== "object") {
    res.status(400).json({ error: "Backup payload missing `tables` object" });
    return;
  }

  // Use a single transaction so a partial restore doesn't leave the site in
  // a half-broken state. TRUNCATE ... CASCADE clears all FK-referenced rows
  // in one shot so we can re-insert in dependency order without juggling
  // constraint deferral.
  const importedTables: string[] = [];
  const errors: { table: string; error: string }[] = [];
  let totalRows = 0;
  try {
    await db.transaction(async (tx) => {
      const tableList = TABLES.map((t) => `"${t.pgName}"`).join(", ");
      // CASCADE handles cross-table dependencies; RESTART IDENTITY zeroes the
      // serial sequences so re-inserted ids don't clash with future inserts.
      await tx.execute(sql.raw(`TRUNCATE TABLE ${tableList} RESTART IDENTITY CASCADE`));

      for (const t of TABLES) {
        const rows = tables[t.name];
        if (!Array.isArray(rows) || rows.length === 0) continue;
        try {
          // Drizzle expects Date objects for timestamp columns; the JSON
          // round-trip turned them into strings. Re-hydrate any value whose
          // key looks like a timestamp into a Date so insert doesn't choke.
          const fixed = rows.map((r) => {
            const out: Record<string, any> = {};
            for (const [k, v] of Object.entries(r)) {
              if (typeof v === "string" && /(_at|At|Seen|firstSeen|lastSeen|createdAt|updatedAt)$/.test(k) && /^\d{4}-\d{2}-\d{2}T/.test(v)) {
                out[k] = new Date(v);
              } else {
                out[k] = v;
              }
            }
            return out;
          });
          // Insert in chunks so very large tables don't blow past Postgres's
          // parameter limit (~65k bound vars per statement).
          const CHUNK = 500;
          for (let i = 0; i < fixed.length; i += CHUNK) {
            const slice = fixed.slice(i, i + CHUNK);
            await tx.insert(t.table).values(slice as any);
          }
          importedTables.push(t.name);
          totalRows += rows.length;
        } catch (e: any) {
          errors.push({ table: t.name, error: e?.message || "insert failed" });
          throw e;
        }
      }

      // After inserting rows with fixed ids, the sequences still point to 1.
      // Bump each serial sequence to max(id)+1 so future inserts don't collide.
      for (const t of TABLES) {
        try {
          await tx.execute(sql.raw(`
            SELECT setval(
              pg_get_serial_sequence('"${t.pgName}"', 'id'),
              GREATEST((SELECT COALESCE(MAX(id), 0) FROM "${t.pgName}"), 1),
              true
            )
          `));
        } catch { /* table may not have an id sequence — ignore */ }
      }
    });

    res.json({ ok: true, imported: importedTables, totalRows });
  } catch (e: any) {
    res.status(500).json({ ok: false, error: e?.message || "Import failed", errors, partial: importedTables });
  }
});

export default router;
