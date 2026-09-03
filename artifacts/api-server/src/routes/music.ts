import { Router, type IRouter } from "express";
import { db, tracksTable } from "@workspace/db";
import { desc, eq } from "drizzle-orm";
import { requireAuth, requireAdmin } from "../lib/auth";
import { isBanned, audit } from "./social";

const router: IRouter = Router();

router.get("/music", async (_req, res) => {
  const rows = await db.select({
    id: tracksTable.id,
    uploader: tracksTable.uploader,
    title: tracksTable.title,
    createdAt: tracksTable.createdAt,
  }).from(tracksTable).orderBy(desc(tracksTable.createdAt)).limit(100);
  res.json(rows);
});

router.get("/music/:id/audio", async (req, res) => {
  const id = Number(req.params.id);
  const [t] = await db.select().from(tracksTable).where(eq(tracksTable.id, id)).limit(1);
  if (!t) { res.status(404).json({ error: "not found" }); return; }
  res.json({ dataUrl: t.dataUrl });
});

router.post("/music", requireAuth, async (req, res) => {
  const { title, dataUrl } = req.body ?? {};
  if (typeof title !== "string" || !title.trim()) { res.status(400).json({ error: "title required" }); return; }
  if (typeof dataUrl !== "string" || !dataUrl.startsWith("data:audio/")) { res.status(400).json({ error: "audio required" }); return; }
  if (dataUrl.length > 8_000_000) { res.status(413).json({ error: "Track too large (max ~6MB)" }); return; }
  const uploader = req.session.username!;
  if (await isBanned(uploader)) { res.status(403).json({ error: "Banned" }); return; }
  const [row] = await db.insert(tracksTable).values({ uploader, title: title.trim().slice(0, 100), dataUrl }).returning();
  await audit("music", "upload", uploader, "", title.trim().slice(0, 100));
  res.json({ id: row.id, uploader: row.uploader, title: row.title, createdAt: row.createdAt });
});

router.delete("/music/:id", requireAdmin, async (req, res) => {
  const id = Number(req.params.id);
  await db.delete(tracksTable).where(eq(tracksTable.id, id));
  await audit("music", "delete", req.session.username || "admin", "", `id=${id}`);
  res.json({ ok: true });
});

export default router;
