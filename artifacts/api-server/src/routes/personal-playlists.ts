import { Router, type ErrorRequestHandler } from "express";
import { randomUUID } from "node:crypto";
import { pool } from "@workspace/db";
import { requireAuth } from "../lib/auth";
import { fetchYouTubeTitles, parsePersonalYouTubeId } from "../lib/personal-playlists";

const router = Router();
router.use("/personal-playlists", requireAuth);
interface Track { id: string; videoId: string; title: string }
interface Playlist { id: number; name: string; revision: number; tracks: Track[]; createdAt: Date; updatedAt: Date }
const fields = 'id, name, revision, tracks, created_at AS "createdAt", updated_at AS "updatedAt"';
class InputError extends Error {
  constructor(message: string, readonly status = 400) { super(message); }
}
function playlistId(value: string | string[]): number {
  const id = Number(value);
  if (!Number.isSafeInteger(id) || id <= 0) throw new InputError("Invalid playlist.");
  return id;
}
function cleanName(value: unknown): string {
  if (typeof value !== "string" || !value.trim() || value.trim().length > 100) throw new InputError("Enter a playlist name of up to 100 characters.");
  return value.trim();
}
async function mutatePlaylist(id: number, username: string, mutation: (playlist: Playlist) => { name: string; tracks: Track[] }) {
  const connection = await pool.connect();
  try {
    await connection.query("BEGIN");
    const result = await connection.query<Playlist>(`SELECT ${fields} FROM personal_youtube_playlists WHERE id=$1 AND username=$2 FOR UPDATE`, [id, username]);
    if (!result.rows[0]) throw new InputError("Playlist not found.", 404);
    const updated = mutation(result.rows[0]);
    const saved = await connection.query<Playlist>(
      `UPDATE personal_youtube_playlists SET name=$3, tracks=$4::jsonb, updated_at=now(), revision=revision+1 WHERE id=$1 AND username=$2 RETURNING ${fields}`,
      [id, username, updated.name, JSON.stringify(updated.tracks)],
    );
    await connection.query("COMMIT");
    return saved.rows[0];
  } catch (error) { await connection.query("ROLLBACK"); throw error; }
  finally { connection.release(); }
}

router.get("/personal-playlists", async (req, res) => {
  res.set("Cache-Control", "no-store");
  const result = await pool.query(`SELECT ${fields} FROM personal_youtube_playlists WHERE username=$1 ORDER BY created_at, id`, [req.session.username]);
  res.json(result.rows);
});
router.post("/personal-playlists", async (req, res) => {
  const name = cleanName(req.body?.name);
  const connection = await pool.connect();
  try {
    await connection.query("BEGIN");
    await connection.query("SELECT pg_advisory_xact_lock(hashtext($1))", [`personal-playlists:${req.session.username}`]);
    const count = await connection.query("SELECT count(*)::int AS count FROM personal_youtube_playlists WHERE username=$1", [req.session.username]);
    if (count.rows[0].count >= 50) throw new InputError("You can save up to 50 personal playlists.");
    const result = await connection.query(`INSERT INTO personal_youtube_playlists(username, name) VALUES($1,$2) RETURNING ${fields}`, [req.session.username, name]);
    await connection.query("COMMIT");
    res.status(201).json(result.rows[0]);
  } catch (error) { await connection.query("ROLLBACK"); throw error; }
  finally { connection.release(); }
});
router.patch("/personal-playlists/:id", async (req, res) => {
  const id = playlistId(req.params.id);
  const body = req.body;
  if (!body || typeof body !== "object") throw new InputError("Provide playlist changes.");
  const name = body.name === undefined ? undefined : cleanName(body.name);
  const ids: unknown = body.trackIds;
  if (ids !== undefined && (!Array.isArray(ids) || ids.length > 200 || ids.some(value => typeof value !== "string") || new Set(ids).size !== ids.length)) {
    throw new InputError("Provide a unique, ordered list of track IDs.");
  }
  if (!Number.isSafeInteger(body.revision) || body.revision < 0) {
    throw new InputError("Provide the playlist's last saved version. Refresh and try again.");
  }
  if (name === undefined && ids === undefined) throw new InputError("Provide a new name or track order.");
  const result = await mutatePlaylist(id, req.session.username!, (playlist) => {
    if (playlist.revision !== body.revision) throw new InputError("This playlist changed on another device. Refresh before editing or removing tracks.", 409);
    let tracks = playlist.tracks;
    if (Array.isArray(ids)) {
      const byId = new Map(tracks.map(track => [track.id, track]));
      if (ids.some(trackId => !byId.has(trackId))) throw new InputError("A track changed or was removed. Refresh the playlist and try again.", 409);
      tracks = ids.map(trackId => byId.get(trackId)!);
    }
    return { name: name ?? playlist.name, tracks };
  });
  res.json(result);
});
router.post("/personal-playlists/:id/links", async (req, res) => {
  const id = playlistId(req.params.id);
  if (typeof req.body?.links !== "string" || !req.body.links.trim() || req.body.links.length > 30_000) throw new InputError("Paste some YouTube links (up to 30,000 characters).");
  const links: string[] = req.body.links.trim().split(/[\s,]+/).filter(Boolean);
  if (links.length > 100) throw new InputError("Add up to 100 links at a time.");
  const existing = await pool.query<Playlist>(`SELECT ${fields} FROM personal_youtube_playlists WHERE id=$1 AND username=$2`, [id, req.session.username]);
  if (!existing.rows[0]) throw new InputError("Playlist not found.", 404);
  const rejected: string[] = [];
  const parsed: string[] = [];
  for (const link of links) {
    const videoId = parsePersonalYouTubeId(link);
    if (videoId) parsed.push(videoId);
    else rejected.push(link);
  }
  const existingVideos = new Set(existing.rows[0].tracks.map(track => track.videoId));
  const titles = await fetchYouTubeTitles([...new Set(parsed)].filter(videoId => !existingVideos.has(videoId)));
  let added = 0;
  let duplicates = 0;
  const playlist = await mutatePlaylist(id, req.session.username!, (current) => {
    const tracks = [...current.tracks];
    const known = new Set(tracks.map(track => track.videoId));
    for (const videoId of parsed) {
      if (known.has(videoId)) { duplicates++; continue; }
      if (tracks.length >= 200) throw new InputError("A playlist can contain up to 200 videos. Create another playlist to add more.");
      tracks.push({ id: randomUUID(), videoId, title: titles.get(videoId) || `https://www.youtube.com/watch?v=${videoId}` });
      known.add(videoId); added++;
    }
    return { name: current.name, tracks };
  });
  res.json({ playlist, added, duplicates, rejected });
});
router.delete("/personal-playlists/:id", async (req, res) => {
  const result = await pool.query("DELETE FROM personal_youtube_playlists WHERE id=$1 AND username=$2 RETURNING id", [playlistId(req.params.id), req.session.username]);
  if (!result.rowCount) throw new InputError("Playlist not found.", 404);
  res.json({ ok: true });
});
const handleInputError: ErrorRequestHandler = (error, _req, res, next) => {
  if (error instanceof InputError) { res.status(error.status).json({ error: error.message }); return; }
  next(error);
};
router.use(handleInputError);
export default router;
