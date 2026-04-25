import app from "./app";
import { logger } from "./lib/logger";
import { ensureSchema } from "./lib/ensure-schema";

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

  app.listen(port, (err) => {
    if (err) {
      logger.error({ err }, "Error listening on port");
      process.exit(1);
    }
    logger.info({ port }, "Server listening");
  });
}

void start();
