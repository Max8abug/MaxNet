import { randomUUID } from "node:crypto";
import { createWriteStream, existsSync } from "node:fs";
import { link, lstat, mkdir, open, readdir, realpath, rm, unlink } from "node:fs/promises";
import path from "node:path";
import { spawn } from "node:child_process";
import { pipeline, finished } from "node:stream/promises";
import { type Writable } from "node:stream";
import { fileURLToPath } from "node:url";
import { storageScope } from "./app-storage";
import { exportSiteBackup } from "./site-backup";

export type BackupOptions = { destination: string; keep: number; recipient?: string };
const backupName = /^site-backup-\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}-\d{3}Z-[0-9a-f-]{36}\.json(?:\.age)?$/;
const inside = (directory: string, root: string) =>
  directory === root || directory.startsWith(`${root}${path.sep}`);

export async function runScheduledBackup(options: BackupOptions) {
  if (!path.isAbsolute(options.destination)) throw new Error("Backup destination must be an absolute path.");
  if (!Number.isSafeInteger(options.keep) || options.keep < 1 || options.keep > 10000) throw new Error("Retention count must be between 1 and 10000.");
  if (options.recipient !== undefined && !/^age1[0-9a-z]+$/.test(options.recipient)) throw new Error("Use a native age public recipient (age1...), never a private key.");
  const scope = storageScope();
  const lexical = path.resolve(options.destination);
  if (scope.startsWith("local:") && inside(lexical, scope.slice(6))) throw new Error("Backup destination must be outside upload storage.");
  await mkdir(lexical, { recursive: true, mode: 0o700 });
  const stat = await lstat(lexical);
  if (!stat.isDirectory() || stat.isSymbolicLink() ||
      (stat.mode & 0o077) !== 0 || stat.uid !== process.getuid?.()) {
    throw new Error("Backup destination must be a real directory owned by this user with mode 0700.");
  }
  const directory = await realpath(lexical);
  // Works from both source and the compiled CLI/test bundles. Backups may
  // contain secrets and must never sit in this checkout's static web trees.
  let project = path.dirname(fileURLToPath(import.meta.url));
  while (project !== path.dirname(project) && !existsSync(path.join(project, "pnpm-workspace.yaml"))) {
    project = path.dirname(project);
  }
  if (existsSync(path.join(project, "pnpm-workspace.yaml")) && inside(directory, await realpath(project))) {
    throw new Error("Backup destination must be outside the Git checkout and public web roots.");
  }
  if (scope.startsWith("local:")) {
    const root = await realpath(scope.slice(6)).catch(() => path.resolve(scope.slice(6)));
    if (inside(directory, root)) throw new Error("Backup destination must be outside upload storage.");
  }
  const lock = path.join(directory, ".site-backup.lock");
  try {
    await mkdir(lock, { mode: 0o700 });
  } catch (error: any) {
    if (error.code === "EEXIST") throw new Error("Another backup is running, or a stale .site-backup.lock needs operator review.");
    throw error;
  }
  const name = `site-backup-${new Date().toISOString().replace(/[:.]/g, "-")}-${randomUUID()}.json${options.recipient ? ".age" : ""}`;
  const temporary = path.join(directory, `.${name}.partial`);
  const destination = path.join(directory, name);
  let sink: Writable | undefined;
  let output: Writable | undefined;
  let encryption: ReturnType<typeof spawn> | undefined;
  let completion: Promise<void> | undefined;
  let encryptionExit: Promise<void> | undefined;
  let published = false;
  try {
    output = createWriteStream(temporary, { flags: "wx", mode: 0o600 });
    // Attach failure observers immediately, including before any data is read.
    if (options.recipient) {
      encryption = spawn("age", ["--encrypt", "--recipient", options.recipient], { stdio: ["pipe", "pipe", "pipe"] });
      const child = encryption;
      let diagnostic = "";
      child.stderr!.on("data", bytes => { diagnostic = (diagnostic + bytes.toString()).slice(-2000); });
      const exited = new Promise<void>((resolve, reject) => {
        child.once("error", reject);
        child.once("close", code => code === 0 ? resolve() : reject(new Error(`age encryption failed (${code}): ${diagnostic}`)));
      });
      encryptionExit = exited;
      sink = child.stdin!;
      completion = Promise.all([pipeline(child.stdout!, output), exited]).then(() => {});
    } else {
      sink = output;
      completion = finished(output);
    }
    sink.on("error", () => {});
    void completion.catch(error => sink?.destroy(error));
    const summary = await exportSiteBackup(chunk => new Promise<void>((resolve, reject) => {
      sink!.write(chunk, error => error ? reject(error) : resolve());
    }));
    sink.end();
    await completion;
    const file = await open(temporary, "r");
    try { await file.sync(); } finally { await file.close(); }
    // Exclusive publication, never overwrite an existing recovery copy.
    await link(temporary, destination);
    published = true;
    await unlink(temporary);
    const directoryHandle = await open(directory, "r");
    try { await directoryHandle.sync(); } finally { await directoryHandle.close(); }

    // Only completed files in our namespace; never touch uploads, partials,
    // subdirectories, symlinks, manually named backups or unrelated files.
    const candidates: string[] = [];
    for (const entry of await readdir(directory)) {
      if (!backupName.test(entry)) continue;
      const info = await lstat(path.join(directory, entry));
      if (info.isFile() && !info.isSymbolicLink()) candidates.push(entry);
    }
    const older = candidates.filter(entry => entry !== name).sort().reverse();
    let pruned = 0;
    for (const entry of older.slice(options.keep - 1)) {
      await unlink(path.join(directory, entry));
      pruned++;
    }
    return { path: destination, encrypted: !!options.recipient, ...summary, pruned };
  } catch (error: any) {
    if (encryptionExit && ["EPIPE", "ERR_STREAM_DESTROYED"].includes(error.code)) {
      await encryptionExit.catch(failure => { error = failure; });
    }
    throw new Error(`${published ? `Backup saved at ${destination}, but post-save processing failed` : "Backup failed; no completed recovery copy published"}: ${error.message}`);
  } finally {
    sink?.destroy();
    output?.destroy();
    encryption?.kill("SIGTERM");
    await completion?.catch(() => {});
    await rm(temporary, { force: true });
    await rm(lock, { recursive: true });
  }
}
