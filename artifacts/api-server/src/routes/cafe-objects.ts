import { Router, type IRouter } from "express";
import { db, cafeObjectsTable } from "@workspace/db";
import { and, asc, eq } from "drizzle-orm";
import { requireAdmin } from "../lib/auth";
import { audit } from "./social";

const router: IRouter = Router();

const VALID_ACTIONS = ["teleport", "message", "url"] as const;
type ActionType = typeof VALID_ACTIONS[number];

const MAX_DRAW_BYTES = 200_000;

function sanitize(body: any) {
  const name = String(body?.name ?? "").trim().slice(0, 60);
  const room = String(body?.room ?? "").trim().toLowerCase();
  const x = Math.max(0, Math.min(800, Math.round(Number(body?.x))));
  const y = Math.max(0, Math.min(500, Math.round(Number(body?.y))));
  const width = Math.max(16, Math.min(400, Math.round(Number(body?.width || 48))));
  const height = Math.max(16, Math.min(400, Math.round(Number(body?.height || 48))));
  const emoji = body?.emoji ? String(body.emoji).slice(0, 8) : null;
  const drawingDataUrl = body?.drawingDataUrl ? String(body.drawingDataUrl) : null;
  const actionType = String(body?.actionType ?? "") as ActionType;
  const actionValue = String(body?.actionValue ?? "").slice(0, 500);
  return { name, room, x, y, width, height, emoji, drawingDataUrl, actionType, actionValue };
}

function validate(o: ReturnType<typeof sanitize>): string | null {
  if (!o.name) return "name required";
  if (!o.room) return "room required";
  if (!Number.isFinite(o.x) || !Number.isFinite(o.y)) return "x/y required";
  if (!VALID_ACTIONS.includes(o.actionType)) return `actionType must be one of: ${VALID_ACTIONS.join(", ")}`;
  if (!o.actionValue) return "actionValue required";
  if (o.drawingDataUrl) {
    if (!o.drawingDataUrl.startsWith("data:image/")) return "drawingDataUrl must be a data:image/* string";
    if (o.drawingDataUrl.length > MAX_DRAW_BYTES) return `drawing too large (max ~${Math.round(MAX_DRAW_BYTES / 1024)}KB)`;
  }
  if (!o.emoji && !o.drawingDataUrl) return "Provide an emoji or a drawing for the object";
  return null;
}

router.get("/cafe-objects", async (req, res) => {
  const room = String(req.query.room || "").trim().toLowerCase();
  const where = room ? eq(cafeObjectsTable.room, room) : undefined;
  const rows = await (where
    ? db.select().from(cafeObjectsTable).where(where).orderBy(asc(cafeObjectsTable.id))
    : db.select().from(cafeObjectsTable).orderBy(asc(cafeObjectsTable.id)));
  res.json(rows);
});

router.post("/cafe-objects", requireAdmin, async (req, res) => {
  const data = sanitize(req.body);
  const err = validate(data);
  if (err) { res.status(400).json({ error: err }); return; }
  const actor = req.session.username || "admin";
  const [row] = await db
    .insert(cafeObjectsTable)
    .values({ ...data, createdBy: actor })
    .returning();
  await audit("cafe", "object-create", actor, String(row.id), `${data.room}:${data.name}`);
  res.json(row);
});

router.patch("/cafe-objects/:id", requireAdmin, async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isFinite(id)) { res.status(400).json({ error: "bad id" }); return; }
  const [existing] = await db.select().from(cafeObjectsTable).where(eq(cafeObjectsTable.id, id)).limit(1);
  if (!existing) { res.status(404).json({ error: "not found" }); return; }
  const merged = sanitize({ ...existing, ...req.body });
  const err = validate(merged);
  if (err) { res.status(400).json({ error: err }); return; }
  const [row] = await db
    .update(cafeObjectsTable)
    .set({
      name: merged.name,
      room: merged.room,
      x: merged.x,
      y: merged.y,
      width: merged.width,
      height: merged.height,
      emoji: merged.emoji,
      drawingDataUrl: merged.drawingDataUrl,
      actionType: merged.actionType,
      actionValue: merged.actionValue,
    })
    .where(eq(cafeObjectsTable.id, id))
    .returning();
  await audit("cafe", "object-update", req.session.username || "admin", String(id), merged.name);
  res.json(row);
});

router.delete("/cafe-objects/:id", requireAdmin, async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isFinite(id)) { res.status(400).json({ error: "bad id" }); return; }
  const [existing] = await db.select().from(cafeObjectsTable).where(eq(cafeObjectsTable.id, id)).limit(1);
  if (!existing) { res.status(404).json({ error: "not found" }); return; }
  await db.delete(cafeObjectsTable).where(eq(cafeObjectsTable.id, id));
  await audit("cafe", "object-delete", req.session.username || "admin", String(id), existing.name);
  res.json({ ok: true });
});

export default router;

// Silence unused-warning on `and` even if not used; keep import for future filters.
void and;
