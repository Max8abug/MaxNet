import { build } from "esbuild";
import { mkdtemp, rm } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { spawnSync } from "node:child_process";

if (!process.argv.includes("--disposable-data")) {
  throw new Error("Pass --disposable-data to confirm creating and cleaning up isolated test records in the configured database. Never run against production.");
}
const dir = await mkdtemp(path.join(fileURLToPath(new URL("../", import.meta.url)), ".storage-tests-"));
try {
  const outfile = path.join(dir, "test.mjs");
  await build({
    entryPoints: [fileURLToPath(new URL("./storage.integration.ts", import.meta.url))],
    outfile, bundle: true, platform: "node", format: "esm",
    external: ["@replit/object-storage", "pg-native", "pino", "bcryptjs"],
    banner: { js: "import { createRequire } from 'node:module'; const require = createRequire(import.meta.url);" },
  });
  const result = spawnSync(process.execPath, [outfile], { stdio: "inherit", env: { ...process.env, NODE_ENV: "production" } });
  process.exitCode = result.status ?? 1;
} finally {
  await rm(dir, { recursive: true, force: true });
}
