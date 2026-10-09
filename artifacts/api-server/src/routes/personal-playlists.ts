import { Router, type ErrorRequestHandler } from "express";
import { randomUUID } from "node:crypto";
import { pool } from "@workspace/db";
import { requireAuth } from "../lib/auth";
import { fetchYouTubeTitles, parsePersonalYouTubeId } from "../lib/personal-playlists";
import {
  fetchSpotifyPublicPlaylist,
  findYouTubeMatch,
  parseSpotifyPlaylistId,
  SpotifyImportServiceError,
} from "../lib/spotify-playlist-import";

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
function spotifySearchDailyLimit(): number {
  const configured = Number(process.env["SPOTIFY_IMPORT_DAILY_SEARCH_LIMIT"]);
  return Number.isSafeInteger(configured) && configured > 0 && configured <= 10_000 ? configured : 80;
}
async function reserveSpotifySearches(requested: number, limit: number) {
  const day = new Date().toISOString().slice(0, 10);
  const connection = await pool.connect();
  try {
    await connection.query("BEGIN");
    await connection.query(
      `INSERT INTO personal_playlist_youtube_search_usage(usage_day, searches_used)
       VALUES($1, 0) ON CONFLICT (usage_day) DO NOTHING`,
      [day],
    );
    const row = await connection.query<{ searches_used: number }>(
      "SELECT searches_used FROM personal_playlist_youtube_search_usage WHERE usage_day=$1 FOR UPDATE",
      [day],
    );
    const used = Number(row.rows[0]?.searches_used ?? 0);
    const reserved = Math.min(requested, Math.max(0, limit - used));
    if (reserved > 0) {
      await connection.query(
        `UPDATE personal_playlist_youtube_search_usage
         SET searches_used=searches_used+$2, updated_at=now() WHERE usage_day=$1`,
        [day, reserved],
      );
    }
    await connection.query("COMMIT");
    return { day, reserved };
  } catch (error) {
    await connection.query("ROLLBACK");
    throw error;
  } finally {
    connection.release();
  }
}
async function releaseSpotifySearches(day: string, count: number) {
  if (count <= 0) return;
  await pool.query(
    `UPDATE personal_playlist_youtube_search_usage
     SET searches_used=GREATEST(searches_used-$2, 0), updated_at=now() WHERE usage_day=$1`,
    [day, count],
  );
}
async function createImportedPlaylist(username: string, name: string, tracks: Track[]) {
  const connection = await pool.connect();
  try {
    await connection.query("BEGIN");
    await connection.query("SELECT pg_advisory_xact_lock(hashtext($1))", [`personal-playlists:${username}`]);
    const count = await connection.query("SELECT count(*)::int AS count FROM personal_youtube_playlists WHERE username=$1", [username]);
    if (count.rows[0].count >= 50) throw new InputError("You can save up to 50 personal playlists.");
    const result = await connection.query<Playlist>(
      `INSERT INTO personal_youtube_playlists(username, name, tracks)
       VALUES($1,$2,$3::jsonb) RETURNING ${fields}`,
      [username, name, JSON.stringify(tracks)],
    );
    await connection.query("COMMIT");
    return result.rows[0];
  } catch (error) {
    await connection.query("ROLLBACK");
    throw error;
  } finally {
    connection.release();
  }
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
router.post("/personal-playlists/import-spotify", async (req, res) => {
  if (typeof req.body?.url !== "string" || req.body.url.length > 1_000) {
    throw new InputError("Paste a public Spotify playlist link.");
  }
  const playlistId = parseSpotifyPlaylistId(req.body.url);
  if (!playlistId) throw new InputError("Enter a Spotify playlist link from open.spotify.com.");
  const username = req.session.username!;
  const credentials = {
    clientId: process.env["SPOTIFY_CLIENT_ID"] ?? "",
    clientSecret: process.env["SPOTIFY_CLIENT_SECRET"] ?? "",
  };
  const youtubeApiKey = process.env["YOUTUBE_DATA_API_KEY"] ?? "";
  if (!credentials.clientId || !credentials.clientSecret || !youtubeApiKey) {
    throw new InputError("Spotify import is not configured on the server yet.", 503);
  }
  const currentCount = await pool.query(
    "SELECT count(*)::int AS count FROM personal_youtube_playlists WHERE username=$1",
    [username],
  );
  if (currentCount.rows[0].count >= 50) throw new InputError("You can save up to 50 personal playlists.");

  let source;
  try {
    source = await fetchSpotifyPublicPlaylist(playlistId, credentials);
  } catch (error) {
    if (error instanceof SpotifyImportServiceError) throw new InputError(error.message, error.code === "spotify-auth" ? 503 : 502);
    throw error;
  }
  if (!source.tracks.length) throw new InputError("That Spotify playlist has no public tracks that can be matched.", 422);

  const reservation = await reserveSpotifySearches(source.tracks.length, spotifySearchDailyLimit());
  if (reservation.reserved === 0) {
    throw new InputError("The site's daily Spotify-to-YouTube search allowance is used up. Try again tomorrow.", 429);
  }
  const searchTracks = source.tracks.slice(0, reservation.reserved);
  const matches: (Awaited<ReturnType<typeof findYouTubeMatch>> | null)[] = Array(searchTracks.length).fill(null);
  let attempted = 0;
  try {
    let nextIndex = 0;
    let searchFailure: unknown;
    const worker = async () => {
      while (!searchFailure) {
        const index = nextIndex++;
        if (index >= searchTracks.length) return;
        attempted++;
        try {
          matches[index] = await findYouTubeMatch(searchTracks[index], youtubeApiKey);
        } catch (error) {
          searchFailure = error;
        }
      }
    };
    await Promise.all(Array.from({ length: Math.min(4, searchTracks.length) }, worker));
    if (searchFailure) {
      throw searchFailure;
    }
  } catch (error) {
    await releaseSpotifySearches(reservation.day, reservation.reserved - attempted);
    if (error instanceof SpotifyImportServiceError) {
      const status = error.code === "youtube-quota" ? 429 : error.code === "youtube-config" ? 503 : 502;
      throw new InputError(error.message, status);
    }
    throw error;
  }

  const importedTracks: Track[] = [];
  const seenVideoIds = new Set<string>();
  const unmatched: string[] = [];
  let duplicates = 0;
  for (let i = 0; i < matches.length; i++) {
    const match = matches[i];
    if (!match) {
      const sourceTrack = searchTracks[i];
      unmatched.push(`${sourceTrack.artists.join(", ")}${sourceTrack.artists.length ? " — " : ""}${sourceTrack.title}`);
      continue;
    }
    if (seenVideoIds.has(match.videoId)) { duplicates++; continue; }
    seenVideoIds.add(match.videoId);
    importedTracks.push({ id: randomUUID(), videoId: match.videoId, title: match.title });
  }
  if (!importedTracks.length) {
    throw new InputError("No YouTube video matches were found, so no playlist was saved.", 422);
  }

  const playlist = await createImportedPlaylist(username, source.name, importedTracks);
  res.status(201).json({
    playlist,
    searched: searchTracks.length,
    added: importedTracks.length,
    duplicates,
    unmatched,
    notSearched: Math.max(0, source.totalTracks - searchTracks.length),
  });
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
