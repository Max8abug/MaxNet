import { build } from "esbuild";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const directory = await mkdtemp(path.join(tmpdir(), "feature-archives-tests-"));
try {
  const outfile = path.join(directory, "test.mjs");
  await build({
    entryPoints: [fileURLToPath(new URL("./feature-archives.test.ts", import.meta.url))],
    outfile, bundle: true, platform: "node", format: "esm",
    banner: { js: "import { createRequire } from 'node:module'; const require = createRequire(import.meta.url);" },
    plugins: [{
      name: "isolated-archive-tests",
      setup(build) {
        build.onResolve({ filter: /^@workspace\/db$/ }, () => ({
          path: fileURLToPath(new URL("./feature-archives-db.ts", import.meta.url)),
        }));
        build.onResolve({ filter: /^\.\.\/lib\/auth$/ }, () => ({ path: "auth", namespace: "archive-test" }));
        build.onLoad({ filter: /^auth$/, namespace: "archive-test" }, () => ({
          contents: "export const requireAdmin = (_req, res) => res.status(403).json({ error: 'Forbidden' });",
        }));
      },
    }],
  });
  const result = spawnSync(process.execPath, [outfile], { stdio: "inherit" });
  process.exitCode = result.status ?? 1;
} finally {
  await rm(directory, { recursive: true, force: true });
}
