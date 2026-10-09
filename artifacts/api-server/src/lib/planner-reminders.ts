import { pool } from "@workspace/db";
import { sendPushToUser } from "./push";
import { logger } from "./logger";

export const plannerSchema = `
  CREATE TABLE IF NOT EXISTS planner_entries (
    id serial PRIMARY KEY,
    username text NOT NULL REFERENCES users(username) ON DELETE CASCADE,
    kind text NOT NULL CHECK (kind IN ('note', 'event', 'reminder')),
    title text NOT NULL,
    notes text NOT NULL DEFAULT '',
    day date NOT NULL,
    starts_at timestamptz,
    remind_at timestamptz,
    notified_at timestamptz,
    dismissed boolean NOT NULL DEFAULT false
  );
  CREATE INDEX IF NOT EXISTS planner_user_day_idx ON planner_entries(username, day);
  CREATE INDEX IF NOT EXISTS planner_due_idx ON planner_entries(remind_at)
    WHERE notified_at IS NULL AND dismissed = false;
`;

// Claim reminders atomically, including when multiple API instances are running.
// Due reminders also remain visible in the planner until the user dismisses them.
export async function deliverPlannerReminders(): Promise<void> {
  const { rows } = await pool.query<{ id: number; username: string; title: string }>(`
    UPDATE planner_entries SET notified_at = now()
    WHERE id IN (
      SELECT id FROM planner_entries
      WHERE remind_at <= now() AND notified_at IS NULL AND dismissed = false
      ORDER BY remind_at LIMIT 100 FOR UPDATE SKIP LOCKED
    )
    RETURNING id, username, title
  `);
  await Promise.all(rows.map((entry) => sendPushToUser(entry.username, {
    title: "Planner reminder",
    body: entry.title || "Your planner reminder is due.",
    tag: `planner:${entry.id}`,
    kind: "planner",
    url: "/?app=planner",
  })));
}

export function startPlannerReminders(): void {
  let running = false;
  const run = async () => {
    if (running) return;
    running = true;
    try {
      await deliverPlannerReminders();
    } catch (error) {
      logger.error({ err: error }, "Planner reminder delivery failed");
    } finally {
      running = false;
    }
  };
  void run();
  setInterval(() => void run(), 30_000).unref();
}
