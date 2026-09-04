import { Router, type IRouter } from "express";
import { db, tracksTable, playlistsTable, playlistTracksTable } from "@workspace/db";
import { desc, eq, and } from "drizzle-orm";
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

// Keep this collection route before /music/:id so "playlists" is not parsed as
// an audio track id.
router.get("/music/playlists", async (_req, res) => {
  const lists = await db.select().from(playlistsTable).orderBy(desc(playlistsTable.updatedAt));
  const result = await Promise.all(lists.map(async (p) => ({
    ...p,
    tracks: await db.select({ id: tracksTable.id, uploader: tracksTable.uploader, title: tracksTable.title, createdAt: tracksTable.createdAt })
      .from(playlistTracksTable).innerJoin(tracksTable, eq(playlistTracksTable.trackId, tracksTable.id))
      .where(eq(playlistTracksTable.playlistId, p.id)).orderBy(playlistTracksTable.position),
  })));
  res.json(result);
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

router.post("/music/playlists", requireAuth, async (req, res) => {
  const name = String(req.body?.name || "").trim();
  if (!name || name.length > 80) { res.status(400).json({ error: "Playlist name must be 1-80 characters" }); return; }
  const [p] = await db.insert(playlistsTable).values({ owner: req.session.username!, name }).returning();
  res.json({ ...p, tracks: [] });
});
router.patch("/music/playlists/:id", requireAuth, async (req, res) => {
  const id = Number(req.params.id), name = String(req.body?.name || "").trim();
  const [p] = await db.select().from(playlistsTable).where(eq(playlistsTable.id, id)).limit(1);
  if (!p) { res.status(404).json({ error: "Playlist not found" }); return; }
  if (p.owner !== req.session.username) { res.status(403).json({ error: "Not your playlist" }); return; }
  if (!name || name.length > 80) { res.status(400).json({ error: "Invalid name" }); return; }
  const [updated] = await db.update(playlistsTable).set({ name, updatedAt: new Date() }).where(eq(playlistsTable.id, id)).returning();
  res.json(updated);
});
router.delete("/music/playlists/:id", requireAuth, async (req, res) => {
  const id = Number(req.params.id), [p] = await db.select().from(playlistsTable).where(eq(playlistsTable.id, id)).limit(1);
  if (!p) { res.status(404).json({ error: "Playlist not found" }); return; }
  if (p.owner !== req.session.username) { res.status(403).json({ error: "Not your playlist" }); return; }
  await db.delete(playlistTracksTable).where(eq(playlistTracksTable.playlistId, id));
  await db.delete(playlistsTable).where(eq(playlistsTable.id, id));
  res.json({ ok: true });
});
router.post("/music/playlists/:id/tracks", requireAuth, async (req, res) => {
  const playlistId = Number(req.params.id), trackId = Number(req.body?.trackId);
  const [p] = await db.select().from(playlistsTable).where(eq(playlistsTable.id, playlistId)).limit(1);
  const [t] = await db.select().from(tracksTable).where(eq(tracksTable.id, trackId)).limit(1);
  if (!p || !t) { res.status(404).json({ error: "Playlist or track not found" }); return; }
  if (p.owner !== req.session.username) { res.status(403).json({ error: "Not your playlist" }); return; }
  const [exists] = await db.select().from(playlistTracksTable).where(and(eq(playlistTracksTable.playlistId, playlistId), eq(playlistTracksTable.trackId, trackId))).limit(1);
  if (!exists) await db.insert(playlistTracksTable).values({ playlistId, trackId, position: 0 });
  await db.update(playlistsTable).set({ updatedAt: new Date() }).where(eq(playlistsTable.id, playlistId));
  res.json({ ok: true });
});
router.delete("/music/playlists/:id/tracks/:trackId", requireAuth, async (req, res) => {
  const playlistId = Number(req.params.id), trackId = Number(req.params.trackId);
  const [p] = await db.select().from(playlistsTable).where(eq(playlistsTable.id, playlistId)).limit(1);
  if (!p) { res.status(404).json({ error: "Playlist not found" }); return; }
  if (p.owner !== req.session.username) { res.status(403).json({ error: "Not your playlist" }); return; }
  await db.delete(playlistTracksTable).where(and(eq(playlistTracksTable.playlistId, playlistId), eq(playlistTracksTable.trackId, trackId)));
  res.json({ ok: true });
});

export default router;
