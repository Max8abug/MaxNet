import { Router, type IRouter } from "express";
import {
  db,
  drawingsTable,
  chatMessagesTable,
  visitCounterTable,
  guestbookTable,
  photosTable,
} from "@workspace/db";
import { desc, sql } from "drizzle-orm";
import { requireAuth, requireAdmin } from "../lib/auth";

const router: IRouter = Router();

// ---------- Drawings ----------
router.get("/drawings", async (_req, res) => {
  const rows = await db
    .select()
    .from(drawingsTable)
    .orderBy(desc(drawingsTable.createdAt))
    .limit(200);
  res.json(rows);
});

router.post("/drawings", async (req, res) => {
  const { dataUrl, author } = req.body ?? {};
  if (typeof dataUrl !== "string" || !dataUrl.startsWith("data:image/")) {
    res.status(400).json({ error: "dataUrl must be a data:image/* string" });
    return;
  }
  if (dataUrl.length > 600_000) {
    res.status(413).json({ error: "Drawing too large" });
    return;
  }
  const safeAuthor = typeof author === "string" && author.trim() ? author.trim().slice(0, 32) : "anon";
  const [row] = await db
    .insert(drawingsTable)
    .values({ dataUrl, author: safeAuthor })
    .returning();
  res.json(row);
});

// ---------- Chat (login required to post; admin can clear) ----------
router.get("/chat", async (_req, res) => {
  const rows = await db
    .select()
    .from(chatMessagesTable)
    .orderBy(desc(chatMessagesTable.createdAt))
    .limit(100);
  res.json(rows.reverse());
});

router.post("/chat", requireAuth, async (req, res) => {
  const { body } = req.body ?? {};
  if (typeof body !== "string" || !body.trim()) {
    res.status(400).json({ error: "body required" });
    return;
  }
  if (body.length > 500) {
    res.status(413).json({ error: "Message too long" });
    return;
  }
  const author = req.session.username || "anon";
  const [row] = await db
    .insert(chatMessagesTable)
    .values({ body: body.trim(), author })
    .returning();
  res.json(row);
});

router.delete("/chat", requireAdmin, async (_req, res) => {
  await db.delete(chatMessagesTable);
  res.json({ ok: true });
});

// ---------- Guestbook ----------
router.get("/guestbook", async (_req, res) => {
  const rows = await db
    .select()
    .from(guestbookTable)
    .orderBy(desc(guestbookTable.createdAt))
    .limit(200);
  res.json(rows);
});

router.post("/guestbook", async (req, res) => {
  const { body, author } = req.body ?? {};
  if (typeof body !== "string" || !body.trim()) {
    res.status(400).json({ error: "body required" });
    return;
  }
  if (body.length > 280) {
    res.status(413).json({ error: "Note too long" });
    return;
  }
  const safeAuthor =
    typeof author === "string" && author.trim() ? author.trim().slice(0, 32) : "anon";
  const [row] = await db
    .insert(guestbookTable)
    .values({ body: body.trim(), author: safeAuthor })
    .returning();
  res.json(row);
});

router.delete("/guestbook/:id", requireAdmin, async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isFinite(id)) {
    res.status(400).json({ error: "bad id" });
    return;
  }
  await db.delete(guestbookTable).where(sql`${guestbookTable.id} = ${id}`);
  res.json({ ok: true });
});

// ---------- Photos (admin uploads, everyone views) ----------
router.get("/photos", async (_req, res) => {
  const rows = await db
    .select()
    .from(photosTable)
    .orderBy(desc(photosTable.createdAt))
    .limit(500);
  res.json(rows);
});

router.post("/photos", requireAdmin, async (req, res) => {
  const { dataUrl, caption } = req.body ?? {};
  if (typeof dataUrl !== "string" || !dataUrl.startsWith("data:image/")) {
    res.status(400).json({ error: "dataUrl must be a data:image/* string" });
    return;
  }
  if (dataUrl.length > 8_000_000) {
    res.status(413).json({ error: "Photo too large (max ~6MB)" });
    return;
  }
  const safeCaption = typeof caption === "string" ? caption.slice(0, 200) : "";
  const [row] = await db
    .insert(photosTable)
    .values({ dataUrl, caption: safeCaption })
    .returning();
  res.json(row);
});

router.delete("/photos/:id", requireAdmin, async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isFinite(id)) {
    res.status(400).json({ error: "bad id" });
    return;
  }
  await db.delete(photosTable).where(sql`${photosTable.id} = ${id}`);
  res.json({ ok: true });
});

// ---------- Visit counter ----------
router.get("/visits", async (_req, res) => {
  const rows = await db.select().from(visitCounterTable).limit(1);
  res.json({ count: rows[0]?.count ?? 0 });
});

router.post("/visits", async (_req, res) => {
  const rows = await db.select().from(visitCounterTable).limit(1);
  if (rows.length === 0) {
    const [row] = await db.insert(visitCounterTable).values({ count: 1 }).returning();
    res.json({ count: row.count });
    return;
  }
  const [row] = await db
    .update(visitCounterTable)
    .set({ count: sql`${visitCounterTable.count} + 1` })
    .returning();
  res.json({ count: row.count });
});

export default router;
