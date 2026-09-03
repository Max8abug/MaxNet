// The DB uses timestamp-without-time-zone columns for legacy compatibility.
// Set the process timezone before importing the DB/app modules so node-postgres
// parses and serializes those values consistently on every host.
process.env.TZ = "UTC";

export {};

const { default: app } = await import("./app");
const { logger } = await import("./lib/logger");
const { ensureSchema } = await import("./lib/ensure-schema");

const rawPort = process.env["PORT"];

if (!rawPort) {
  throw new Error(
    "PORT environment variable is required but was not provided.",
  );
}

const port = Number(rawPort);

if (Number.isNaN(port) || port <= 0) {
  throw new Error(`Invalid PORT value: "${rawPort}"`);
}

// Run idempotent schema bootstrap BEFORE we start serving traffic.
// This makes deploys self-healing: if the production DB is missing a
// table or column the current code expects (very common when shipping
// schema changes via a "push to GitHub then deploy" flow with no
// migration step), the gap is closed automatically before the first
// request lands. See lib/ensure-schema.ts for the full rationale.
async function start() {
  try {
    await ensureSchema();
  } catch (err) {
    logger.error({ err }, "Aborting startup — schema bootstrap failed");
    process.exit(1);
  }

  app.listen(port, "0.0.0.0", (err) => {
    if (err) {
      logger.error({ err }, "Error listening on port");
      process.exit(1);
    }
    logger.info({ port }, "Server listening on 0.0.0.0");
  });
}

void start();
