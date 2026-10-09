import assert from "node:assert/strict";
import {
  fetchSpotifyPublicPlaylist,
  findYouTubeMatch,
  parseSpotifyPlaylistId,
  SpotifyImportServiceError,
  spotifyTrackSearchQuery,
} from "../src/lib/spotify-playlist-import";

const validId = "0123456789012345678901";
assert.equal(parseSpotifyPlaylistId(`https://open.spotify.com/playlist/${validId}?si=share`), validId);
assert.equal(parseSpotifyPlaylistId(`https://open.spotify.com/intl-us/playlist/${validId}`), validId);
assert.equal(parseSpotifyPlaylistId(`https://open.spotify.com/track/${validId}`), null);
assert.equal(parseSpotifyPlaylistId(`https://open.spotify.com.attacker.test/playlist/${validId}`), null);
assert.equal(parseSpotifyPlaylistId(`http://open.spotify.com/playlist/${validId}`), null);
assert.equal(parseSpotifyPlaylistId(`https://open.spotify.com/playlist/not-a-valid-id`), null);

const requests: { url: string; headers: Headers }[] = [];
const spotifyFetch = (async (input: string | URL | Request, init?: RequestInit) => {
  const url = String(input);
  requests.push({ url, headers: new Headers(init?.headers) });
  if (url === "https://accounts.spotify.com/api/token") {
    assert.equal(init?.method, "POST");
    assert.equal(new Headers(init?.headers).get("authorization"), `Basic ${Buffer.from("client:secret").toString("base64")}`);
    return new Response(JSON.stringify({ access_token: "test-token" }), { status: 200 });
  }
  if (url.includes("/v1/playlists/")) {
    assert.equal(new Headers(init?.headers).get("authorization"), "Bearer test-token");
    if (url.includes("/items?")) {
      return new Response(JSON.stringify({
        total: 3,
        items: [
          { item: { type: "track", name: "Blue Monday", artists: [{ name: "New Order" }] } },
          { item: { type: "episode", name: "Podcast episode", artists: [] } },
          { track: { type: "track", name: "Bizarre Love Triangle", artists: [{ name: "New Order" }] } },
        ],
      }), { status: 200 });
    }
    return new Response(JSON.stringify({ name: "New Order Mix", tracks: { total: 3 } }), { status: 200 });
  }
  throw new Error(`Unexpected URL: ${url}`);
}) as typeof fetch;

const source = await fetchSpotifyPublicPlaylist(validId, { clientId: "client", clientSecret: "secret" }, spotifyFetch);
assert.equal(source.name, "New Order Mix");
assert.equal(source.totalTracks, 3);
assert.deepEqual(source.tracks, [
  { title: "Blue Monday", artists: ["New Order"] },
  { title: "Bizarre Love Triangle", artists: ["New Order"] },
]);
assert(requests.some((request) => request.url.includes(`/v1/playlists/${validId}/items?limit=50&offset=0`)));
assert.equal(spotifyTrackSearchQuery(source.tracks[0]), "Blue Monday New Order");

const pageOffsets: number[] = [];
const paginatedFetch = (async (input: string | URL | Request) => {
  const url = new URL(String(input));
  if (url.hostname === "accounts.spotify.com") {
    return new Response(JSON.stringify({ access_token: "page-token" }), { status: 200 });
  }
  if (url.pathname.endsWith("/items")) {
    const offset = Number(url.searchParams.get("offset"));
    pageOffsets.push(offset);
    const pageItems = offset === 0
      ? Array.from({ length: 50 }, (_, i) => ({ item: { name: `Track ${i + 1}`, artists: [{ name: "Artist" }] } }))
      : [{ item: { name: "Track 51", artists: [{ name: "Artist" }] } }];
    return new Response(JSON.stringify({ total: 51, items: pageItems }), { status: 200 });
  }
  return new Response(JSON.stringify({ name: "Long list", tracks: { total: 51 } }), { status: 200 });
}) as typeof fetch;
const paginated = await fetchSpotifyPublicPlaylist(validId, { clientId: "client", clientSecret: "secret" }, paginatedFetch);
assert.deepEqual(pageOffsets, [0, 50], "Public playlist items are paginated instead of silently stopping at the first page");
assert.equal(paginated.tracks.length, 51);
assert.equal(paginated.tracks[50].title, "Track 51");

let youtubeRequest: { url: string; headers: Headers } | null = null;
const youtubeFetch = (async (input: string | URL | Request, init?: RequestInit) => {
  youtubeRequest = { url: String(input), headers: new Headers(init?.headers) };
  return new Response(JSON.stringify({
    items: [{ id: { videoId: "abcdefghijk" }, snippet: { title: "Blue Monday (Official Audio)" } }],
  }), { status: 200 });
}) as typeof fetch;
assert.deepEqual(await findYouTubeMatch(source.tracks[0], "youtube-secret", youtubeFetch), {
  videoId: "abcdefghijk",
  title: "Blue Monday (Official Audio)",
});
assert(youtubeRequest);
assert.equal(youtubeRequest.headers.get("x-goog-api-key"), "youtube-secret");
assert.equal(new URL(youtubeRequest.url).searchParams.get("q"), "Blue Monday New Order");
assert.equal(new URL(youtubeRequest.url).searchParams.get("videoEmbeddable"), "true");

const quotaFetch = (async () => new Response(JSON.stringify({
  error: { errors: [{ reason: "quotaExceeded" }] },
}), { status: 403 })) as typeof fetch;
await assert.rejects(
  () => findYouTubeMatch(source.tracks[0], "unused", quotaFetch),
  (error: unknown) => error instanceof SpotifyImportServiceError && error.code === "youtube-quota",
);

const rejectedAuthFetch = (async () => new Response(JSON.stringify({ error: "secret must not appear" }), { status: 401 })) as typeof fetch;
await assert.rejects(
  () => fetchSpotifyPublicPlaylist(validId, { clientId: "client", clientSecret: "secret" }, rejectedAuthFetch),
  (error: unknown) => error instanceof SpotifyImportServiceError
    && error.code === "spotify-auth"
    && !error.message.includes("secret must not appear"),
);

console.log("PASS: Spotify link validation, public track parsing, server-only credentials, YouTube match and quota errors");
