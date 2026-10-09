export const MAX_SPOTIFY_IMPORT_TRACKS = 200;
const SPOTIFY_ITEMS_PAGE_SIZE = 50;

export interface SpotifySourceTrack {
  title: string;
  artists: string[];
}

export interface SpotifyPlaylistSource {
  name: string;
  tracks: SpotifySourceTrack[];
  totalTracks: number;
}

export interface YouTubeVideoMatch {
  videoId: string;
  title: string;
}

export type SpotifyImportErrorCode =
  | "spotify-auth"
  | "spotify-playlist"
  | "youtube-config"
  | "youtube-quota"
  | "youtube-unavailable";

export class SpotifyImportServiceError extends Error {
  constructor(readonly code: SpotifyImportErrorCode, message: string) {
    super(message);
    this.name = "SpotifyImportServiceError";
  }
}

type Fetcher = typeof fetch;

export function parseSpotifyPlaylistId(input: string): string | null {
  try {
    const url = new URL(input.trim());
    if (url.protocol !== "https:" || !["open.spotify.com", "www.open.spotify.com"].includes(url.hostname.toLowerCase())) {
      return null;
    }
    const parts = url.pathname.split("/").filter(Boolean);
    const playlistIndex = parts[0]?.startsWith("intl-") ? 1 : 0;
    if (parts[playlistIndex] !== "playlist") return null;
    const id = parts[playlistIndex + 1];
    return id && /^[A-Za-z0-9]{22}$/.test(id) ? id : null;
  } catch {
    return null;
  }
}

function isRecord(value: unknown): value is Record<string, any> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

async function fetchJson(
  fetcher: Fetcher,
  url: string,
  init: RequestInit,
  service: "spotify-auth" | "spotify-playlist" | "youtube",
): Promise<Record<string, any>> {
  let response: Response;
  try {
    response = await fetcher(url, { ...init, signal: AbortSignal.timeout(12_000) });
  } catch {
    if (service === "youtube") {
      throw new SpotifyImportServiceError("youtube-unavailable", "YouTube search could not be reached. No playlist was saved.");
    }
    throw new SpotifyImportServiceError("spotify-playlist", "Spotify could not be reached. No playlist was saved.");
  }

  let data: unknown;
  try {
    data = await response.json();
  } catch {
    data = null;
  }
  if (!response.ok) {
    if (service === "spotify-auth") {
      throw new SpotifyImportServiceError("spotify-auth", "Spotify rejected the server app credentials. No playlist was saved.");
    }
    if (service === "spotify-playlist") {
      throw new SpotifyImportServiceError("spotify-playlist", "Spotify could not read that public playlist. Check the link and make sure the playlist is public.");
    }
    const errors = isRecord(data) && isRecord(data.error) && Array.isArray(data.error.errors) ? data.error.errors : [];
    const reasons = errors.map((error: unknown) => isRecord(error) ? error.reason : null);
    if (reasons.some((reason: unknown) => reason === "quotaExceeded" || reason === "dailyLimitExceeded")) {
      throw new SpotifyImportServiceError("youtube-quota", "The site's YouTube search quota is exhausted for today. No playlist was saved.");
    }
    if (response.status === 400 || response.status === 403) {
      throw new SpotifyImportServiceError("youtube-config", "YouTube search failed. Check that the API key is valid and the YouTube Data API is enabled.");
    }
    throw new SpotifyImportServiceError("youtube-unavailable", "YouTube search is temporarily unavailable. No playlist was saved.");
  }
  if (!isRecord(data)) {
    throw new SpotifyImportServiceError(
      service === "youtube" ? "youtube-unavailable" : "spotify-playlist",
      "A music service returned an invalid response. No playlist was saved.",
    );
  }
  return data;
}

export async function fetchSpotifyPublicPlaylist(
  playlistId: string,
  credentials: { clientId: string; clientSecret: string },
  fetcher: Fetcher = fetch,
): Promise<SpotifyPlaylistSource> {
  const token = await fetchJson(
    fetcher,
    "https://accounts.spotify.com/api/token",
    {
      method: "POST",
      headers: {
        Authorization: `Basic ${Buffer.from(`${credentials.clientId}:${credentials.clientSecret}`).toString("base64")}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({ grant_type: "client_credentials" }),
    },
    "spotify-auth",
  );
  if (typeof token.access_token !== "string" || !token.access_token) {
    throw new SpotifyImportServiceError("spotify-auth", "Spotify did not provide an access token. No playlist was saved.");
  }

  const authHeaders = { Authorization: `Bearer ${token.access_token}` };
  const encodedId = encodeURIComponent(playlistId);
  const [playlist, page] = await Promise.all([
    fetchJson(
      fetcher,
      `https://api.spotify.com/v1/playlists/${encodedId}?fields=name,tracks.total`,
      { headers: authHeaders },
      "spotify-playlist",
    ),
    fetchJson(
      fetcher,
      `https://api.spotify.com/v1/playlists/${encodedId}/items?limit=${SPOTIFY_ITEMS_PAGE_SIZE}&offset=0`,
      { headers: authHeaders },
      "spotify-playlist",
    ),
  ]);

  const totalItems = isRecord(playlist.tracks) && Number.isSafeInteger(playlist.tracks.total)
    ? playlist.tracks.total
    : Number.isSafeInteger(page.total) ? page.total : (Array.isArray(page.items) ? page.items.length : 0);
  const items: unknown[] = Array.isArray(page.items) ? [...page.items] : [];
  while (items.length > 0 && items.length < Math.min(totalItems, MAX_SPOTIFY_IMPORT_TRACKS)) {
    const nextPage = await fetchJson(
      fetcher,
      `https://api.spotify.com/v1/playlists/${encodedId}/items?limit=${SPOTIFY_ITEMS_PAGE_SIZE}&offset=${items.length}`,
      { headers: authHeaders },
      "spotify-playlist",
    );
    const nextItems: unknown[] = Array.isArray(nextPage.items) ? nextPage.items : [];
    if (!nextItems.length) break;
    items.push(...nextItems.slice(0, MAX_SPOTIFY_IMPORT_TRACKS - items.length));
  }
  const tracks: SpotifySourceTrack[] = [];
  for (const entry of items) {
    if (!isRecord(entry)) continue;
    const item = isRecord(entry.item) ? entry.item : isRecord(entry.track) ? entry.track : null;
    if (!item || (typeof item.type === "string" && item.type !== "track") || item.is_local === true) continue;
    if (typeof item.name !== "string" || !item.name.trim()) continue;
    const artists = Array.isArray(item.artists)
      ? item.artists.flatMap((artist: unknown) => isRecord(artist) && typeof artist.name === "string" ? [artist.name.trim()] : []).filter(Boolean).slice(0, 5)
      : [];
    tracks.push({ title: item.name.trim().slice(0, 200), artists });
    if (tracks.length >= MAX_SPOTIFY_IMPORT_TRACKS) break;
  }

  const name = typeof playlist.name === "string" && playlist.name.trim()
    ? playlist.name.trim().replace(/[\u0000-\u001f\u007f]/g, "").slice(0, 100)
    : "Spotify import";
  return {
    name: name || "Spotify import",
    tracks,
    totalTracks: Math.max(tracks.length, totalItems),
  };
}

export function spotifyTrackSearchQuery(track: SpotifySourceTrack): string {
  return [track.title, ...track.artists].join(" ").replace(/\s+/g, " ").trim().slice(0, 200);
}

export async function findYouTubeMatch(
  track: SpotifySourceTrack,
  apiKey: string,
  fetcher: Fetcher = fetch,
): Promise<YouTubeVideoMatch | null> {
  const url = new URL("https://www.googleapis.com/youtube/v3/search");
  url.searchParams.set("part", "snippet");
  url.searchParams.set("type", "video");
  url.searchParams.set("videoEmbeddable", "true");
  url.searchParams.set("maxResults", "5");
  url.searchParams.set("q", spotifyTrackSearchQuery(track));
  const data = await fetchJson(
    fetcher,
    url.toString(),
    { headers: { "X-Goog-Api-Key": apiKey } },
    "youtube",
  );
  const items = Array.isArray(data.items) ? data.items : [];
  for (const result of items) {
    if (!isRecord(result) || !isRecord(result.id) || !isRecord(result.snippet)) continue;
    if (typeof result.id.videoId !== "string" || !/^[A-Za-z0-9_-]{11}$/.test(result.id.videoId)) continue;
    if (typeof result.snippet.title !== "string" || !result.snippet.title.trim()) continue;
    return { videoId: result.id.videoId, title: result.snippet.title.trim().slice(0, 200) };
  }
  return null;
}
