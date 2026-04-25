import { Router, type IRouter } from "express";
import { eq } from "drizzle-orm";
import { getTableConfig, type PgTable } from "drizzle-orm/pg-core";
import { db, pool, drawingsTable } from "@workspace/db";
import * as schema from "@workspace/db";
import { requireAdmin } from "../lib/auth";
import { ensureSchema } from "../lib/ensure-schema";
import { listErrors, clearErrors, describeError } from "../lib/error-buffer";
import { isBanned, audit } from "./social";

const router: IRouter = Router();

router.get("/diagnostics/errors", requireAdmin, (_req, res) => {
  res.json({ errors: listErrors() });
});

router.delete("/diagnostics/errors", requireAdmin, (_req, res) => {
  clearErrors();
  res.json({ ok: true });
});

// Tables we sanity-check on the live database. Each entry maps the
// human-readable name shown in the diagnostics window to the actual
// Postgres table name. We probe with COUNT(*) per-table inside a try/catch
// so a missing/broken table shows up as `error: "..."` instead of failing
// the whole health check.
const TABLES_TO_CHECK: Array<{ label: string; table: string }> = [
  { label: "users", table: "users" },
  { label: "drawings", table: "drawings" },
  { label: "chat messages", table: "chat_messages" },
  { label: "guestbook entries", table: "guestbook_entries" },
  { label: "shared photos", table: "photos" },
  { label: "forum threads", table: "forum_threads" },
  { label: "forum posts", table: "forum_posts" },
  { label: "DMs", table: "dms" },
  { label: "ranks", table: "ranks" },
  { label: "polls", table: "polls" },
  { label: "news posts", table: "news_posts" },
  { label: "banned users", table: "banned_users" },
  { label: "IP bans", table: "ip_bans" },
  { label: "site settings", table: "site_settings" },
  { label: "chat audit log", table: "chat_audit_log" },
  { label: "user pages", table: "user_pages" },
  { label: "session", table: "session" },
];

interface TableCheck {
  label: string;
  table: string;
  ok: boolean;
  count: number | null;
  error: string | null;
}

interface HealthCheckResult {
  ok: boolean;
  ranAt: string;
  durationMs: number;
  dbConnected: boolean;
  dbError: string | null;
  serverTime: string | null;
  postgresVersion: string | null;
  tables: TableCheck[];
  sessions: {
    total: number | null;
    active: number | null;
    expired: number | null;
    error: string | null;
  };
  adminCount: number | null;
  adminError: string | null;
}

router.get("/diagnostics/healthcheck", requireAdmin, async (_req, res, next) => {
  const start = Date.now();
  const result: HealthCheckResult = {
    ok: true,
    ranAt: new Date().toISOString(),
    durationMs: 0,
    dbConnected: false,
    dbError: null,
    serverTime: null,
    postgresVersion: null,
    tables: [],
    sessions: { total: null, active: null, expired: null, error: null },
    adminCount: null,
    adminError: null,
  };

  try {
    // Basic connectivity probe — also surfaces server time and Postgres
    // version, both useful when comparing dev vs prod.
    try {
      const r = await pool.query<{ now: string; ver: string }>(
        "SELECT now()::text AS now, version() AS ver",
      );
      result.dbConnected = true;
      result.serverTime = r.rows[0]?.now ?? null;
      result.postgresVersion = r.rows[0]?.ver ?? null;
    } catch (e) {
      result.dbConnected = false;
      result.dbError = e instanceof Error ? e.message : String(e);
      result.ok = false;
    }

    if (result.dbConnected) {
      // Per-table row counts. Each runs in its own try/catch so one bad
      // table doesn't hide the rest.
      for (const t of TABLES_TO_CHECK) {
        const check: TableCheck = {
          label: t.label,
          table: t.table,
          ok: false,
          count: null,
          error: null,
        };
        try {
          const r = await pool.query<{ c: string }>(
            `SELECT COUNT(*)::text AS c FROM "${t.table}"`,
          );
          check.count = Number(r.rows[0]?.c ?? 0);
          check.ok = true;
        } catch (e) {
          check.error = e instanceof Error ? e.message : String(e);
          result.ok = false;
        }
        result.tables.push(check);
      }

      // Session table breakdown — particularly important because a missing
      // session table is what caused the drawing pad to silently fail.
      try {
        const r = await pool.query<{ total: string; active: string }>(
          `SELECT
             COUNT(*)::text AS total,
             COUNT(*) FILTER (WHERE expire > now())::text AS active
           FROM "session"`,
        );
        const total = Number(r.rows[0]?.total ?? 0);
        const active = Number(r.rows[0]?.active ?? 0);
        result.sessions.total = total;
        result.sessions.active = active;
        result.sessions.expired = total - active;
      } catch (e) {
        result.sessions.error = e instanceof Error ? e.message : String(e);
        result.ok = false;
      }

      // Admin head-count — handy for confirming the admin row actually
      // exists on the live database.
      try {
        const r = await pool.query<{ c: string }>(
          `SELECT COUNT(*)::text AS c FROM "users" WHERE is_admin = true`,
        );
        result.adminCount = Number(r.rows[0]?.c ?? 0);
      } catch (e) {
        result.adminError = e instanceof Error ? e.message : String(e);
        result.ok = false;
      }
    }

    result.durationMs = Date.now() - start;
    res.json(result);
  } catch (e) {
    next(e);
  }
});

// 1x1 transparent PNG used by the drawing-pad self-test below. Tiny so it
// stays well under the 600 KB cap enforced by the real submit route.
const TEST_PNG_DATA_URL =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8/5+hHgAHggJ/PchI7wAAAABJRU5ErkJggg==";

interface TestStep {
  name: string;
  ok: boolean;
  skipped: boolean;
  durationMs: number;
  detail: string | null;
  error: string | null;
}

router.post("/diagnostics/test-drawing", requireAdmin, async (req, res, next) => {
  const author = req.session.username || "admin";
  const steps: TestStep[] = [];
  let createdId: number | null = null;

  // Helper: run one labelled step. If a previous step failed we still record
  // the step but mark it skipped, so the report stays in order.
  const run = async (name: string, fn: () => Promise<string | null>) => {
    const prevFailed = steps.some(s => !s.ok && !s.skipped);
    const start = Date.now();
    if (prevFailed) {
      steps.push({ name, ok: false, skipped: true, durationMs: 0, detail: null, error: null });
      return;
    }
    try {
      const detail = await fn();
      steps.push({ name, ok: true, skipped: false, durationMs: Date.now() - start, detail, error: null });
    } catch (e) {
      // Use describeError so wrapped errors (drizzle's "Failed query"
      // wrapper around a Postgres error) reveal the underlying cause and
      // pg metadata like `code`, `column`, `table`.
      const d = describeError(e);
      steps.push({
        name,
        ok: false,
        skipped: false,
        durationMs: Date.now() - start,
        detail: null,
        error: `${d.message}${d.stack ? `\n${d.stack}` : ""}`,
      });
    }
  };

  try {
    // Mirrors the real POST /drawings flow step-by-step so we can pinpoint
    // exactly which call fails on the live database.

    await run("Auth (admin session)", async () => {
      return `signed in as "${author}"`;
    });

    await run("Validate test data URL", async () => {
      if (!TEST_PNG_DATA_URL.startsWith("data:image/")) throw new Error("bad prefix");
      if (TEST_PNG_DATA_URL.length > 600_000) throw new Error("too large");
      return `${TEST_PNG_DATA_URL.length} bytes`;
    });

    await run("Check banned_users", async () => {
      const banned = await isBanned(author);
      if (banned) throw new Error(`user "${author}" appears in banned_users`);
      return "not banned";
    });

    await run("INSERT into drawings", async () => {
      const [row] = await db
        .insert(drawingsTable)
        .values({ dataUrl: TEST_PNG_DATA_URL, author })
        .returning();
      createdId = row.id;
      return `inserted id=${row.id}`;
    });

    await run("Write to chat_audit_log", async () => {
      await audit("drawing", "diagnostics-test", author, "", `id=${createdId}`);
      return "audit row written";
    });

    await run("SELECT row back from drawings", async () => {
      if (createdId == null) throw new Error("no id from prior step");
      const [row] = await db
        .select()
        .from(drawingsTable)
        .where(eq(drawingsTable.id, createdId))
        .limit(1);
      if (!row) throw new Error("inserted row not found on read-back");
      return `read back id=${row.id}, author=${row.author}`;
    });

    await run("Cleanup test row", async () => {
      if (createdId == null) return "nothing to clean up";
      await db.delete(drawingsTable).where(eq(drawingsTable.id, createdId));
      return `deleted id=${createdId}`;
    });

    // Best-effort cleanup if any step failed AFTER the insert — we don't
    // want a stray test drawing showing up in the public gallery just
    // because audit or read-back blew up.
    if (createdId != null && steps.some(s => !s.ok && !s.skipped)) {
      try {
        await db.delete(drawingsTable).where(eq(drawingsTable.id, createdId));
      } catch {
        // swallow — the report already lists the original failure
      }
    }

    res.json({
      ok: steps.every(s => s.ok),
      ranAt: new Date().toISOString(),
      author,
      steps,
    });
  } catch (e) {
    next(e);
  }
});

// ----------------------------------------------------------------------
// Schema drift check
// ----------------------------------------------------------------------
// Compares the live Postgres schema against what Drizzle (the in-code
// source of truth) expects. Mostly useful for spotting prod databases
// that are stale relative to the latest deploy — e.g. a new column was
// added in code but the table on prod still doesn't have it. Pairs with
// the self-healing ALTERs in `ensure-schema.ts`: this report tells you
// whether those healed anything, and whether there are tables/columns we
// haven't covered yet.

interface SchemaColumnDrift {
  name: string;
  expectedType: string;
  actualType: string | null;
}

interface SchemaTableDrift {
  table: string;
  exists: boolean;
  missingColumns: SchemaColumnDrift[];
  // Columns present on the DB but not in the Drizzle schema. Informational
  // only — usually means a column was renamed/removed in code without a
  // matching DROP COLUMN, which is fine but worth noticing.
  extraColumns: string[];
}

interface SchemaDriftResult {
  ok: boolean;
  ranAt: string;
  durationMs: number;
  totalTables: number;
  driftedTables: number;
  tables: SchemaTableDrift[];
  error: string | null;
}

router.get("/diagnostics/schema-drift", requireAdmin, async (_req, res, next) => {
  const start = Date.now();
  const result: SchemaDriftResult = {
    ok: true,
    ranAt: new Date().toISOString(),
    durationMs: 0,
    totalTables: 0,
    driftedTables: 0,
    tables: [],
    error: null,
  };

  try {
    // Collect every Drizzle pgTable exported from @workspace/db. We
    // duck-type on the presence of the Drizzle-internal Symbol that
    // marks a real PgTable so we don't try to introspect, say, the
    // exported `pool` or `db` instances.
    const tables: PgTable[] = [];
    for (const v of Object.values(schema)) {
      if (v && typeof v === "object" && Symbol.for("drizzle:IsDrizzleTable") in v) {
        tables.push(v as PgTable);
      }
    }

    // One query for every column on every public-schema table. Cheaper
    // than per-table round-trips and gives us the full picture.
    const colsRes = await pool.query<{
      table_name: string;
      column_name: string;
      data_type: string;
    }>(
      `SELECT table_name, column_name, data_type
         FROM information_schema.columns
        WHERE table_schema = 'public'`,
    );

    const actualByTable = new Map<string, Map<string, string>>();
    for (const row of colsRes.rows) {
      let m = actualByTable.get(row.table_name);
      if (!m) {
        m = new Map();
        actualByTable.set(row.table_name, m);
      }
      m.set(row.column_name, row.data_type);
    }

    for (const table of tables) {
      const cfg = getTableConfig(table);
      const actualCols = actualByTable.get(cfg.name);
      const drift: SchemaTableDrift = {
        table: cfg.name,
        exists: actualCols != null,
        missingColumns: [],
        extraColumns: [],
      };

      const expectedNames = new Set<string>();
      for (const col of cfg.columns) {
        expectedNames.add(col.name);
        const expectedType = col.getSQLType();
        const actualType = actualCols?.get(col.name) ?? null;
        if (!actualCols || actualType == null) {
          drift.missingColumns.push({
            name: col.name,
            expectedType,
            actualType,
          });
        }
      }

      if (actualCols) {
        for (const name of actualCols.keys()) {
          if (!expectedNames.has(name)) drift.extraColumns.push(name);
        }
      }

      const drifted = !drift.exists || drift.missingColumns.length > 0;
      if (drifted) {
        result.driftedTables += 1;
        result.ok = false;
      }
      result.tables.push(drift);
    }

    result.totalTables = result.tables.length;
    // Sort: drifted tables first (missing > missing-cols > clean), then
    // alphabetical. Lets the UI render the interesting rows up top.
    result.tables.sort((a, b) => {
      const score = (t: SchemaTableDrift) =>
        !t.exists ? 0 : t.missingColumns.length > 0 ? 1 : 2;
      const sa = score(a);
      const sb = score(b);
      if (sa !== sb) return sa - sb;
      return a.table.localeCompare(b.table);
    });

    result.durationMs = Date.now() - start;
    res.json(result);
  } catch (e) {
    result.error = e instanceof Error ? e.message : String(e);
    result.ok = false;
    result.durationMs = Date.now() - start;
    next(e);
  }
});

// Manually re-run the same idempotent schema bootstrap that runs on
// server start. Useful for healing a stale prod DB without bouncing the
// process — e.g. after seeing drift in the report above. Safe because
// every statement uses IF NOT EXISTS, so this is a near-instant no-op
// when nothing is missing.
router.post("/diagnostics/heal-schema", requireAdmin, async (_req, res, next) => {
  const start = Date.now();
  try {
    await ensureSchema();
    res.json({
      ok: true,
      ranAt: new Date().toISOString(),
      durationMs: Date.now() - start,
    });
  } catch (e) {
    next(e);
  }
});

export default router;
