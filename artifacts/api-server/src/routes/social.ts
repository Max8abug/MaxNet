import { Router, type IRouter } from "express";
import { db, drawingsTable, chatMessagesTable, visitCounterTable } from "@workspace/db";
import { desc, sql } from "drizzle-orm";

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

// ---------- Chat ----------
router.get("/chat", async (_req, res) => {
  const rows = await db
    .select()
    .from(chatMessagesTable)
    .orderBy(desc(chatMessagesTable.createdAt))
    .limit(100);
  res.json(rows.reverse());
});

router.post("/chat", async (req, res) => {
  const { body, author } = req.body ?? {};
  if (typeof body !== "string" || !body.trim()) {
    res.status(400).json({ error: "body required" });
    return;
  }
  if (body.length > 500) {
    res.status(413).json({ error: "Message too long" });
    return;
  }
  const safeAuthor = typeof author === "string" && author.trim() ? author.trim().slice(0, 32) : "anon";
  const [row] = await db
    .insert(chatMessagesTable)
    .values({ body: body.trim(), author: safeAuthor })
    .returning();
  res.json(row);
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
