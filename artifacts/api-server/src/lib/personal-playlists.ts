export const personalPlaylistsSchema = `
  CREATE TABLE IF NOT EXISTS personal_youtube_playlists (
    id serial PRIMARY KEY,
    username text NOT NULL REFERENCES users(username) ON DELETE CASCADE,
    name text NOT NULL,
    revision integer NOT NULL DEFAULT 0,
    tracks jsonb NOT NULL DEFAULT '[]'::jsonb
      CHECK (jsonb_typeof(tracks) = 'array' AND jsonb_array_length(tracks) <= 200),
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
  );
  ALTER TABLE personal_youtube_playlists ADD COLUMN IF NOT EXISTS revision integer NOT NULL DEFAULT 0;
  CREATE INDEX IF NOT EXISTS personal_youtube_playlists_user_idx ON personal_youtube_playlists(username);
  CREATE TABLE IF NOT EXISTS personal_playlist_youtube_search_usage (
    usage_day date PRIMARY KEY,
    searches_used integer NOT NULL DEFAULT 0 CHECK (searches_used >= 0),
    updated_at timestamptz NOT NULL DEFAULT now()
  );
`;

export function parsePersonalYouTubeId(input: string): string | null {
  const value = input.trim();
  if (/^[A-Za-z0-9_-]{11}$/.test(value)) return value;
  try {
    const url = new URL(/^https?:\/\//i.test(value) ? value : `https://${value}`);
    if (url.protocol !== "https:" && url.protocol !== "http:") return null;
    const host = url.hostname.toLowerCase();
    const parts = url.pathname.split("/").filter(Boolean);
    let id: string | null = null;
    if (host === "youtu.be" || host === "www.youtu.be") id = parts[0] || null;
    else if (host === "youtube.com" || host.endsWith(".youtube.com") || host === "youtube-nocookie.com" || host.endsWith(".youtube-nocookie.com")) {
      if (url.pathname === "/watch") id = url.searchParams.get("v");
      else if (["embed", "shorts", "live"].includes(parts[0])) id = parts[1] || null;
    }
    return id && /^[A-Za-z0-9_-]{11}$/.test(id) ? id : null;
  } catch { return null; }
}

// Metadata is optional. Failure keeps the actual canonical video URL as its label;
// never proxy, extract, or download YouTube audio.
export async function fetchYouTubeTitles(videoIds: string[]): Promise<Map<string, string>> {
  const titles = new Map<string, string>();
  const signal = AbortSignal.timeout(5_000);
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(8, videoIds.length) }, async () => {
    while (next < videoIds.length) {
      const videoId = videoIds[next++];
      const canonical = `https://www.youtube.com/watch?v=${videoId}`;
      let title = canonical;
      if (!signal.aborted) {
        try {
          const response = await fetch(`https://www.youtube.com/oembed?format=json&url=${encodeURIComponent(canonical)}`, { signal, redirect: "error" });
          if (response.ok) {
            const data = await response.json();
            if (data && typeof data === "object" && "title" in data && typeof data.title === "string" && data.title.trim()) title = data.title.trim().slice(0, 200);
          }
        } catch { /* Video still remains usable; unavailable metadata is not a playback verdict. */ }
      }
      titles.set(videoId, title);
    }
  }));
  return titles;
}
