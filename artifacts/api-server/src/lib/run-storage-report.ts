import { pool } from "@workspace/db";
import { appStorage, storageScope } from "./app-storage";
import { BACKUP_LOCK } from "./storage-lock";
import { classifyStorageInventory, type StorageReference } from "./storage-report";

// Deliberately not imported from app startup, cleanup, or site backups.
export async function runStorageReport(options: { minAgeHours: number; maxObjects: number }) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN ISOLATION LEVEL READ COMMITTED READ ONLY");
    await client.query("SET LOCAL statement_timeout = '5s'");
    // Non-waiting exclusive lock: in-flight uploads/restore/cleanup cause an
    // explicit busy error. New journaled writers wait until this report ends.
    const lock = await client.query<{ locked: boolean }>(
      "SELECT pg_try_advisory_xact_lock($1, 0) AS locked", [BACKUP_LOCK],
    );
    if (!lock.rows[0]?.locked) throw new Error("Storage is busy. Run the report again during a quiet period.");
    // READ COMMITTED takes this snapshot after the lock; a snapshot taken before
    // acquiring it could miss metadata committed by the previous lock holder.
    const references = await client.query<StorageReference>(`
      SELECT object_key, 'wiki' AS source, NULL::text AS scope FROM wiki_assets
      UNION ALL SELECT object_key, 'hosted-site', NULL::text FROM hosted_site_files
      UNION ALL SELECT object_key, 'cleanup', scope FROM storage_cleanup
      LIMIT $1
    `, [options.maxObjects + 1]);
    if (references.rows.length > options.maxObjects) {
      throw new Error("Reference limit exceeded; no complete report produced.");
    }
    const startedAt = new Date();
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      const report = await Promise.race([
        classifyStorageInventory(appStorage.listObjects(), references.rows, {
          ...options, scope: storageScope(), startedAt, signal: controller.signal,
        }),
        new Promise<never>((_, reject) => {
          timer = setTimeout(() => {
            controller.abort();
            reject(new Error("Inventory exceeded 30 seconds; no complete report produced."));
          }, 30_000);
        }),
      ]);
      await client.query("ROLLBACK");
      return { ...report, finishedAt: new Date().toISOString() };
    } finally {
      if (timer) clearTimeout(timer);
    }
  } finally {
    await client.query("ROLLBACK").catch(() => {});
    client.release();
  }
}
