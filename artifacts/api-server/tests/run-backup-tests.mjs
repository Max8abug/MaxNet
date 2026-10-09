// Starts a private PostgreSQL cluster. Never connects to DATABASE_URL.
import { build } from "esbuild";
import { mkdtemp, rm, readFile, writeFile, readdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawn, spawnSync } from "node:child_process";
import net from "node:net";

const dir = await mkdtemp(path.join(tmpdir(), "backup-postgres-"));
const bundleDir = await mkdtemp(
  fileURLToPath(new URL("../.backup-tests-", import.meta.url)),
);
let started = false;
function run(command, args) {
  const result = spawnSync(command, args, { encoding: "utf8" });
  if (result.status !== 0)
    throw new Error(`${command} failed: ${result.stderr || result.stdout}`);
}
try {
  const listener = net.createServer();
  await new Promise((resolve) => listener.listen(0, "127.0.0.1", resolve));
  const port = listener.address().port;
  await new Promise((resolve) => listener.close(resolve));
  run("initdb", [
    "-D",
    path.join(dir, "db"),
    "-A",
    "trust",
    "-U",
    "backup_test",
    "--no-locale",
  ]);
  run("pg_ctl", [
    "-D",
    path.join(dir, "db"),
    "-l",
    path.join(dir, "postgres.log"),
    "-o",
    `-h 127.0.0.1 -p ${port} -k ${dir}`,
    "-w",
    "start",
  ]);
  started = true;
  const outfile = path.join(bundleDir, "test.mjs");
  await build({
    entryPoints: [
      fileURLToPath(new URL("./backup.integration.ts", import.meta.url)),
    ],
    outfile,
    bundle: true,
    platform: "node",
    format: "esm",
    external: [
      "@replit/object-storage",
      "pg-native",
      "pino",
      "bcryptjs",
      "connect-pg-simple",
      "express-session",
    ],
    banner: {
      js: "import { createRequire } from 'node:module'; const require = createRequire(import.meta.url);",
    },
  });
  const ui = process.argv.includes("--ui");
  if (ui) {
    await build({
      entryPoints: [
        fileURLToPath(
          new URL("../../photo-desktop/tests/backup-ui.tsx", import.meta.url),
        ),
      ],
      outfile: path.join(bundleDir, "ui.js"),
      bundle: true,
      platform: "browser",
      format: "esm",
      jsx: "automatic",
      define: { "process.env.NODE_ENV": '"production"' },
    });
    const assets = await readdir(
      fileURLToPath(
        new URL("../../photo-desktop/dist/public/assets", import.meta.url),
      ),
    );
    const css = assets.find((name) => name.endsWith(".css"));
    await writeFile(
      path.join(bundleDir, "index.html"),
      `<!doctype html><html><head><meta charset="utf-8"><title>Disposable backup test</title><link rel="stylesheet" href="/assets/${css}"></head><body><div id="root"></div><script type="module" src="/ui.js"></script></body></html>`,
    );
  }
  const child = spawn(process.execPath, [outfile], {
    stdio: "inherit",
    env: {
      ...process.env,
      NODE_ENV: "production",
      DATABASE_URL: `postgresql://backup_test@127.0.0.1:${port}/postgres`,
      BACKUP_TEST_WITH_REPLIT: process.argv.includes("--with-replit")
        ? "1"
        : "0",
      ...(ui
        ? { BACKUP_TEST_UI_DIR: bundleDir, BACKUP_TEST_UI_PORT: "8099" }
        : {}),
    },
  });
  const stop = () => child.kill("SIGTERM");
  process.once("SIGTERM", stop);
  process.once("SIGINT", stop);
  process.exitCode = await new Promise((resolve) =>
    child.once("exit", (code) => resolve(code ?? 1)),
  );
  process.off("SIGTERM", stop);
  process.off("SIGINT", stop);
} catch (error) {
  console.error(error.message);
  const log = await readFile(path.join(dir, "postgres.log"), "utf8").catch(
    () => "",
  );
  if (log) console.error(log);
  process.exitCode = 1;
} finally {
  if (started)
    run("pg_ctl", [
      "-D",
      path.join(dir, "db"),
      "-m",
      "immediate",
      "-w",
      "stop",
    ]);
  await rm(dir, { recursive: true, force: true });
  await rm(bundleDir, { recursive: true, force: true });
}
