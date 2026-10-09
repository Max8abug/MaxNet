// Runs only with the integration suite's disposable identity, DB records and disk.
import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import path from "node:path";
import { db, pool, hostedSiteFilesTable, wikiAssetsTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { appStorage, storageScope } from "../src/lib/app-storage";
import { cleanupAfterMutation, drainStorageCleanup, lockStorage, queueCleanup, trackUpload } from "../src/lib/storage-mutations";

type Response = { bytes: Buffer; json: () => any; headers: Headers };
type Context = {
  owner: string; slug: string; site: string; png: Buffer; disk: string;
  request: (url: string, method?: string, body?: unknown, username?: string, expected?: number) => Promise<Response>;
  put: (filePath: string, data: Buffer, expected?: number, username?: string) => Promise<Response>;
};
const failure = { ok: false as const, error: { message: "Injected storage outage", statusCode: 503 } };
function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>(r => { resolve = r; });
  return { promise, resolve };
}
async function absent(disk: string, key: string) {
  await assert.rejects(readFile(path.join(disk, key)), { code: "ENOENT" });
}
async function queued(key: string) {
  return (await pool.query("SELECT * FROM storage_cleanup WHERE scope = $1 AND object_key = $2", [storageScope(), key])).rows;
}
async function waiting(lockKey: string, count = 1) {
  // Observe the lock wait, not just a timer or a nondeterministic Promise.all.
  for (let i = 0; i < 100; i++) {
    const result = await pool.query(`
      SELECT count(*)::integer AS count FROM pg_locks
      WHERE locktype = 'advisory' AND NOT granted
        AND objid::bigint = (hashtext($1)::bigint + 4294967296) % 4294967296
    `, [lockKey]);
    if (result.rows[0].count >= count) return;
    await new Promise(r => setTimeout(r, 20));
  }
  assert.fail(`Expected ${count} waiting mutation(s) for ${lockKey}`);
}

export async function runStorageFaultChecks({ owner, slug, site, png, disk, request, put }: Context) {
  const originalDelete = appStorage.delete;
  const originalUpload = appStorage.uploadFromBytes;
  const allKeys = new Set<string>();
  appStorage.uploadFromBytes = async (...args) => {
    allKeys.add(args[0]);
    return originalUpload(...args);
  };
  const recordingUpload = appStorage.uploadFromBytes;
  async function files() {
    return db.select().from(hostedSiteFilesTable).where(eq(hostedSiteFilesTable.username, owner));
  }
  async function newPage() {
    await request("/wiki/pages", "POST", { title: slug, slug }, owner, 201);
  }
  const mediaBody = { fileName: "fault.png", dataUrl: `data:image/png;base64,${png.toString("base64")}` };
  async function media() {
    return (await request(`/wiki/pages/${slug}/assets`, "POST", mediaBody, owner, 201)).json();
  }
  try {
    // A resolved Result failure (not a thrown exception) must remain queued.
    await put("index.html", Buffer.from("original"));
    const old = (await files())[0];
    appStorage.delete = async () => failure;
    await put("index.html", Buffer.from("replacement"));
    assert.equal((await queued(old.objectKey)).length, 1);
    assert.equal((await queued(old.objectKey))[0].attempts, 1);
    assert.deepEqual(await readFile(path.join(disk, old.objectKey)), Buffer.from("original"));
    const current = (await files())[0];
    assert.deepEqual(await readFile(path.join(disk, current.objectKey)), Buffer.from("replacement"));
    appStorage.delete = originalDelete;
    await drainStorageCleanup([old.objectKey]);
    await absent(disk, old.objectKey);
    assert.equal((await queued(old.objectKey)).length, 0);
    await drainStorageCleanup([old.objectKey]); // Idempotent after retry/restart.

    // The backend may write bytes and still report failure; preserve old metadata
    // and retain the new key even when compensating deletion also fails.
    let partialKey = "";
    appStorage.uploadFromBytes = async (...args) => {
      partialKey = args[0];
      assert((await recordingUpload(...args)).ok);
      return failure;
    };
    appStorage.delete = async () => failure;
    await put("index.html", Buffer.from("uncommitted"), 503);
    assert.equal((await files())[0].objectKey, current.objectKey);
    assert.equal((await queued(partialKey)).length, 1);
    assert.deepEqual(await readFile(path.join(disk, current.objectKey)), Buffer.from("replacement"));
    appStorage.uploadFromBytes = recordingUpload;
    appStorage.delete = originalDelete;
    await drainStorageCleanup([partialKey]);
    await absent(disk, partialKey);

    // Crash-equivalent rollback after bytes were written: durable intent survives.
    const orphan = `user-sites/${Buffer.from(owner).toString("base64url")}/rollback`;
    allKeys.add(orphan);
    await assert.rejects(db.transaction(async tx => {
      await lockStorage(tx, owner);
      await trackUpload(owner, orphan);
      assert((await appStorage.uploadFromBytes(orphan, png)).ok);
      throw new Error("Injected metadata rollback");
    }), /Injected metadata rollback/);
    assert.equal((await queued(orphan)).length, 1);
    const stagingKey = `${orphan}.${randomUUID()}.tmp`;
    await writeFile(path.join(disk, stagingKey), png);
    await drainStorageCleanup([orphan]);
    await absent(disk, orphan);
    await absent(disk, stagingKey);

    // A rolled-back metadata deletion must never remove bytes of valid content.
    await assert.rejects(db.transaction(async tx => {
      await lockStorage(tx, owner);
      await queueCleanup(tx, owner, current.objectKey);
      await tx.delete(hostedSiteFilesTable).where(eq(hostedSiteFilesTable.id, current.id));
      throw new Error("Injected deletion rollback");
    }), /Injected deletion rollback/);
    await cleanupAfterMutation([current.objectKey]);
    assert.equal((await files())[0].objectKey, current.objectKey);
    assert.deepEqual(await readFile(path.join(disk, current.objectKey)), Buffer.from("replacement"));

    // Guard an ambiguous commit: a queued key still referenced must be retained.
    await db.transaction(async tx => {
      await lockStorage(tx, owner);
      await queueCleanup(tx, owner, current.objectKey);
    });
    await drainStorageCleanup([current.objectKey]);
    assert.deepEqual(await readFile(path.join(disk, current.objectKey)), Buffer.from("replacement"));

    // More concurrent writers than the main pool has connections must not
    // starve the independent durable-intent write.
    let timeout: NodeJS.Timeout | undefined;
    try {
      await Promise.race([
        Promise.all(Array.from({ length: 12 }, (_, i) => put("index.html", Buffer.from(`writer-${i}`)))),
        new Promise<never>((_resolve, reject) => {
          timeout = setTimeout(() => reject(new Error("Concurrent upload pool deadlock")), 10_000);
        }),
      ]);
    } finally {
      clearTimeout(timeout);
    }
    assert.equal((await files()).length, 1);

    // Upload holds the lock; file deletion and whole-site deletion must wait.
    for (const wholeSite of [false, true]) {
      const entered = deferred(), release = deferred();
      let uploadKey = "";
      appStorage.uploadFromBytes = async (...args) => {
        uploadKey = args[0];
        entered.resolve();
        await release.promise;
        return recordingUpload(...args);
      };
      const uploading = put("index.html", Buffer.from("overlapping"));
      await entered.promise;
      const deleting = wholeSite
        ? request(site, "DELETE", undefined, owner)
        : request(`${site}/file`, "DELETE", { path: "index.html" }, owner);
      try {
        await waiting(owner);
        await drainStorageCleanup([uploadKey]);
        assert.equal((await queued(uploadKey)).length, 1, "Cleanup must not collect an in-flight upload");
      } finally {
        release.resolve();
      }
      await Promise.all([uploading, deleting]);
      appStorage.uploadFromBytes = recordingUpload;
      assert.equal((await files()).length, 0);
      await drainStorageCleanup([uploadKey]);
      await absent(disk, uploadKey);
    }

    // Bulk site deletion remains atomic even if one physical unlink fails.
    await put("index.html", Buffer.from("site"));
    await put("style.css", Buffer.from("css"));
    const bulkFiles = await files();
    let deletes = 0;
    appStorage.delete = async (...args) => ++deletes === 2 ? failure : originalDelete(...args);
    await request(site, "DELETE", undefined, owner);
    assert.equal((await files()).length, 0);
    assert.equal((await request(site, "GET", undefined, owner)).json().exists, false);
    const retained = bulkFiles.filter(f => f.objectKey);
    assert.equal((await pool.query("SELECT count(*)::int AS count FROM storage_cleanup WHERE scope = $1 AND object_key = ANY($2::text[])", [storageScope(), bulkFiles.map(f => f.objectKey)])).rows[0].count, 1);
    appStorage.delete = originalDelete;
    await drainStorageCleanup(retained.map(f => f.objectKey));
    for (const f of bulkFiles) await absent(disk, f.objectKey);

    // Equivalent partial-unlink fault for wiki page deletion.
    await newPage();
    const assets = [await media(), await media()];
    deletes = 0;
    appStorage.delete = async (...args) => ++deletes === 2 ? failure : originalDelete(...args);
    await request(`/wiki/pages/${slug}`, "DELETE", undefined, owner);
    await request(`/wiki/pages/${slug}`, "GET", undefined, undefined, 404);
    for (const asset of assets) await request(`/wiki/assets/${asset.id}`, "GET", undefined, undefined, 404);
    appStorage.delete = originalDelete;
    await drainStorageCleanup(assets.map(a => a.objectKey));
    for (const asset of assets) await absent(disk, asset.objectKey);

    // Wiki upload versus page deletion is serialized and leaves no orphan asset.
    await newPage();
    const entered = deferred(), release = deferred();
    appStorage.uploadFromBytes = async (...args) => {
      entered.resolve();
      await release.promise;
      return recordingUpload(...args);
    };
    const uploading = media();
    await entered.promise;
    const deleting = request(`/wiki/pages/${slug}`, "DELETE", undefined, owner);
    try {
      await waiting(`wiki:${slug}`);
    } finally {
      release.resolve();
    }
    const [asset] = await Promise.all([uploading, deleting]);
    appStorage.uploadFromBytes = recordingUpload;
    assert.equal((await db.select().from(wikiAssetsTable).where(eq(wikiAssetsTable.pageSlug, slug))).length, 0);
    await drainStorageCleanup([asset.objectKey]);
    await absent(disk, asset.objectKey);
    await request(`/wiki/pages/${slug}/assets`, "POST", mediaBody, owner, 404);

    // Deletion queued first: a later wiki upload must recheck page existence
    // after acquiring the same lock, rather than create an orphan asset.
    await newPage();
    const held = deferred(), unlock = deferred();
    const blocker = db.transaction(async tx => {
      await lockStorage(tx, `wiki:${slug}`);
      held.resolve();
      await unlock.promise;
    });
    await held.promise;
    const deleteFirst = request(`/wiki/pages/${slug}`, "DELETE", undefined, owner);
    let uploadSecond: Promise<Response> | undefined;
    try {
      await waiting(`wiki:${slug}`);
      uploadSecond = request(`/wiki/pages/${slug}/assets`, "POST", mediaBody, owner, 404);
      await waiting(`wiki:${slug}`, 2);
    } finally {
      unlock.resolve();
    }
    await Promise.all([blocker, deleteFirst, uploadSecond]);
    assert.equal((await db.select().from(wikiAssetsTable).where(eq(wikiAssetsTable.pageSlug, slug))).length, 0);

    // Wiki upload failure after writing also has a durable compensation.
    await newPage();
    appStorage.uploadFromBytes = async (...args) => {
      partialKey = args[0];
      assert((await recordingUpload(...args)).ok);
      throw new Error("Injected interrupted wiki upload");
    };
    appStorage.delete = async () => failure;
    await request(`/wiki/pages/${slug}/assets`, "POST", mediaBody, owner, 503);
    assert.equal((await request(`/wiki/pages/${slug}`)).json().assets.length, 0);
    assert.equal((await queued(partialKey)).length, 1);
    appStorage.uploadFromBytes = recordingUpload;
    appStorage.delete = originalDelete;
    await drainStorageCleanup([partialKey]);
    await absent(disk, partialKey);
    await request(`/wiki/pages/${slug}`, "DELETE", undefined, owner);
    console.log("PASS isolated faults: Result failures, partial writes, rollback/restart recovery, reference safety, bulk deletion and deterministic advisory-lock races");
  } finally {
    appStorage.delete = originalDelete;
    appStorage.uploadFromBytes = originalUpload;
    // Scope every cleanup query to keys/identities created by this suite.
    for (const key of allKeys) {
      await originalDelete(key, { ignoreNotFound: true });
      await pool.query("DELETE FROM storage_cleanup WHERE scope = $1 AND object_key = $2", [storageScope(), key]);
    }
  }
}
