# Read-only legacy upload report

This optional owner-run command looks for **possible** leftovers in `wiki/` and
`user-sites/`. It is not a cleanup tool and is separate from site backups.
It never deletes files, queues deletions, changes references, creates database
tables, or migrates storage. Nothing runs automatically at startup or on a schedule.

## Run on your own server

1. Build the API using the normal deployment build:
   `pnpm --filter @workspace/api-server run build`.
2. Use the **same database and storage configuration as the running server**.
   For self-hosted uploads, select `STORAGE_BACKEND=local` and your existing
   `UPLOAD_STORAGE_DIR`. If omitted, the directory is
   `~/.local/share/photo-desktop/uploads`. Do not point at another installation,
   a backup directory, or a different database.
3. Run during a quiet period. Current uploads, file changes, cleanup, and
   full-site database operations use a shared lock. The report takes it
   exclusively without waiting: if busy, it fails and you can retry later.
   New writers can pause for up to 30 seconds while it inventories storage,
   plus up to 5 seconds to read the database references.
   Stop older application versions and external filesystem writers first;
   they do not necessarily honor that lock.
4. Run explicitly:

   ```sh
   STORAGE_BACKEND=local UPLOAD_STORAGE_DIR=/your/existing/uploads \
     node artifacts/api-server/dist/storage-report-cli.mjs --read-only \
     > /your/private/report.json
   ```

   Load database configuration through your existing private service environment;
   do not put credentials into shell history. Store the report **outside** the
   upload directory and keep it private: it contains object paths and directory
   information. The redirect creates a report file, not a storage modification.

   You can also use:
   `pnpm --silent --filter @workspace/api-server run storage:report --read-only`.
   Use the direct `node` command above for a JSON-only redirect.

`--help` works without database or storage access. Omitting `--read-only` or
passing invalid options fails before accessing either. There is no deletion flag.

## What the JSON means

- `candidates`: unreferenced, unjournaled objects last changed at least 24 hours
  before the report started. Age uses the newest filesystem modification,
  inode-change, or creation time; recent copied files are retained even when
  their modification dates were preserved.
- `needsReview`: unmatched objects with no reliable age. The Replit object
  storage SDK exposes names, not timestamps or sizes, so those objects go here,
  never into aged candidates.
- `excluded`: referenced objects, objects with **any** cleanup intent (including
  other scopes), recent uploads, temporary writes, symlinks, special files, and
  unsafe names. Both public and inactive hosted sites are protected. Files
  awaiting normal journal cleanup are not legacy candidates.
- `cleanupIntents`: counts for the selected storage scope and other scopes.
- `scope`, `startedAt`, `finishedAt`, and `minimumAgeHours`: identify the snapshot.

The report does not follow symlinks, download file contents, or inspect
`restores/`, backup staging, other namespaces, or unrelated files. A missing
storage root, failed inventory, missing journal table, database error, busy
storage, timeout, or exceeded limit produces a nonzero exit and **no JSON report**,
not a misleading empty or partial success. Use the deployed application's
normal schema setup if the journal is missing; this command never creates it.

Options:

- `--min-age-hours=72` increases the safety window (minimum 24).
- `--max-objects=200000` changes the inventory/reference bound (default 100000,
  maximum 1000000). Exceeding either bound aborts the report.

Candidates are not proof of safe deletion. Database and storage must belong to
the same installation; other apps, external consumers, or old writers may have
references the report cannot see. Do not turn its output into a deletion script.
Keep your normal independent backups and manually investigate candidates.

## Developer checks

`pnpm --filter @workspace/api-server run test:storage-report` uses disposable
filesystem fixtures and fake bucket pages only. It does not connect to or modify
any database, and verifies that temporary and live fixture files remain unchanged.
