import { Router, type IRouter, json as expressJson } from "express";
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

  // STREAM the JSON response instead of building one giant string in memory.
  //
  // Why this matters: a real production site easily holds tens of thousands
  // of rows across drawings, photos, news posts, tracks, chat — many of
  // which carry data: URLs that are hundreds of KB each. The previous
  // implementation loaded every row into a single object and then handed
  // it to `res.json()`, which calls `JSON.stringify()` on the whole tree.
  // Two failure modes lurk there:
  //   1. V8's max string length (~512MB on 64-bit) — once the serialized
  //      payload crosses that, `JSON.stringify` throws "RangeError: Invalid
  //      string length" and the route 500s with no useful detail.
  //   2. Container memory limits on autoscale deploys — holding the full
  //      DB AND its serialized form simultaneously can OOM-kill the worker.
  //
  // Streaming sidesteps both: each row is stringified independently, written
  // to the socket, and freed. Memory stays bounded by the largest single row
  // (which Postgres caps at well under the 512MB string limit anyway). It
  // also flushes bytes to the proxy immediately, so request-level idle
  // timeouts don't fire while we're still building the response.
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader(
    "Content-Disposition",
    `attachment; filename="site-backup-${new Date().toISOString().slice(0, 10)}.json"`,
  );
  // Hint to any intermediary proxy not to buffer — we want bytes on the
  // wire as soon as we write them so idle-timeouts on long exports don't
  // fire even though the server is actively producing data.
  res.setHeader("X-Accel-Buffering", "no");
  res.setHeader("Cache-Control", "no-store");

  const tableErrors: Record<string, string> = {};
  let aborted = false;
  // If the client disconnects mid-stream there's no point continuing to
  // pull rows out of Postgres — we'd just heat up the DB for nothing.
  const onClose = () => { aborted = true; };
  res.on("close", onClose);

  // Helper that respects backpressure: when res.write returns false the
  // kernel buffer is full and we need to wait for "drain" before queueing
  // more bytes, otherwise memory growth on a slow client undoes the whole
  // point of streaming.
  const write = async (chunk: string): Promise<void> => {
    if (aborted) throw new Error("client disconnected");
    const ok = res.write(chunk);
    if (ok) return;
    await new Promise<void>((resolve) => res.once("drain", () => resolve()));
  };

  try {
    await write(`{"version":1,"exportedAt":${JSON.stringify(new Date().toISOString())},"tables":{`);

    let firstTable = true;
    for (const t of TABLES) {
      if (aborted) break;
      if (!firstTable) await write(",");
      firstTable = false;
      await write(`${JSON.stringify(t.name)}:[`);

      let rows: any[] = [];
      try {
        // We still pull each table in one query — Drizzle doesn't expose a
        // cursor API on the high-level builder. For pathological tables we
        // could swap in a paged SELECT later, but in practice the per-row
        // streaming below is what saves us, not the read itself.
        rows = await db.select().from(t.table);
      } catch (e: any) {
        tableErrors[t.name] = e?.message || "select failed";
        rows = [];
      }

      let firstRow = true;
      for (const row of rows) {
        if (aborted) break;
        let serialised: string;
        try {
          serialised = JSON.stringify(row);
        } catch (e: any) {
          // One bad row (e.g. a circular structure that somehow snuck in)
          // shouldn't sink the whole export. Skip it and surface the
          // problem in tableErrors so the operator sees something went
          // wrong rather than getting a silently-incomplete backup.
          tableErrors[t.name] =
            (tableErrors[t.name] ? tableErrors[t.name] + "; " : "") +
            `row serialise failed: ${e?.message || "unknown"}`;
          continue;
        }
        if (!firstRow) await write(",");
        firstRow = false;
        await write(serialised);
      }
      await write("]");
    }

    await write("}");
    if (Object.keys(tableErrors).length > 0) {
      // Emit per-table read errors as a sibling field so the diagnostics UI
      // can warn the operator that some tables came back empty due to
      // schema drift rather than because they were genuinely empty.
      await write(`,"tableErrors":${JSON.stringify(tableErrors)}`);
    }
    await write("}");
    res.end();
  } catch (e: any) {
    // We've already sent headers (Content-Type: application/json + 200), so
    // we can't switch to a 500 — the express error handler would notice
    // headersSent and bail anyway. The least-bad option is to log it
    // server-side, append a sentinel marker the client can detect when
    // parsing, and end the stream. The frontend already wraps JSON.parse
    // in try/catch, so a truncated/corrupt body will surface as a parse
    // error rather than a misleadingly-successful download.
    logger.error({ err: e }, "Backup export streaming failed mid-response");
    try {
      // Trailing garbage guarantees JSON.parse rejects the file rather
      // than silently accepting a half-written backup as authoritative.
      res.end(`\n--EXPORT-FAILED--${JSON.stringify({ error: e?.message || "stream failed" })}`);
    } catch {
      try { res.end(); } catch { /* socket already torn down */ }
    }
  } finally {
    res.off("close", onClose);
  }
});

// ---------------------------------------------------------------------------
// Chunked import (the path the UI actually uses)
// ---------------------------------------------------------------------------
//
// The original /admin/import route below took the entire backup as one big
// JSON POST. Bumping Express's body-parser limit fixes the in-process cap,
// but the edge proxy in front of the API server (Replit's deployment edge,
// or the dev preview proxy) has its own request-size limit that we cannot
// raise. Real site backups easily exceed that proxy cap, so the upload was
// being rejected with an HTML error page before the request ever reached
// Express — manifesting on the client as
// "Unexpected token '<', '<html><hea'... is not valid JSON".
//
// The fix: split the upload into many small per-table requests. Each chunk
// is well under any plausible proxy limit, so the upload always lands.
// State is kept in-memory in a session map keyed by sessionId.
//
// Tradeoff: unlike the old monolithic route, each chunk is its own
// transaction, so if the network drops mid-import the live DB is left
// partially restored (the truncate from /begin still applies). This is
// acceptable because (a) the user always has the backup file to retry,
// and (b) the alternative was that the import never succeeded at all for
// any non-trivially-sized backup.
//
// Caveat: in-memory sessions don't survive process restart and don't
// federate across autoscale instances. For one user driving a sequential
// upload this is almost always fine. If the operator hits a "session not
// found" error mid-import, it's because the worker recycled — they should
// re-run the import from the beginning.

interface ImportSession {
  id: string;
  startedAt: number;
  lastTouchedAt: number;
  username: string;
  truncatedTables: string[];
  // Live column set per table so each /rows chunk doesn't have to re-query
  // information_schema. Populated during /begin.
  liveColsByTable: Map<string, Set<string>>;
  // Drizzle JS-name → pg column-name map per table, also pre-populated.
  jsToPgByTable: Map<string, Map<string, string>>;
  importedTables: Set<string>;
  tableRowCounts: Record<string, number>;
  errors: { table: string; error: string }[];
  totalRows: number;
  healWarning: string | null;
  status: "active" | "committed" | "failed";
}

const sessions = new Map<string, ImportSession>();
const SESSION_IDLE_TIMEOUT_MS = 30 * 60 * 1000; // 30 minutes

function sweepExpiredSessions(): void {
  const now = Date.now();
  for (const [id, s] of sessions) {
    if (now - s.lastTouchedAt > SESSION_IDLE_TIMEOUT_MS) sessions.delete(id);
  }
}

function newSessionId(): string {
  // Crypto-strong random: avoids any chance of an attacker guessing an
  // active import session id and posting rogue rows into it.
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

function buildJsToPgMap(table: any): Map<string, string> {
  const cfg: any = table[Symbol.for("drizzle:Columns")] || {};
  const m = new Map<string, string>();
  for (const [jsName, col] of Object.entries(cfg)) {
    const pg = (col as any)?.name;
    if (typeof pg === "string") m.set(jsName, pg);
  }
  return m;
}

// Re-hydrate JSON-stringified Date values back into Date objects so
// drizzle's timestamp-with-timezone columns accept them. Same heuristic
// used by the legacy import route.
function rehydrateDates(row: Record<string, any>): Record<string, any> {
  const out: Record<string, any> = {};
  for (const [k, v] of Object.entries(row)) {
    if (typeof v === "string"
      && /(_at|At|Seen|firstSeen|lastSeen|createdAt|updatedAt)$/.test(k)
      && /^\d{4}-\d{2}-\d{2}T/.test(v)) {
      out[k] = new Date(v);
    } else {
      out[k] = v;
    }
  }
  return out;
}

// Per-route JSON parser. 16MB is generous for a single chunk (the client
// targets ~2MB) but bounded enough that one rogue chunk can't OOM the
// process.
const chunkJson = expressJson({ limit: "16mb" });

router.post("/admin/import/begin", requireAdmin, chunkJson, async (req, res) => {
  sweepExpiredSessions();
  const payload = req.body ?? {};
  if (payload.confirm !== true) {
    res.status(400).json({ error: "Refusing to begin import without { confirm: true }." });
    return;
  }

  // Refuse to start a second import while one is already in progress —
  // concurrent TRUNCATEs from two operators would interleave catastrophically.
  for (const s of sessions.values()) {
    if (s.status === "active") {
      res.status(409).json({
        error: `Another import session is already active (started by ${s.username} at ${new Date(s.startedAt).toISOString()}). Wait for it to finish or expire (idle timeout 30min).`,
      });
      return;
    }
  }

  let healWarning: string | null = null;
  try {
    await ensureSchema();
  } catch (e: any) {
    healWarning = e?.message || "ensureSchema failed";
    logger.warn({ err: e }, "ensureSchema failed before chunked import begin — continuing");
  }

  const truncatedTables: string[] = [];
  const liveColsByTable = new Map<string, Set<string>>();
  const jsToPgByTable = new Map<string, Map<string, string>>();

  try {
    await db.transaction(async (tx) => {
      const existing = await tx.execute<{ table_name: string }>(sql.raw(
        `SELECT table_name FROM information_schema.tables
          WHERE table_schema = 'public'
            AND table_name = ANY(ARRAY[${TABLES.map((t) => `'${t.pgName}'`).join(", ")}])`,
      ));
      const existingNames = new Set<string>(existing.rows.map((r: any) => r.table_name));
      const truncatable = TABLES.filter((t) => existingNames.has(t.pgName));
      if (truncatable.length > 0) {
        const tableList = truncatable.map((t) => `"${t.pgName}"`).join(", ");
        await tx.execute(sql.raw(`TRUNCATE TABLE ${tableList} RESTART IDENTITY CASCADE`));
        for (const t of truncatable) truncatedTables.push(t.name);
      }

      // Cache live column sets so per-chunk inserts don't re-query.
      for (const t of truncatable) {
        const colsRes = await tx.execute<{ column_name: string }>(sql.raw(
          `SELECT column_name FROM information_schema.columns
            WHERE table_schema = 'public' AND table_name = '${t.pgName}'`,
        ));
        liveColsByTable.set(t.name, new Set(colsRes.rows.map((r: any) => r.column_name)));
        jsToPgByTable.set(t.name, buildJsToPgMap(t.table));
      }
    });
  } catch (e: any) {
    logger.error({ err: e }, "Backup import begin failed");
    res.status(500).json({ ok: false, error: e?.message || "begin failed", healWarning });
    return;
  }

  const session: ImportSession = {
    id: newSessionId(),
    startedAt: Date.now(),
    lastTouchedAt: Date.now(),
    username: req.session?.username ?? "unknown",
    truncatedTables,
    liveColsByTable,
    jsToPgByTable,
    importedTables: new Set(),
    tableRowCounts: {},
    errors: [],
    totalRows: 0,
    healWarning,
    status: "active",
  };
  sessions.set(session.id, session);

  res.json({
    ok: true,
    sessionId: session.id,
    truncatedTables,
    healWarning,
    chunkLimitBytes: 16 * 1024 * 1024,
  });
});

router.post("/admin/import/rows", requireAdmin, chunkJson, async (req, res) => {
  const { sessionId, table, rows } = req.body ?? {};
  const session = typeof sessionId === "string" ? sessions.get(sessionId) : null;
  if (!session) {
    res.status(404).json({ error: "Import session not found or expired. Re-run the import from the beginning." });
    return;
  }
  if (session.status !== "active") {
    res.status(409).json({ error: `Session is ${session.status}; cannot accept more rows.` });
    return;
  }
  session.lastTouchedAt = Date.now();

  if (typeof table !== "string" || !Array.isArray(rows)) {
    res.status(400).json({ error: "Body must be { sessionId, table: string, rows: any[] }." });
    return;
  }
  const tableEntry = TABLES.find((t) => t.name === table);
  if (!tableEntry) {
    res.status(400).json({ error: `Unknown table "${table}".` });
    return;
  }
  const liveCols = session.liveColsByTable.get(table);
  if (!liveCols) {
    // Table didn't exist on the live DB at /begin time — record once and
    // tell the client to skip future chunks for it.
    if (!session.errors.find((e) => e.table === table)) {
      session.errors.push({ table, error: `table "${tableEntry.pgName}" does not exist on live DB; skipping rows` });
    }
    res.json({ ok: true, accepted: 0, skipped: rows.length, reason: "table does not exist on live DB" });
    return;
  }

  if (rows.length === 0) {
    res.json({ ok: true, accepted: 0 });
    return;
  }

  const jsToPg = session.jsToPgByTable.get(table) ?? new Map<string, string>();
  const fixed: Record<string, any>[] = [];
  for (const r of rows) {
    if (!r || typeof r !== "object") continue;
    const filtered: Record<string, any> = {};
    for (const [k, v] of Object.entries(r)) {
      const pg = jsToPg.get(k) || k;
      if (!liveCols.has(pg)) continue; // drop unknown column
      filtered[k] = v;
    }
    fixed.push(rehydrateDates(filtered));
  }

  try {
    // Postgres caps bound parameters at ~65k per statement; 500 rows is a
    // safe per-statement chunk for any reasonable column count.
    const SUBCHUNK = 500;
    for (let i = 0; i < fixed.length; i += SUBCHUNK) {
      const slice = fixed.slice(i, i + SUBCHUNK);
      await db.insert(tableEntry.table).values(slice as any);
    }
    session.importedTables.add(table);
    session.tableRowCounts[table] = (session.tableRowCounts[table] ?? 0) + rows.length;
    session.totalRows += rows.length;
    res.json({ ok: true, accepted: rows.length, totalForTable: session.tableRowCounts[table] });
  } catch (e: any) {
    session.errors.push({ table, error: e?.message || "insert failed" });
    logger.error({ err: e, table }, "Backup import chunk insert failed");
    res.status(500).json({
      ok: false,
      error: e?.message || "insert failed",
      table,
      // Surface details to the admin so they can see e.g. constraint
      // violations or NOT NULL errors and decide whether to abort.
      detail: e?.detail || null,
    });
  }
});

router.post("/admin/import/commit", requireAdmin, chunkJson, async (req, res) => {
  const { sessionId } = req.body ?? {};
  const session = typeof sessionId === "string" ? sessions.get(sessionId) : null;
  if (!session) {
    res.status(404).json({ error: "Import session not found or expired." });
    return;
  }
  if (session.status !== "active") {
    res.status(409).json({ error: `Session is already ${session.status}.` });
    return;
  }
  session.lastTouchedAt = Date.now();

  // Reset serial sequences so the next inserted row doesn't collide with
  // an id we just imported.
  try {
    await db.transaction(async (tx) => {
      for (const t of TABLES) {
        if (!session.liveColsByTable.has(t.name)) continue;
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
  } catch (e: any) {
    // Sequence reset failure shouldn't fail the whole import — the data
    // is already in. Surface as a warning instead.
    session.errors.push({ table: "<sequence-reset>", error: e?.message || "sequence reset failed" });
  }

  session.status = "committed";
  const result = {
    ok: true,
    sessionId: session.id,
    imported: Array.from(session.importedTables),
    totalRows: session.totalRows,
    tableRowCounts: session.tableRowCounts,
    skipped: session.errors,
    healWarning: session.healWarning,
    truncatedTables: session.truncatedTables,
  };
  // Hold the session a bit longer so the client can poll status if needed,
  // but most callers will just take this response and discard.
  setTimeout(() => sessions.delete(session.id), 60_000);
  res.json(result);
});

// ---------------------------------------------------------------------------
// Legacy single-shot /admin/import — kept for backward compatibility with any
// programmatic caller. The UI no longer uses this path; large backups should
// use the chunked /admin/import/{begin,rows,commit} flow above.
// ---------------------------------------------------------------------------

router.post("/admin/import", requireAdmin, expressJson({ limit: "1024mb" }), async (req, res) => {
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
