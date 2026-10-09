let searchesUsed = 0;
let playlists: Array<{ id: number; username: string; name: string; revision: number; tracks: unknown[]; createdAt: Date; updatedAt: Date }> = [];

export function resetSpotifyImportDb() {
  searchesUsed = 0;
  playlists = [];
}

export function getSpotifyImportDbState() {
  return { searchesUsed, playlists: structuredClone(playlists) };
}

function countFor(username: string) {
  return playlists.filter((playlist) => playlist.username === username).length;
}

export const pool = {
  async query(sql: string, values: unknown[] = []) {
    if (sql.includes("count(*)::int AS count FROM personal_youtube_playlists")) {
      return { rows: [{ count: countFor(String(values[0])) }], rowCount: 1 };
    }
    if (sql.includes("UPDATE personal_playlist_youtube_search_usage")) {
      searchesUsed = Math.max(0, searchesUsed - Number(values[1] ?? 0));
      return { rows: [], rowCount: 1 };
    }
    throw new Error(`Unexpected pool query: ${sql}`);
  },
  async connect() {
    return {
      async query(sql: string, values: unknown[] = []) {
        if (/^(BEGIN|COMMIT|ROLLBACK)$/.test(sql)) return { rows: [], rowCount: 0 };
        if (sql.includes("INSERT INTO personal_playlist_youtube_search_usage")) return { rows: [], rowCount: 1 };
        if (sql.includes("SELECT searches_used FROM personal_playlist_youtube_search_usage")) {
          return { rows: [{ searches_used: searchesUsed }], rowCount: 1 };
        }
        if (sql.includes("UPDATE personal_playlist_youtube_search_usage")) {
          searchesUsed += Number(values[1] ?? 0);
          return { rows: [], rowCount: 1 };
        }
        if (sql.includes("pg_advisory_xact_lock")) return { rows: [], rowCount: 1 };
        if (sql.includes("count(*)::int AS count FROM personal_youtube_playlists")) {
          return { rows: [{ count: countFor(String(values[0])) }], rowCount: 1 };
        }
        if (sql.includes("INSERT INTO personal_youtube_playlists")) {
          const now = new Date();
          const playlist = {
            id: playlists.length + 1,
            username: String(values[0]),
            name: String(values[1]),
            revision: 0,
            tracks: JSON.parse(String(values[2])),
            createdAt: now,
            updatedAt: now,
          };
          playlists.push(playlist);
          return { rows: [playlist], rowCount: 1 };
        }
        throw new Error(`Unexpected connection query: ${sql}`);
      },
      release() {},
    };
  },
};
