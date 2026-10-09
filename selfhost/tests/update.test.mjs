import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, copyFileSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { test } from "node:test";

function runUpdate({ version = "10.26.1", failPreflight = false, localChanges = "" } = {}) {
  const root = mkdtempSync(join(tmpdir(), "portfolio98-update-test-"));
  try {
    mkdirSync(join(root, "selfhost"));
    mkdirSync(join(root, "bin"));
    copyFileSync(new URL("../update.sh", import.meta.url), join(root, "selfhost/update.sh"));
    writeFileSync(join(root, "package.json"), JSON.stringify({ packageManager: "pnpm@10.26.1" }));
    writeFileSync(join(root, "events"), "");
    const script = (name, body) => writeFileSync(join(root, "bin", name), `#!/usr/bin/env bash\nset -eu\n${body}\n`, { mode: 0o755 });
    script("git", `
if [[ "$1" == "-C" ]]; then shift 2; fi
case "$*" in
  'rev-parse --is-inside-work-tree') echo true ;;
  'rev-parse --abbrev-ref HEAD') echo main ;;
  'rev-parse --short HEAD')
    if [[ -e "$TEST_ROOT/pulled" ]]; then echo 2222222; else echo 1111111; fi ;;
  'status --porcelain --untracked-files=all') printf '%s' "$TEST_LOCAL_CHANGES" ;;
  'pull --ff-only origin main') touch "$TEST_ROOT/pulled"; echo pull >> "$TEST_ROOT/events" ;;
  'log --oneline 1111111..2222222') echo '2222222 Test update' ;;
  *) echo "Unexpected git call: $*" >&2; exit 23 ;;
esac`);
    script("pnpm", `
if [[ "$*" == "--version" ]]; then echo "$TEST_PNPM_VERSION"; exit 0; fi
if [[ "$*" == "install --frozen-lockfile --lockfile-only --ignore-scripts --offline" ]]; then
  echo preflight >> "$TEST_ROOT/events"
  if [[ "$TEST_FAIL_PREFLIGHT" == 1 ]]; then echo ERR_PNPM_LOCKFILE_CONFIG_MISMATCH >&2; exit 1; fi
elif [[ "$*" == "install --frozen-lockfile" ]]; then
  echo install >> "$TEST_ROOT/events"
elif [[ "$*" == "--filter @workspace/api-server run build" || "$*" == "--filter @workspace/photo-desktop run build" ]]; then
  echo build >> "$TEST_ROOT/events"
else
  echo "Unexpected pnpm call: $*" >&2; exit 23
fi`);
    for (const name of ["stop", "start"]) {
      writeFileSync(join(root, "selfhost", `${name}.sh`), `#!/usr/bin/env bash\necho ${name} >> "$TEST_ROOT/events"\n`);
    }
    const result = spawnSync("bash", [join(root, "selfhost/update.sh")], {
      cwd: root,
      encoding: "utf8",
      timeout: 10000,
      env: {
        ...process.env,
        HOME: join(root, "home"),
        PATH: `${join(root, "bin")}:${process.env.PATH}`,
        TEST_ROOT: root,
        TEST_PNPM_VERSION: version,
        TEST_FAIL_PREFLIGHT: failPreflight ? "1" : "0",
        TEST_LOCAL_CHANGES: localChanges,
      },
    });
    assert.ifError(result.error);
    return { status: result.status, output: result.stdout + result.stderr, events: readFileSync(join(root, "events"), "utf8").trim().split("\n").filter(Boolean) };
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

test("wrong pnpm version stops before services or dependency changes", () => {
  const result = runUpdate({ version: "9.15.0" });
  assert.equal(result.status, 1, result.output);
  assert.match(result.output, /requires pnpm@10\.26\.1/);
  assert.match(result.output, /Services have not been stopped/);
  assert.deepEqual(result.events, ["pull"]);
});

test("frozen-lockfile preflight failure leaves services untouched", () => {
  const result = runUpdate({ failPreflight: true });
  assert.equal(result.status, 1, result.output);
  assert.match(result.output, /Dependency preflight failed/);
  assert.deepEqual(result.events, ["pull", "preflight"]);
});

test("successful update validates before stopping, installing, building and starting", () => {
  const result = runUpdate();
  assert.equal(result.status, 0, result.output);
  assert.deepEqual(result.events, ["pull", "preflight", "stop", "install", "build", "build", "start"]);
});

test("dirty worktree fails before pulling or stopping services", () => {
  const result = runUpdate({ localChanges: '?? "tatus --short"\n' });
  assert.equal(result.status, 1, result.output);
  assert.match(result.output, /Local changes prevent a safe update/);
  assert.deepEqual(result.events, []);
});
