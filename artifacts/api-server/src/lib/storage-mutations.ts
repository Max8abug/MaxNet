import { db, storageJournalPool } from "@workspace/db";
import { sql } from "drizzle-orm";
import { appStorage, storageScope } from "./app-storage";
import { logger } from "./logger";
import { BACKUP_LOCK } from "./storage-lock";
export { BACKUP_LOCK } from "./storage-lock";

type Transaction = Parameters<Parameters<typeof db.transaction>[0]>[0];
type Executor = Pick<Transaction, "execute">;
export const cleanupSchema = `
  CREATE TABLE IF NOT EXISTS storage_cleanup (
    scope text NOT NULL,
    object_key text NOT NULL,
    lock_key text NOT NULL,
    attempts integer NOT NULL DEFAULT 0,
    next_attempt_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (scope, object_key)
  );
  CREATE INDEX IF NOT EXISTS storage_cleanup_due_idx ON storage_cleanup (next_attempt_at);
`;

export async function lockStorage(tx: Transaction, lockKey: string) {
  await tx.execute(sql`SELECT pg_advisory_xact_lock_shared(${BACKUP_LOCK}, 0)`);
  // Retain the existing hosted upload lock's namespace.
  await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${lockKey}))`);
}

export async function queueCleanup(executor: Executor, lockKey: string, objectKey: string) {
  await executor.execute(sql`
    INSERT INTO storage_cleanup (scope, object_key, lock_key)
    VALUES (${storageScope()}, ${objectKey}, ${lockKey})
    ON CONFLICT (scope, object_key) DO NOTHING
  `);
}

// Call while holding the mutation lock: the independent intent must survive
// a crash/rollback/ambiguous upload failure before metadata has been committed.
export async function trackUpload(lockKey: string, objectKey: string) {
  await storageJournalPool.query(
    "INSERT INTO storage_cleanup (scope, object_key, lock_key) VALUES ($1, $2, $3) ON CONFLICT (scope, object_key) DO NOTHING",
    [storageScope(), objectKey, lockKey],
  );
}

export async function drainStorageCleanup(keys?: string[]) {
  const scope = storageScope();
  const pending = await db.execute<{ object_key: string }>(sql`
    SELECT object_key FROM storage_cleanup
    WHERE scope = ${scope}
      AND ${keys ? sql`object_key IN (${sql.join(keys.map(key => sql`${key}`), sql`, `)})` : sql`next_attempt_at <= now()`}
    ORDER BY next_attempt_at LIMIT 25
  `);
  for (const row of pending.rows) {
    await db.transaction(async tx => {
      await tx.execute(sql`SELECT pg_advisory_xact_lock_shared(${BACKUP_LOCK}, 0)`);
      const claimed = await tx.execute<{ lock_key: string; attempts: number }>(sql`
        SELECT lock_key, attempts FROM storage_cleanup
        WHERE scope = ${scope} AND object_key = ${row.object_key}
        FOR UPDATE SKIP LOCKED
      `);
      const job = claimed.rows[0];
      if (!job) return;
      // Never wait holding the queue row: a writer may need it to commit.
      const lock = await tx.execute<{ locked: boolean }>(sql`
        SELECT pg_try_advisory_xact_lock(hashtext(${job.lock_key})) AS locked
      `);
      if (!lock.rows[0]?.locked) return;
      const references = await tx.execute(sql`
        SELECT 1 FROM hosted_site_files WHERE object_key = ${row.object_key}
        UNION ALL SELECT 1 FROM wiki_assets WHERE object_key = ${row.object_key}
        LIMIT 1
      `);
      if (references.rows.length === 0) {
        const result = await appStorage.delete(row.object_key, { ignoreNotFound: true });
        if (!result.ok) {
          const delay = Math.min(3600, 30 * 2 ** Math.min(job.attempts, 7));
          await tx.execute(sql`
            UPDATE storage_cleanup SET attempts = attempts + 1,
              next_attempt_at = now() + ${delay} * interval '1 second'
            WHERE scope = ${scope} AND object_key = ${row.object_key}
          `);
          logger.warn({ error: result.error, objectKey: row.object_key }, "Storage cleanup deferred; will retry");
          return;
        }
      }
      await tx.execute(sql`DELETE FROM storage_cleanup WHERE scope = ${scope} AND object_key = ${row.object_key}`);
    });
  }
}

// Cleanup errors must not turn a committed mutation into a reported failure.
export async function cleanupAfterMutation(keys: string[]) {
  if (!keys.length) return;
  try {
    await drainStorageCleanup(keys);
  } catch (err) {
    logger.error({ err }, "Storage cleanup deferred; durable queue retained");
  }
}

export function startStorageCleanup() {
  let running = false;
  const run = async () => {
    if (running) return;
    running = true;
    try {
      await drainStorageCleanup();
    } catch (err) {
      logger.error({ err }, "Storage cleanup retry failed");
    } finally {
      running = false;
    }
  };
  void run();
  const timer = setInterval(() => void run(), 30_000);
  timer.unref();
}
