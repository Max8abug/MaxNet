import { build } from "esbuild";
import { mkdtemp, rm } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const testDirectory = path.dirname(fileURLToPath(import.meta.url));
const directory = await mkdtemp(path.join(testDirectory, ".game-saves-tests-"));
try {
  const outfile = path.join(directory, "test.mjs");
  await build({
    entryPoints: [fileURLToPath(new URL("./game-saves.test.ts", import.meta.url))],
    outfile,
    bundle: true,
    platform: "node",
    format: "esm",
    external: ["express"],
  });
  const result = spawnSync(process.execPath, [outfile], { stdio: "inherit" });
  process.exitCode = result.status ?? 1;
} finally {
  await rm(directory, { recursive: true, force: true });
}
