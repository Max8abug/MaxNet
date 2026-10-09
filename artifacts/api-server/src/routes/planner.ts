import { Router, type IRouter } from "express";
import { pool } from "@workspace/db";
import { requireAuth } from "../lib/auth";

const router: IRouter = Router();
router.use("/planner", requireAuth);
const fields = `id, kind, title, notes, day::text AS day,
  starts_at AS "startsAt", remind_at AS "remindAt",
  notified_at AS "notifiedAt", dismissed`;

type Input = {
  kind: "note" | "event" | "reminder";
  title: string;
  notes: string;
  day: string;
  startsAt: string | null;
  remindAt: string | null;
};

function parseInput(value: unknown): Input {
  if (!value || typeof value !== "object") throw new Error("Provide a planner entry.");
  const input = value as Record<string, unknown>;
  if (!["note", "event", "reminder"].includes(String(input.kind))) throw new Error("Choose a note, event, or reminder.");
  if (typeof input.title !== "string" || input.title.trim().length > 200) throw new Error("Enter a title of up to 200 characters.");
  if (typeof input.notes !== "string" || input.notes.length > 20_000) throw new Error("Notes must be no more than 20,000 characters.");
  if (!input.title.trim() && (input.kind !== "note" || !input.notes.trim())) throw new Error("Enter a title, or write some note text.");
  if (typeof input.day !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(input.day) || input.day.startsWith("0000")) throw new Error("Choose a calendar day.");
  const date = new Date(`${input.day}T12:00:00Z`);
  if (!Number.isFinite(date.getTime()) || date.toISOString().slice(0, 10) !== input.day) throw new Error("Choose a valid calendar day.");
  const parseTime = (value: unknown): string | null => {
    if (value === null || value === undefined || value === "") return null;
    if (typeof value !== "string" || !/(Z|[+-]\d{2}:\d{2})$/.test(value) || !Number.isFinite(Date.parse(value))) throw new Error("Times must include a valid timezone.");
    const parsed = new Date(value);
    if (parsed.getUTCFullYear() < 1 || parsed.getUTCFullYear() > 9999) throw new Error("Choose a time in a supported calendar year.");
    return parsed.toISOString();
  };
  const startsAt = parseTime(input.startsAt);
  const remindAt = parseTime(input.remindAt);
  if (input.kind === "event" && !startsAt) throw new Error("Choose an event time.");
  if (input.kind === "reminder" && !remindAt) throw new Error("Choose a reminder time.");
  return {
    kind: input.kind as Input["kind"], title: input.title.trim(), notes: input.notes,
    day: input.day, startsAt, remindAt,
  };
}

router.get("/planner", async (req, res) => {
  res.setHeader("Cache-Control", "no-store");
  if (req.query.due === "1") {
    const { rows } = await pool.query(
      `SELECT ${fields} FROM planner_entries WHERE username=$1 AND remind_at<=now() AND dismissed=false ORDER BY remind_at`,
      [req.session.username],
    );
    res.json(rows);
    return;
  }
  const month = String(req.query.month || "");
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month) || month.startsWith("0000")) {
    res.status(400).json({ error: "Choose a month in YYYY-MM format." });
    return;
  }
  const { rows } = await pool.query(
    `SELECT ${fields} FROM planner_entries WHERE username=$1 AND day >= $2::date
      AND day < ($2::date + interval '1 month') ORDER BY day, starts_at NULLS LAST, id`,
    [req.session.username, `${month}-01`],
  );
  res.json(rows);
});

router.post("/planner", async (req, res) => {
  let input: Input;
  try {
    input = parseInput(req.body);
    if (input.remindAt && Date.parse(input.remindAt) <= Date.now()) throw new Error("Choose a future reminder time.");
  } catch (error) {
    res.status(400).json({ error: (error as Error).message });
    return;
  }
  const { rows } = await pool.query(
    `INSERT INTO planner_entries(username,kind,title,notes,day,starts_at,remind_at)
      VALUES($1,$2,$3,$4,$5,$6,$7) RETURNING ${fields}`,
    [req.session.username, input.kind, input.title, input.notes, input.day, input.startsAt, input.remindAt],
  );
  res.status(201).json(rows[0]);
});

router.put("/planner/:id", async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isSafeInteger(id) || id <= 0) {
    res.status(400).json({ error: "Invalid planner entry." });
    return;
  }
  let input: Input;
  try { input = parseInput(req.body); }
  catch (error) {
    res.status(400).json({ error: (error as Error).message });
    return;
  }
  // Reset delivery only when the scheduled time actually changes.
  const { rows } = await pool.query(
    `UPDATE planner_entries SET kind=$3,title=$4,notes=$5,day=$6,starts_at=$7,
      notified_at=CASE WHEN remind_at IS DISTINCT FROM $8::timestamptz THEN NULL ELSE notified_at END,
      dismissed=CASE WHEN remind_at IS DISTINCT FROM $8::timestamptz THEN false ELSE dismissed END,
      remind_at=$8
      WHERE id=$1 AND username=$2
      AND (remind_at IS NOT DISTINCT FROM $8::timestamptz OR $8::timestamptz IS NULL OR $8::timestamptz>now())
      RETURNING ${fields}`,
    [id, req.session.username, input.kind, input.title, input.notes, input.day, input.startsAt, input.remindAt],
  );
  if (!rows[0]) {
    const existing = await pool.query("SELECT id FROM planner_entries WHERE id=$1 AND username=$2", [id, req.session.username]);
    res.status(existing.rowCount ? 400 : 404).json({ error: existing.rowCount ? "Choose a future reminder time." : "Planner entry not found." });
    return;
  }
  res.json(rows[0]);
});

router.put("/planner/:id/dismiss", async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isSafeInteger(id) || id <= 0) {
    res.status(400).json({ error: "Invalid planner entry." });
    return;
  }
  const { rows } = await pool.query(`UPDATE planner_entries SET dismissed=true WHERE id=$1 AND username=$2 RETURNING ${fields}`, [id, req.session.username]);
  if (!rows[0]) { res.status(404).json({ error: "Planner entry not found." }); return; }
  res.json(rows[0]);
});

router.delete("/planner/:id", async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isSafeInteger(id) || id <= 0) {
    res.status(400).json({ error: "Invalid planner entry." });
    return;
  }
  const result = await pool.query("DELETE FROM planner_entries WHERE id=$1 AND username=$2", [id, req.session.username]);
  if (!result.rowCount) { res.status(404).json({ error: "Planner entry not found." }); return; }
  res.json({ ok: true });
});

export default router;
