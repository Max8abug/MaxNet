import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, symlink, rm, readdir, readFile, lstat } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { classifyStorageInventory, type StorageReference } from "../src/lib/storage-report";
import { listBucketObjects, listLocalObjects, type StoredObject } from "../src/lib/storage-inventory";

const options = { scope: "local:/owner/storage", startedAt: new Date("2026-10-09T12:00:00Z"), minAgeHours: 24, maxObjects: 1000 };
const old = new Date("2026-10-01T00:00:00Z");
async function* objects(values: StoredObject[]) { yield* values; }
const references: StorageReference[] = [
  { object_key: "wiki/page/live", source: "wiki", scope: null },
  { object_key: "user-sites/owner/live", source: "hosted-site", scope: null },
  { object_key: "wiki/page/pending", source: "cleanup", scope: options.scope },
  { object_key: "wiki/page/other-scope", source: "cleanup", scope: "replit" },
];
const report = await classifyStorageInventory(objects([
  ...references.map(row => ({ key: row.object_key, changedAt: old })),
  { key: "wiki/page/legacy.png", sizeBytes: 50, changedAt: old },
  { key: "user-sites/owner/legacy", sizeBytes: 0, changedAt: old },
  { key: "wiki/page/upload-in-progress", changedAt: new Date("2026-10-09T11:00:00Z") },
  { key: "wiki/page/future", changedAt: new Date("2027-10-09T11:00:00Z") },
  { key: "wiki/page/unknown-age" },
  { key: "wiki/page/invalid-age", changedAt: new Date("invalid") },
  { key: "wiki/page/legacy.UUID.tmp", changedAt: old },
  { key: "wiki/page/.partial", changedAt: old },
  { key: "wiki/../external", changedAt: old },
  { key: "wiki/page/link", changedAt: old, unsafe: true },
  { key: "restores/uuid/file", changedAt: old },
]), references, options);
assert.deepEqual(report.candidates.map(row => row.key), ["wiki/page/legacy.png", "user-sites/owner/legacy"]);
assert.equal(report.candidates.reduce((total, row) => total + (row.sizeBytes ?? 0), 0), 50);
assert.equal(report.needsReview.length, 2);
assert.deepEqual(report.excluded, { referenced: 2, cleanupIntent: 2, recent: 2, temporaryOrUnsafe: 5 });
assert.deepEqual(report.cleanupIntents, { currentScope: 1, otherScopes: 1 });
assert.equal(report.readOnly, true);
await assert.rejects(classifyStorageInventory(objects([{ key: "wiki/a/b" }, { key: "wiki/a/c" }]), [], { ...options, maxObjects: 1 }), /limit exceeded/);
await assert.rejects(classifyStorageInventory(objects([]), [], { ...options, minAgeHours: 0 }), /Invalid report limits/);
const controller = new AbortController();
controller.abort();
await assert.rejects(classifyStorageInventory(objects([{ key: "wiki/a/b" }]), [], { ...options, signal: controller.signal }));

// Simulate inclusive paginated listing. Missing ages cannot become candidates.
const calls: { prefix: string; startOffset?: string }[] = [];
const bucket = listBucketObjects(async args => {
  calls.push(args);
  const names = args.prefix === "wiki/" ? ["wiki/a/1", "wiki/a/2", "wiki/a/3"] : ["user-sites/a/1"];
  const offset = args.startOffset ? names.indexOf(args.startOffset) : 0;
  return { ok: true, value: names.slice(offset, offset + 2).map(name => ({ name })) };
});
const bucketReport = await classifyStorageInventory(bucket, [], options);
assert.equal(bucketReport.scanned, 4);
assert.equal(bucketReport.candidates.length, 0);
assert.equal(bucketReport.needsReview.length, 4);
assert.ok(calls.some(call => call.startOffset === "wiki/a/2"));
await assert.rejects(classifyStorageInventory(listBucketObjects(async () => ({ ok: false, error: { message: "offline" } })), [], options), /offline/);
await assert.rejects(classifyStorageInventory(listBucketObjects(async () => ({ ok: true, value: [{ name: "outside/file" }] })), [], options), /invalid or unordered/);

// Only disposable fixture directories are written. No database is used.
const root = await mkdtemp(path.join(tmpdir(), "storage-report-"));
const external = await mkdtemp(path.join(tmpdir(), "storage-report-outside-"));
try {
  await mkdir(path.join(root, "wiki/page"), { recursive: true });
  await mkdir(path.join(root, "user-sites/owner"), { recursive: true });
  await mkdir(path.join(root, "restores/id"), { recursive: true });
  const livePath = path.join(root, "wiki/page/live");
  await writeFile(livePath, "live bytes");
  await writeFile(path.join(root, "wiki/page/write.uuid.tmp"), "partial bytes");
  await writeFile(path.join(root, "user-sites/owner/recent"), "new upload");
  await writeFile(path.join(root, "restores/id/out-of-scope"), "not inventoried");
  await writeFile(path.join(external, "outside"), "never followed");
  await symlink(external, path.join(root, "wiki/external"));
  await symlink(path.join(external, "outside"), path.join(root, "wiki/page/symlink"));
  const before = await readdir(root, { recursive: true });
  const beforeStat = await lstat(livePath);
  const diskReport = await classifyStorageInventory(listLocalObjects(root), references, { ...options, startedAt: new Date() });
  assert.equal(diskReport.candidates.length, 0);
  assert.equal(diskReport.needsReview.length, 0);
  assert.equal(diskReport.excluded.referenced, 1);
  assert.equal(diskReport.excluded.recent, 1);
  assert.equal(diskReport.excluded.temporaryOrUnsafe, 3);
  assert.deepEqual(await readdir(root, { recursive: true }), before);
  assert.equal(await readFile(livePath, "utf8"), "live bytes");
  const afterStat = await lstat(livePath);
  assert.equal(afterStat.mtimeMs, beforeStat.mtimeMs);
  assert.equal(afterStat.ctimeMs, beforeStat.ctimeMs);
  assert.equal(await readFile(path.join(root, "wiki/page/write.uuid.tmp"), "utf8"), "partial bytes");
  await assert.rejects(classifyStorageInventory(listLocalObjects(path.join(root, "missing")), [], options), /ENOENT/);
  const rootLink = path.join(external, "root-link");
  await symlink(root, rootLink);
  await assert.rejects(classifyStorageInventory(listLocalObjects(rootLink), [], options), /not a symlink/);
} finally {
  await rm(root, { recursive: true, force: true });
  await rm(external, { recursive: true, force: true });
}
console.log("Storage report checks passed: conservative classification, pagination, errors, and unchanged fixture files.");
