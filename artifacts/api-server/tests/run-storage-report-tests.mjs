import { build } from "esbuild";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const directory = await mkdtemp(path.join(tmpdir(), "storage-report-tests-"));
try {
  const outfile = path.join(directory, "test.mjs");
  await build({
    entryPoints: [fileURLToPath(new URL("./storage-report.test.ts", import.meta.url))],
    outfile, bundle: true, platform: "node", format: "esm",
  });
  const result = spawnSync(process.execPath, [outfile], { stdio: "inherit" });
  process.exitCode = result.status ?? 1;
} finally {
  await rm(directory, { recursive: true, force: true });
}
