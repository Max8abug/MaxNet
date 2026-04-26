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
import { ensureSchema } from "../lib/ensure-schema";
import { logger } from "../lib/logger";

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
  // Self-heal first: if the live DB is missing a column the Drizzle table
  // expects, `db.select().from(t.table)` will throw with "column ... does
  // not exist" and we'd silently emit an empty array for that table —
  // producing a backup that LOOKS fine but is missing data. Running the
  // idempotent bootstrap closes that gap before we read anything. Failure
  // here doesn't abort the export (we still want to grab whatever we can),
  // but it's logged so the operator can investigate.
  try {
    await ensureSchema();
  } catch (e) {
    logger.warn({ err: e }, "ensureSchema failed before export — continuing anyway");
  }

  const data: Record<string, any[]> = {};
  const tableErrors: Record<string, string> = {};
  for (const t of TABLES) {
    try {
      data[t.name] = await db.select().from(t.table);
    } catch (e: any) {
      data[t.name] = [];
      tableErrors[t.name] = e?.message || "select failed";
    }
  }
  res.setHeader("Content-Disposition", `attachment; filename="site-backup-${new Date().toISOString().slice(0, 10)}.json"`);
  res.json({
    version: 1,
    exportedAt: new Date().toISOString(),
    tables: data,
    // Surface per-table read errors so the diagnostics UI can warn the
    // operator that some tables came back empty due to schema drift rather
    // than because they were genuinely empty.
    tableErrors: Object.keys(tableErrors).length > 0 ? tableErrors : undefined,
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

  // Self-heal the live schema BEFORE we touch any data. If a backup file
  // contains columns the live DB doesn't have yet (very common after
  // pushing schema changes through GitHub → prod without a migration step),
  // the per-row insert below would crash with "column ... does not exist"
  // and we'd roll the whole transaction back. Running the idempotent
  // bootstrap first closes that gap. This is the one self-contained step
  // that turns "import failed with HTTP 500" into "import succeeded" for
  // the schema-drift case the user is actually hitting.
  let healError: string | null = null;
  try {
    await ensureSchema();
  } catch (e: any) {
    // Continue — most failures here are non-fatal (e.g. concurrent DDL).
    // We still surface the message in the response so the operator knows
    // why a follow-up insert error might be unavoidable.
    healError = e?.message || "ensureSchema failed";
    logger.warn({ err: e }, "ensureSchema failed before import — continuing");
  }

  // Use a single transaction so a partial restore doesn't leave the site in
  // a half-broken state. TRUNCATE ... CASCADE clears all FK-referenced rows
  // in one shot so we can re-insert in dependency order without juggling
  // constraint deferral.
  const importedTables: string[] = [];
  const tableRowCounts: Record<string, number> = {};
  const errors: { table: string; error: string }[] = [];
  let totalRows = 0;
  let stage = "begin";
  try {
    await db.transaction(async (tx) => {
      // Only TRUNCATE tables that actually exist on the live DB. If
      // ensureSchema couldn't create one for whatever reason, listing it in
      // the TRUNCATE statement would abort the entire transaction with
      // "relation does not exist" — exactly the silent 500 the operator is
      // trying to escape.
      stage = "discover existing tables";
      const existing = await tx.execute<{ table_name: string }>(sql.raw(
        `SELECT table_name FROM information_schema.tables
          WHERE table_schema = 'public'
            AND table_name = ANY(ARRAY[${TABLES.map((t) => `'${t.pgName}'`).join(", ")}])`,
      ));
      const existingNames = new Set<string>(existing.rows.map((r: any) => r.table_name));
      const truncatable = TABLES.filter((t) => existingNames.has(t.pgName));
      if (truncatable.length > 0) {
        stage = "TRUNCATE";
        const tableList = truncatable.map((t) => `"${t.pgName}"`).join(", ");
        // CASCADE handles cross-table dependencies; RESTART IDENTITY zeroes the
        // serial sequences so re-inserted ids don't clash with future inserts.
        await tx.execute(sql.raw(`TRUNCATE TABLE ${tableList} RESTART IDENTITY CASCADE`));
      }

      for (const t of TABLES) {
        const rows = tables[t.name];
        if (!Array.isArray(rows) || rows.length === 0) continue;
        if (!existingNames.has(t.pgName)) {
          // ensureSchema didn't create this table and the backup has rows
          // for it — record the loss and keep going so the rest of the
          // restore still lands. Skipping is strictly safer than aborting
          // the whole transaction for one stale table.
          errors.push({ table: t.name, error: `table "${t.pgName}" does not exist on live DB; skipped ${rows.length} row(s)` });
          continue;
        }
        stage = `INSERT into ${t.pgName}`;
        try {
          // Filter each row down to columns that actually exist on the
          // live table. Backups taken from a newer schema can carry
          // columns the production DB hasn't received yet — we'd rather
          // drop those values than crash the whole restore. We discover
          // the live column set with one query per table inside the same
          // transaction, then strip unknown keys before insert.
          const colsRes = await tx.execute<{ column_name: string }>(sql.raw(
            `SELECT column_name FROM information_schema.columns
              WHERE table_schema = 'public' AND table_name = '${t.pgName}'`,
          ));
          const liveCols = new Set<string>(colsRes.rows.map((r: any) => r.column_name));

          // Drizzle expects Date objects for timestamp columns; the JSON
          // round-trip turned them into strings. Re-hydrate any value whose
          // key looks like a timestamp into a Date so insert doesn't choke.
          // We also key the strip-unknown logic off Drizzle's internal
          // mapping so JS-side camelCase column names get translated to
          // their snake_case Postgres counterparts before the membership
          // check.
          const cfg: any = (t.table as any)[Symbol.for("drizzle:Columns")] || {};
          const jsToPg = new Map<string, string>();
          for (const [jsName, col] of Object.entries(cfg)) {
            const pg = (col as any)?.name;
            if (typeof pg === "string") jsToPg.set(jsName, pg);
          }
          const fixed: Record<string, any>[] = [];
          for (const r of rows) {
            const out: Record<string, any> = {};
            for (const [k, v] of Object.entries(r)) {
              const pg = jsToPg.get(k) || k;
              if (!liveCols.has(pg)) continue; // silently drop unknown col
              if (typeof v === "string"
                && /(_at|At|Seen|firstSeen|lastSeen|createdAt|updatedAt)$/.test(k)
                && /^\d{4}-\d{2}-\d{2}T/.test(v)) {
                out[k] = new Date(v);
              } else {
                out[k] = v;
              }
            }
            fixed.push(out);
          }
          // Insert in chunks so very large tables don't blow past Postgres's
          // parameter limit (~65k bound vars per statement).
          const CHUNK = 500;
          for (let i = 0; i < fixed.length; i += CHUNK) {
            const slice = fixed.slice(i, i + CHUNK);
            await tx.insert(t.table).values(slice as any);
          }
          importedTables.push(t.name);
          tableRowCounts[t.name] = rows.length;
          totalRows += rows.length;
        } catch (e: any) {
          errors.push({ table: t.name, error: e?.message || "insert failed" });
          throw e;
        }
      }

      // After inserting rows with fixed ids, the sequences still point to 1.
      // Bump each serial sequence to max(id)+1 so future inserts don't collide.
      stage = "reset sequences";
      for (const t of truncatable) {
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

    res.json({
      ok: true,
      imported: importedTables,
      totalRows,
      tableRowCounts,
      skipped: errors,
      healWarning: healError,
    });
  } catch (e: any) {
    logger.error({ err: e, stage }, "Backup import failed");
    res.status(500).json({
      ok: false,
      error: e?.message || "Import failed",
      stage,
      errors,
      partial: importedTables,
      healWarning: healError,
    });
  }
});

export default router;
