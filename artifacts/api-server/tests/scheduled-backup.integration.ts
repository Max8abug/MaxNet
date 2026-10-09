import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { chmod, lstat, mkdir, readFile, readdir, rm, symlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { pool } from "@workspace/db";
import { runScheduledBackup } from "../src/lib/scheduled-backup";
import { exportSiteBackup } from "../src/lib/site-backup";
import { appStorage } from "../src/lib/app-storage";

// Called only by the existing private-cluster harness with its generated data.
export async function checkScheduledBackups(directory: string, sourceKey: string, sourceBytes: Buffer, expected: any, sessionsUnchanged: () => Promise<void>) {
  const options = { destination: directory, keep: 2 };
  await mkdir(directory, { mode: 0o700 });
  const originalRows = (await pool.query("SELECT * FROM users")).rows;
  const first = await runScheduledBackup(options);
  const decoded = JSON.parse(await readFile(first.path, "utf8"));
  assert.deepEqual(decoded.tables, expected.tables);
  assert.deepEqual(decoded.files, expected.files);
  assert.equal(decoded.version, 2);
  assert.equal(decoded.complete, true);
  assert.equal((await lstat(first.path)).mode & 0o777, 0o600);
  assert.equal((await lstat(directory)).mode & 0o777, 0o700);
  assert.equal(first.fileCount, expected.files.length);
  assert(!("session" in decoded.tables));
  await sessionsUnchanged();
  assert.deepEqual((await pool.query("SELECT * FROM users")).rows, originalRows);
  const cli = path.resolve("dist/scheduled-backup-cli.mjs");
  const invalid = spawnSync(process.execPath, [cli, `--destination=${directory}`, "--keep=2"], {
    encoding: "utf8", env: { ...process.env, DATABASE_URL: "" },
  });
  assert.notEqual(invalid.status, 0);
  assert.match(invalid.stderr, /--enabled opt-in/);
  const noConfig = spawnSync(process.execPath, [cli, "--help"], {
    encoding: "utf8", env: { ...process.env, DATABASE_URL: "" },
  });
  assert.equal(noConfig.status, 0);
  const unknown = spawnSync(process.execPath, [cli, "--enabled", "--unknown=value"], {
    encoding: "utf8", env: { ...process.env, DATABASE_URL: "" },
  });
  assert.notEqual(unknown.status, 0);
  assert.match(unknown.stderr, /Invalid option/);
  // Use the actual built command, inheriting ONLY this harness's private DB.
  const cliDirectory = path.join(directory, "cli");
  const command = spawnSync(process.execPath, [cli, "--enabled", `--destination=${cliDirectory}`, "--keep=2"], {
    encoding: "utf8",
  });
  assert.equal(command.status, 0, command.stderr);
  const commandSummary = JSON.parse(command.stdout);
  assert.deepEqual(JSON.parse(await readFile(commandSummary.path, "utf8")).tables, expected.tables);
  await rm(cliDirectory, { recursive: true });
  console.log("PASS scheduled CLI: help/invalid opt-in need no database; built one-shot command saves complete recovery JSON");
  const untouched = path.join(directory, "owner-manual-backup.json");
  const partial = path.join(directory, ".abandoned.partial");
  await writeFile(untouched, "owner");
  await writeFile(partial, "incomplete");
  const fake = "site-backup-2000-01-01T00-00-00-000Z-00000000-0000-0000-0000-000000000000.json";
  await symlink(untouched, path.join(directory, fake));
  const second = await runScheduledBackup(options);
  const third = await runScheduledBackup(options);
  assert.equal(third.pruned, 1);
  assert(!(await readdir(directory)).includes(path.basename(first.path)));
  assert((await readdir(directory)).includes(path.basename(second.path)));
  assert.equal(await readFile(untouched, "utf8"), "owner");
  assert.equal(await readFile(partial, "utf8"), "incomplete");
  assert((await lstat(path.join(directory, fake))).isSymbolicLink());

  const before = (await readdir(directory)).sort();
  await appStorage.delete(sourceKey);
  await assert.rejects(runScheduledBackup({ ...options, keep: 1 }), /Backup failed/);
  assert.deepEqual((await readdir(directory)).sort(), before, "failure must not retain partials or prune good copies");
  assert((await appStorage.uploadFromBytes(sourceKey, Buffer.from("wrong length"))).ok);
  await assert.rejects(runScheduledBackup(options), /expected .* bytes/);
  assert((await appStorage.uploadFromBytes(sourceKey, sourceBytes)).ok);
  await pool.query("ALTER TABLE chat_audit_log RENAME TO scheduled_test_hidden");
  try {
    await assert.rejects(runScheduledBackup(options), /chat_audit_log/);
  } finally {
    await pool.query("ALTER TABLE scheduled_test_hidden RENAME TO chat_audit_log");
  }
  assert.deepEqual((await readdir(directory)).sort(), before);

  // A held namespace lock makes overlap visible; it is not removed by a loser.
  await mkdir(path.join(directory, ".site-backup.lock"));
  await assert.rejects(runScheduledBackup(options), /Another backup/);
  assert((await lstat(path.join(directory, ".site-backup.lock"))).isDirectory());
  await rm(path.join(directory, ".site-backup.lock"), { recursive: true });
  await chmod(directory, 0o755);
  await assert.rejects(runScheduledBackup(options), /0700/);
  await chmod(directory, 0o700);
  await assert.rejects(runScheduledBackup({ ...options, keep: 0 }), /Retention/);
  await assert.rejects(runScheduledBackup({ ...options, destination: process.env.UPLOAD_STORAGE_DIR! }), /outside upload/);
  await assert.rejects(runScheduledBackup({ ...options, recipient: "AGE-SECRET-KEY-invalid" }), /public recipient/);
  const aliased = directory + "-symlink";
  await symlink(directory, aliased);
  try { await assert.rejects(runScheduledBackup({ ...options, destination: aliased }), /real directory/); }
  finally { await rm(aliased); }
  await assert.rejects(exportSiteBackup(async () => { throw new Error("Injected output failure"); }), /Injected output failure/);
  await sessionsUnchanged();
  assert.deepEqual((await pool.query("SELECT * FROM users")).rows, originalRows);
  console.log("PASS scheduled: v2 coverage, private permissions, retention, missing bytes/table, mismatched sizes, overlap, output failure, unchanged sessions and rows");

  // age is a deliberate optional system dependency. CI verification supplies it
  // on PATH; the owner's unencrypted installation does not need it.
  const identity = path.join(directory, ".test-age-identity");
  const generated = spawnSync("age-keygen", ["-o", identity], { encoding: "utf8" });
  assert.equal(generated.status, 0, "Verification requires age and age-keygen on PATH.");
  try {
    const recipient = spawnSync("age-keygen", ["-y", identity], { encoding: "utf8" }).stdout.trim();
    const encrypted = await runScheduledBackup({ ...options, recipient });
    const ciphertext = await readFile(encrypted.path, "utf8");
    assert(ciphertext.startsWith("age-encryption.org/"));
    assert(!ciphertext.includes("disposable-test-hash"));
    const decrypted = spawnSync("age", ["--decrypt", "--identity", identity, encrypted.path], { encoding: "utf8", maxBuffer: 32 * 1024 * 1024 });
    assert.equal(decrypted.status, 0, decrypted.stderr);
    const recovered = JSON.parse(decrypted.stdout);
    assert.deepEqual(recovered.tables, expected.tables);
    assert.deepEqual(recovered.files, expected.files);
    const beforeFailure = (await readdir(directory)).sort();
    await assert.rejects(runScheduledBackup({ ...options, recipient: "age1invalid" }), /encryption failed/);
    assert.deepEqual((await readdir(directory)).sort(), beforeFailure);
    const oldPath = process.env.PATH;
    process.env.PATH = "/nonexistent";
    try {
      await assert.rejects(runScheduledBackup({ ...options, recipient }), /ENOENT|EPIPE|destroyed/i);
    } finally { process.env.PATH = oldPath; }
    assert.deepEqual((await readdir(directory)).sort(), beforeFailure);
    console.log("PASS scheduled encryption: real age decrypts to restorable v2 JSON; invalid recipient/missing executable fail without pruning");
  } finally { await rm(identity, { force: true }); }
}
