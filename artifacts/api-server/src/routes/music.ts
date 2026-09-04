import { Router, type IRouter } from "express";
import { db, tracksTable, musicPlaylistsTable } from "@workspace/db";
import { desc, eq, inArray } from "drizzle-orm";
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

function cleanTrackIds(value: unknown): number[] {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.map(Number).filter((id) => Number.isInteger(id) && id > 0))].slice(0, 100);
}

async function playlistResponse(row: typeof musicPlaylistsTable.$inferSelect) {
  const trackIds = cleanTrackIds(row.trackIds);
  const tracks = trackIds.length
    ? await db.select({ id: tracksTable.id, uploader: tracksTable.uploader, title: tracksTable.title, createdAt: tracksTable.createdAt })
      .from(tracksTable).where(inArray(tracksTable.id, trackIds))
    : [];
  const byId = new Map(tracks.map((track) => [track.id, track]));
  return { ...row, trackIds, tracks: trackIds.map((id) => byId.get(id)).filter(Boolean) };
}

router.get("/music/playlists", async (_req, res) => {
  const rows = await db.select().from(musicPlaylistsTable).orderBy(desc(musicPlaylistsTable.createdAt)).limit(100);
  res.json(await Promise.all(rows.map(playlistResponse)));
});

router.post("/music/playlists", requireAuth, async (req, res) => {
  const name = typeof req.body?.name === "string" ? req.body.name.trim().slice(0, 80) : "";
  if (!name) { res.status(400).json({ error: "Playlist name required" }); return; }
  const [row] = await db.insert(musicPlaylistsTable)
    .values({ name, createdBy: req.session.username!, trackIds: [] }).returning();
  await audit("music", "playlist-create", req.session.username!, "", name);
  res.json(await playlistResponse(row));
});

router.patch("/music/playlists/:id", requireAuth, async (req, res) => {
  const id = Number(req.params.id);
  const [existing] = await db.select().from(musicPlaylistsTable).where(eq(musicPlaylistsTable.id, id)).limit(1);
  if (!existing) { res.status(404).json({ error: "Playlist not found" }); return; }
  if (existing.createdBy !== req.session.username && !req.session.isAdmin) {
    res.status(403).json({ error: "Only the playlist owner can edit it" }); return;
  }
  const update: { name?: string; trackIds?: number[] } = {};
  if (req.body?.name !== undefined) {
    if (typeof req.body.name !== "string" || !req.body.name.trim()) { res.status(400).json({ error: "Playlist name required" }); return; }
    update.name = req.body.name.trim().slice(0, 80);
  }
  if (req.body?.trackIds !== undefined) update.trackIds = cleanTrackIds(req.body.trackIds);
  if (!Object.keys(update).length) { res.status(400).json({ error: "Nothing to update" }); return; }
  const [row] = await db.update(musicPlaylistsTable).set(update).where(eq(musicPlaylistsTable.id, id)).returning();
  res.json(await playlistResponse(row));
});

router.delete("/music/playlists/:id", requireAuth, async (req, res) => {
  const id = Number(req.params.id);
  const [existing] = await db.select().from(musicPlaylistsTable).where(eq(musicPlaylistsTable.id, id)).limit(1);
  if (!existing) { res.status(404).json({ error: "Playlist not found" }); return; }
  if (existing.createdBy !== req.session.username && !req.session.isAdmin) {
    res.status(403).json({ error: "Only the playlist owner can delete it" }); return;
  }
  await db.delete(musicPlaylistsTable).where(eq(musicPlaylistsTable.id, id));
  res.json({ ok: true });
});

export default router;
