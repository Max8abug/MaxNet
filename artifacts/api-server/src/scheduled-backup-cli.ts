const help = `Opt-in private version 2 site backup (does not delete upload objects).
Usage: pnpm --filter @workspace/api-server run backup:scheduled --enabled
       --destination=/absolute/private/directory --keep=14 [--recipient=age1...]

Requires the owner's database and storage configuration. Directory must be
owned by this user, mode 0700, outside uploads and public web roots.
Retains the newest N completed command-generated backups after success only.
Output: JSON success summary on stdout; errors on stderr and nonzero exit.
No scheduling is installed automatically. See selfhost/README.md.
`;

async function main() {
  const args = process.argv.slice(2);
  if (args.length === 1 && args[0] === "--help") { console.log(help); return; }
  if (!args.includes("--enabled")) throw new Error(`Explicit --enabled opt-in is required.\n${help}`);
  const values = new Map<string, string>();
  const seen = new Set<string>();
  for (const arg of args) {
    const separator = arg.indexOf("=");
    const key = separator < 0 ? arg : arg.slice(0, separator);
    const value = separator < 0 ? "" : arg.slice(separator + 1);
    if (seen.has(key)) throw new Error(`Duplicate option: ${key}`);
    seen.add(key);
    if (key === "--enabled" && separator < 0) continue;
    if (!["--destination", "--keep", "--recipient"].includes(key) || !value) throw new Error(`Invalid option: ${key}`);
    values.set(key, value);
  }
  const destination = values.get("--destination");
  const retention = values.get("--keep");
  if (!destination?.startsWith("/") || !/^\d+$/.test(retention ?? "") ||
      Number(retention) < 1 || Number(retention) > 10000) throw new Error("Provide an absolute --destination and --keep between 1 and 10000.");
  const recipient = values.get("--recipient");
  if (recipient && !/^age1[0-9a-z]+$/.test(recipient)) throw new Error("--recipient must be an age public recipient.");
  // Reject options before initializing either database or storage.
  const { runScheduledBackup } = await import("./lib/scheduled-backup");
  const { pool, storageJournalPool } = await import("@workspace/db");
  try {
    console.log(JSON.stringify(await runScheduledBackup({ destination, keep: Number(retention), recipient })));
  } finally {
    await Promise.all([pool.end(), storageJournalPool.end()]);
  }
}

main().catch(error => {
  console.error(error instanceof Error ? error.message : "Scheduled backup failed.");
  process.exitCode = 1;
});
