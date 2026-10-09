import { MIN_REPORT_AGE_HOURS, MAX_REPORT_OBJECTS } from "./lib/storage-report";

const help = `Read-only wiki/hosted-site storage report (no deletion or migration).
Usage: pnpm --filter @workspace/api-server run storage:report --read-only
       [--min-age-hours=24] [--max-objects=100000]

Use the same database and STORAGE_BACKEND/UPLOAD_STORAGE_DIR configuration as
the owner’s server. Run during a quiet period; uploads may pause briefly.
Output is JSON on stdout. Errors go to stderr with a nonzero exit status.
Objects without age information are needsReview, never aged candidates.
`;

async function main() {
  const args = process.argv.slice(2);
  if (args.includes("--help")) {
    console.log(help);
    return;
  }
  if (!args.includes("--read-only")) throw new Error(`Explicit --read-only opt-in is required.\n${help}`);
  let minAgeHours = MIN_REPORT_AGE_HOURS;
  let maxObjects = MAX_REPORT_OBJECTS;
  const seen = new Set<string>();
  for (const arg of args) {
    const [name, value, extra] = arg.split("=");
    if (seen.has(name)) throw new Error(`Duplicate option: ${name}`);
    seen.add(name);
    if (arg === "--read-only") continue;
    if (extra !== undefined || !["--min-age-hours", "--max-objects"].includes(name) || !/^\d+$/.test(value ?? "")) {
      throw new Error(`Invalid option: ${arg}`);
    }
    const number = Number(value);
    if (!Number.isSafeInteger(number)) throw new Error(`Invalid number for ${name}`);
    if (name === "--min-age-hours") minAgeHours = number;
    else maxObjects = number;
  }
  if (minAgeHours < MIN_REPORT_AGE_HOURS || maxObjects < 1 || maxObjects > 1_000_000) {
    throw new Error("Minimum age must be at least 24 hours; max objects must be between 1 and 1000000.");
  }
  // Opt-in and argument validation precede all DB/storage initialization.
  const { runStorageReport } = await import("./lib/run-storage-report");
  const { pool, storageJournalPool } = await import("@workspace/db");
  try {
    const report = await runStorageReport({ minAgeHours, maxObjects });
    console.log(JSON.stringify(report, null, 2));
  } finally {
    await Promise.all([pool.end(), storageJournalPool.end()]);
  }
}

main().catch(error => {
  console.error(error instanceof Error ? error.message : "Storage report failed.");
  process.exitCode = 1;
});
