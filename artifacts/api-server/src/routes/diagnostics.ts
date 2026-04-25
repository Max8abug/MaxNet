import { Router, type IRouter } from "express";
import { eq } from "drizzle-orm";
import { db, pool, drawingsTable } from "@workspace/db";
import { requireAdmin } from "../lib/auth";
import { listErrors, clearErrors } from "../lib/error-buffer";
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
      steps.push({
        name,
        ok: false,
        skipped: false,
        durationMs: Date.now() - start,
        detail: null,
        error: e instanceof Error ? `${e.message}${e.stack ? `\n${e.stack}` : ""}` : String(e),
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

export default router;
