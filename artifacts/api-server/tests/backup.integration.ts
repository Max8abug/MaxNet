import assert from "node:assert/strict";
import express from "express";
import { once } from "node:events";
import { randomUUID } from "node:crypto";
import { mkdtemp, rm, readFile } from "node:fs/promises";
import path from "node:path";
import { tmpdir } from "node:os";
import {
  db,
  pool,
  storageJournalPool,
  usersTable,
  wikiPagesTable,
  wikiAssetsTable,
  hostedSitesTable,
  hostedSiteFilesTable,
} from "@workspace/db";
import { sql } from "drizzle-orm";
import backup from "../src/routes/admin-backup";
import { ensureSchema } from "../src/lib/ensure-schema";
import { appStorage } from "../src/lib/app-storage";
import { digest } from "../src/lib/backup-files";
import { checkScheduledBackups } from "./scheduled-backup.integration";

const disk = await mkdtemp(path.join(tmpdir(), "backup-objects-"));
const recovery = await mkdtemp(path.join(tmpdir(), "scheduled-recovery-"));
process.env.STORAGE_BACKEND = "local";
process.env.UPLOAD_STORAGE_DIR = disk;
const id = randomUUID();
const admin = `backup-${id}`;
const png = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aX2sAAAAASUVORK5CYII=",
  "base64",
);
const html = Buffer.from(
  `<h1>Disposable mini-site recovery ✓</h1><!--${"x".repeat(1024 * 1024 + 1)}-->`,
);
const sourceKeys = [`wiki/${id}/image.png`, `user-sites/${id}/index`];
const createdKeys = new Map<string, string[]>();
const realCreate = appStorage.createFromBytes;
appStorage.createFromBytes = async (key, bytes) => {
  const backend = process.env.STORAGE_BACKEND!;
  createdKeys.set(backend, [...(createdKeys.get(backend) ?? []), key]);
  return realCreate(key, bytes);
};
const app = express();
app.use(express.json({ limit: "16mb" }));
app.use((req, _res, next) => {
  req.session = {
    userId: 1,
    username: admin,
    isAdmin: req.get("x-not-admin") !== "1",
  } as typeof req.session;
  next();
});
app.use("/api", backup);
const server = app.listen(
  Number(process.env.BACKUP_TEST_UI_PORT || 0),
  process.env.BACKUP_TEST_UI_DIR ? "0.0.0.0" : "127.0.0.1",
);
await once(server, "listening");
const address = server.address();
assert(address && typeof address !== "string");
const base = `http://127.0.0.1:${address.port}/api`;
async function request(route: string, body?: any, status = 200) {
  const response = await fetch(base + route, {
    method: body ? "POST" : "GET",
    headers: { "Content-Type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await response.text();
  assert.equal(response.status, status, `${route}: ${text.slice(0, 600)}`);
  return JSON.parse(text);
}
async function prepare(payload: any) {
  const { fileSessionId } = await request("/admin/import/files/begin", {
    manifest: payload.files.map(({ objectKey, size, sha256 }: any) => ({
      objectKey,
      size,
      sha256,
    })),
  });
  for (const file of payload.files) {
    let offset = 0;
    // Intentionally split at a small base64-aligned boundary.
    const chunkSize = file.size > 1024 ? 1024 * 1024 : 12;
    for (let i = 0; i < file.dataBase64.length; i += chunkSize) {
      const result = await request("/admin/import/files/chunk", {
        fileSessionId,
        objectKey: file.objectKey,
        offset,
        dataBase64: file.dataBase64.slice(i, i + chunkSize),
      });
      offset = result.received;
    }
  }
  return fileSessionId;
}
const tableCounts = (payload: any) =>
  Object.fromEntries(
    Object.entries(payload.tables).map(([name, rows]) => [
      name,
      (rows as any[]).length,
    ]),
  );
async function sessionUnchanged() {
  const result = await pool.query('SELECT sess FROM "session" WHERE sid = $1', [
    "disposable-session",
  ]);
  assert.deepEqual(result.rows[0].sess, { marker: id });
}
try {
  await ensureSchema();
  await db
    .insert(usersTable)
    .values({
      username: admin,
      passwordHash: "disposable-test-hash",
      isAdmin: true,
    });
  await db
    .insert(wikiPagesTable)
    .values({
      slug: id,
      title: "Recovery page",
      content: "content",
      createdBy: admin,
      updatedBy: admin,
    });
  await db.insert(hostedSitesTable).values({ username: admin, active: true });
  for (const [i, bytes] of [png, html].entries())
    assert(
      (
        await appStorage.uploadFromBytes(sourceKeys[i], bytes, {
          compress: false,
        })
      ).ok,
    );
  await db
    .insert(wikiAssetsTable)
    .values({
      pageSlug: id,
      objectKey: sourceKeys[0],
      fileName: "image.png",
      contentType: "image/png",
      size: png.length,
      uploadedBy: admin,
    });
  await db
    .insert(hostedSiteFilesTable)
    .values({
      username: admin,
      path: "index.html",
      objectKey: sourceKeys[1],
      contentType: "text/html",
      size: html.length,
    });
  await pool.query(
    "INSERT INTO \"session\" (sid, sess, expire) VALUES ($1, $2, now() + interval '1 day')",
    ["disposable-session", { marker: id }],
  );
  const response = await fetch(base + "/admin/export", {
    headers: { "x-not-admin": "1" },
  });
  assert.equal(response.status, 403);
  const contents = await request("/admin/backup/contents");
  for (const name of [
    "wiki_pages",
    "wiki_assets",
    "hosted_sites",
    "hosted_site_files",
  ])
    assert(contents.tables.includes(name));
  assert(!contents.tables.includes("session"));
  const payload = await request("/admin/export");
  assert.equal(payload.version, 2);
  assert.equal(payload.complete, true);
  assert.equal(payload.files.length, 2);
  for (const file of payload.files) {
    const bytes = Buffer.from(file.dataBase64, "base64");
    assert.equal(bytes.length, file.size);
    assert.equal(digest(bytes), file.sha256);
  }
  assert(!("session" in payload.tables));
  await checkScheduledBackups(path.join(recovery, "copies"), sourceKeys[0], png, payload, sessionUnchanged);
  if (process.env.BACKUP_TEST_SCHEDULED_ONLY === "1") {
    assert.deepEqual(await readFile(path.join(disk, sourceKeys[0])), png);
    assert.deepEqual(await readFile(path.join(disk, sourceKeys[1])), html);
    console.log("PASS: disposable-only scheduled backup checks completed; original uploads and sessions preserved");
  } else {
  await request("/admin/import", { confirm: true, ...payload }, 400);

  // Corruption is rejected before any database replacement.
  const corrupt = structuredClone(payload);
  corrupt.files[0].sha256 = "0".repeat(64);
  const corruptId = await prepare(corrupt);
  await request(
    "/admin/import/begin",
    {
      confirm: true,
      version: 2,
      fileSessionId: corruptId,
      tableCounts: tableCounts(corrupt),
    },
    500,
  );
  assert.equal(
    (await db.select().from(wikiPagesTable))[0].title,
    "Recovery page",
  );
  await sessionUnchanged();

  // Missing bytes fail closed: no parseable complete backup can be produced.
  await appStorage.delete(sourceKeys[0]);
  const missingResponse = await fetch(base + "/admin/export");
  const missingText = await missingResponse.text();
  assert.throws(() => JSON.parse(missingText));
  assert((await appStorage.uploadFromBytes(sourceKeys[0], png)).ok);

  // Destination storage failure cannot alter metadata.
  const outageId = await prepare(payload);
  const originalCreate = appStorage.createFromBytes;
  appStorage.createFromBytes = async () => ({
    ok: false,
    error: { message: "Injected destination outage", statusCode: 503 },
  });
  await request(
    "/admin/import/begin",
    {
      confirm: true,
      version: 2,
      fileSessionId: outageId,
      tableCounts: tableCounts(payload),
    },
    500,
  );
  appStorage.createFromBytes = originalCreate;
  assert.equal(
    (await db.select().from(wikiPagesTable))[0].title,
    "Recovery page",
  );
  await sessionUnchanged();

  // A failure during database insertion rolls back the entire replacement.
  const duplicate = structuredClone(payload);
  duplicate.tables.users.push({ ...duplicate.tables.users[0] });
  const duplicateId = await prepare(duplicate);
  const duplicateBegin = await request("/admin/import/begin", {
    confirm: true,
    version: 2,
    fileSessionId: duplicateId,
    tableCounts: tableCounts(duplicate),
  });
  for (const [table, rows] of Object.entries(duplicate.tables)) {
    if ((rows as any[]).length)
      await request("/admin/import/rows", {
        sessionId: duplicateBegin.sessionId,
        table,
        rows,
      });
  }
  await request(
    "/admin/import/commit",
    { sessionId: duplicateBegin.sessionId },
    500,
  );
  assert.equal((await db.select().from(usersTable)).length, 1);
  assert.equal(
    (await db.select().from(wikiPagesTable))[0].title,
    "Recovery page",
  );
  await sessionUnchanged();

  // Fail after the first successful sequence restart, not just during inserts.
  // The live user ID is newer than the backup's ID. A nontransactional setval
  // would leave the sequence behind that live row after rollback.
  const [newerUser] = await db.insert(usersTable).values({
    username: `newer-${id}`, passwordHash: "disposable-newer-hash",
  }).returning();
  const sequenceBefore = (await pool.query("SELECT last_value, is_called FROM users_id_seq")).rows[0];
  const lateId = await prepare(payload);
  const lateBegin = await request("/admin/import/begin", {
    confirm: true, version: 2, fileSessionId: lateId, tableCounts: tableCounts(payload),
  });
  for (const [table, rows] of Object.entries(payload.tables)) {
    if ((rows as any[]).length) await request("/admin/import/rows", { sessionId: lateBegin.sessionId, table, rows });
  }
  // This test-only event trigger runs inside the private cluster. The counter
  // survives rollback so we can prove one ALTER succeeded before the failure.
  await pool.query(`
    CREATE SEQUENCE backup_test_reset_counter;
    CREATE FUNCTION backup_test_fail_late_reset() RETURNS event_trigger
      LANGUAGE plpgsql AS $$
      BEGIN
        IF nextval('backup_test_reset_counter') >= 2 THEN
          RAISE EXCEPTION 'Injected late sequence reset failure';
        END IF;
      END $$;
    CREATE EVENT TRIGGER backup_test_late_reset ON ddl_command_end
      WHEN TAG IN ('ALTER SEQUENCE') EXECUTE FUNCTION backup_test_fail_late_reset();
  `);
  try {
    const failed = await request("/admin/import/commit", { sessionId: lateBegin.sessionId }, 500);
    assert(failed.error.includes("rolled back"));
    assert.equal(Number((await pool.query("SELECT last_value FROM backup_test_reset_counter")).rows[0].last_value), 2, failed.error);
    assert.deepEqual((await pool.query("SELECT last_value, is_called FROM users_id_seq")).rows[0], sequenceBefore);
    assert.equal((await db.select().from(usersTable)).length, 2);
    const [probe] = await db.insert(usersTable).values({
      username: `probe-${id}`, passwordHash: "disposable-probe-hash",
    }).returning();
    assert.equal(probe.id, newerUser.id + 1);
    await db.execute(sql`DELETE FROM users WHERE id IN (${newerUser.id}, ${probe.id})`);
    await sessionUnchanged();
    assert.equal((await db.select().from(wikiPagesTable))[0].title, "Recovery page");
    console.log("PASS: late sequence-reset failure rolls back live rows and sequence state; next user ID remains safe");
  } finally {
    await pool.query(`
      DROP EVENT TRIGGER backup_test_late_reset;
      DROP FUNCTION backup_test_fail_late_reset();
      DROP SEQUENCE backup_test_reset_counter;
    `);
  }

  for (const backend of process.env.BACKUP_TEST_WITH_REPLIT === "1"
    ? ["local", "replit"]
    : ["local"]) {
    process.env.STORAGE_BACKEND = backend;
    const fileSessionId = await prepare(payload);
    const begin = await request("/admin/import/begin", {
      confirm: true,
      version: 2,
      fileSessionId,
      tableCounts: tableCounts(payload),
    });
    // No changes until commit; staging rows is non-destructive.
    await request("/admin/import/commit", { sessionId: begin.sessionId }, 400);
    for (const [table, rows] of Object.entries(payload.tables)) {
      if ((rows as any[]).length)
        await request("/admin/import/rows", {
          sessionId: begin.sessionId,
          table,
          rows,
        });
    }
    await db
      .update(wikiPagesTable)
      .set({ title: "Disposable change before recovery" });
    const commit = await request("/admin/import/commit", {
      sessionId: begin.sessionId,
    });
    assert.equal(commit.restoredFiles, 2);
    await sessionUnchanged();
    const roundTrip = await request("/admin/export");
    for (const [table, rows] of Object.entries(payload.tables)) {
      const expected = (rows as any[]).map((row) => {
        const copy = { ...row };
        if (table === "wiki_assets" || table === "hosted_site_files")
          delete copy.objectKey;
        return copy;
      });
      const actual = roundTrip.tables[table].map((row: any) => {
        const copy = { ...row };
        if (table === "wiki_assets" || table === "hosted_site_files")
          delete copy.objectKey;
        return copy;
      });
      assert.deepEqual(actual, expected, `round-trip ${table}`);
    }
    assert.equal(roundTrip.tables.wiki_pages[0].title, "Recovery page");
    assert.equal(roundTrip.tables.hosted_sites[0].active, true);
    assert.equal(roundTrip.tables.hosted_site_files[0].path, "index.html");
    assert.equal(roundTrip.files.length, 2);
    for (const file of roundTrip.files) {
      assert(file.objectKey.startsWith("restores/"));
      assert(!sourceKeys.includes(file.objectKey));
      assert([digest(png), digest(html)].includes(file.sha256));
    }
    // Explicit serial IDs must not collide with the next upload.
    const [newAsset] = await db
      .insert(wikiAssetsTable)
      .values({
        pageSlug: id,
        objectKey: `disposable-${id}`,
        fileName: "next.png",
        contentType: "image/png",
        size: 0,
        uploadedBy: admin,
      })
      .returning();
    assert(newAsset.id > payload.tables.wiki_assets[0].id);
    await db.execute(sql`DELETE FROM wiki_assets WHERE id = ${newAsset.id}`);
    console.log(
      `PASS ${backend}: complete export, staged atomic restore, records, bytes, checksums, sessions and sequences`,
    );
  }
  process.env.STORAGE_BACKEND = "local";
  assert.deepEqual(await readFile(path.join(disk, sourceKeys[0])), png);
  assert.deepEqual(await readFile(path.join(disk, sourceKeys[1])), html);
  const collision = await appStorage.createFromBytes(sourceKeys[0], html);
  assert(!collision.ok);
  assert.deepEqual(await readFile(path.join(disk, sourceKeys[0])), png);
  console.log("PASS: original local storage preserved; collision rejected");
  // Optional browser harness. The API and data here belong exclusively to
  // the runner's private PostgreSQL cluster, never the workspace database.
  if (process.env.BACKUP_TEST_UI_DIR) {
    process.env.STORAGE_BACKEND =
      process.env.BACKUP_TEST_WITH_REPLIT === "1" ? "replit" : "local";
    app.use(express.static(process.env.BACKUP_TEST_UI_DIR));
    app.use(
      "/assets",
      express.static(path.resolve("..", "photo-desktop/dist/public/assets")),
    );
    app.get("/fixture.json", (_req, res) => res.json(payload));
    console.log(`DISPOSABLE BACKUP UI READY ${base.replace("/api", "/")}`);
    await new Promise<void>((resolve) => {
      process.once("SIGTERM", () => resolve());
      process.once("SIGINT", () => resolve());
    });
  }
  }
} finally {
  for (const [backend, keys] of createdKeys) {
    process.env.STORAGE_BACKEND = backend;
    for (const key of keys)
      await appStorage.delete(key, { ignoreNotFound: true });
  }
  await new Promise<void>((resolve) => server.close(() => resolve()));
  await pool.end();
  await storageJournalPool.end();
  await rm(disk, { recursive: true, force: true });
  await rm(recovery, { recursive: true, force: true });
}
