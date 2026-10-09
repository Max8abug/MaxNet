import assert from "node:assert/strict";
import express from "express";
import { once } from "node:events";
import router from "../src/routes/personal-playlists";
import { getSpotifyImportDbState, resetSpotifyImportDb } from "./spotify-import-db";

const oldEnv = {
  clientId: process.env["SPOTIFY_CLIENT_ID"],
  clientSecret: process.env["SPOTIFY_CLIENT_SECRET"],
  youtubeKey: process.env["YOUTUBE_DATA_API_KEY"],
  dailyLimit: process.env["SPOTIFY_IMPORT_DAILY_SEARCH_LIMIT"],
};
const realFetch = globalThis.fetch;
const playlistId = "0123456789012345678901";
const spotifyUrl = `https://open.spotify.com/playlist/${playlistId}?si=test`;
const youtubeQueries: string[] = [];

function restoreEnv(name: string, value: string | undefined) {
  if (value === undefined) delete process.env[name];
  else process.env[name] = value;
}

process.env["SPOTIFY_CLIENT_ID"] = "test-client";
process.env["SPOTIFY_CLIENT_SECRET"] = "test-client-secret";
process.env["YOUTUBE_DATA_API_KEY"] = "test-youtube-key";
process.env["SPOTIFY_IMPORT_DAILY_SEARCH_LIMIT"] = "10";

globalThis.fetch = (async (input: string | URL | Request) => {
  const url = new URL(String(input));
  if (url.hostname === "accounts.spotify.com") {
    return new Response(JSON.stringify({ access_token: "test-bearer" }), { status: 200 });
  }
  if (url.hostname === "api.spotify.com" && url.pathname.endsWith("/items")) {
    return new Response(JSON.stringify({
      total: 3,
      items: [
        { item: { type: "track", name: "Found Song", artists: [{ name: "Artist One" }] } },
        { item: { type: "track", name: "Duplicate Song", artists: [{ name: "Artist Two" }] } },
        { item: { type: "track", name: "Missing Song", artists: [{ name: "Artist Three" }] } },
      ],
    }), { status: 200 });
  }
  if (url.hostname === "api.spotify.com") {
    return new Response(JSON.stringify({ name: "Imported Mix", tracks: { total: 3 } }), { status: 200 });
  }
  if (url.hostname === "www.googleapis.com") {
    const query = url.searchParams.get("q") ?? "";
    youtubeQueries.push(query);
    const items = query.includes("Missing Song")
      ? []
      : [{ id: { videoId: "abcdefghijk" }, snippet: { title: "Matched YouTube Song" } }];
    return new Response(JSON.stringify({ items }), { status: 200 });
  }
  throw new Error(`Unexpected URL ${url}`);
}) as typeof fetch;

const app = express();
app.use(express.json());
app.use("/api", router);
const server = app.listen(0, "127.0.0.1");
await once(server, "listening");
const address = server.address();
assert(address && typeof address !== "string");
const endpoint = `http://127.0.0.1:${address.port}/api/personal-playlists/import-spotify`;

async function post(url: string) {
  return realFetch(endpoint, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ url }),
  });
}

try {
  resetSpotifyImportDb();
  youtubeQueries.length = 0;
  let response = await post(spotifyUrl);
  assert.equal(response.status, 201);
  const body = await response.json() as {
    playlist: { name: string; tracks: Array<{ videoId: string; title: string }> };
    searched: number;
    added: number;
    duplicates: number;
    unmatched: string[];
    notSearched: number;
  };
  assert.equal(body.playlist.name, "Imported Mix");
  assert.deepEqual(body.playlist.tracks.map((track) => track.videoId), ["abcdefghijk"]);
  assert.equal(body.playlist.tracks[0].title, "Matched YouTube Song");
  assert.equal(body.searched, 3);
  assert.equal(body.added, 1);
  assert.equal(body.duplicates, 1);
  assert.deepEqual(body.unmatched, ["Artist Three — Missing Song"]);
  assert.equal(body.notSearched, 0);
  assert.equal(youtubeQueries.length, 3);
  assert.equal(getSpotifyImportDbState().searchesUsed, 3);
  assert.equal(getSpotifyImportDbState().playlists.length, 1);

  process.env["SPOTIFY_IMPORT_DAILY_SEARCH_LIMIT"] = "5";
  response = await post(spotifyUrl);
  assert.equal(response.status, 201, "Imports the remaining daily allowance rather than exceeding it");
  const limited = await response.json() as { searched: number; notSearched: number };
  assert.equal(limited.searched, 2);
  assert.equal(limited.notSearched, 1);
  assert.equal(getSpotifyImportDbState().searchesUsed, 5);

  response = await post(spotifyUrl);
  assert.equal(response.status, 429);
  assert.equal(getSpotifyImportDbState().playlists.length, 2, "An exhausted allowance does not create another playlist");

  const beforeInvalid = youtubeQueries.length;
  response = await post("https://open.spotify.com/track/0123456789012345678901");
  assert.equal(response.status, 400);
  assert.equal(youtubeQueries.length, beforeInvalid);

  process.env["SPOTIFY_IMPORT_DAILY_SEARCH_LIMIT"] = "10";
  delete process.env["YOUTUBE_DATA_API_KEY"];
  response = await post(spotifyUrl);
  assert.equal(response.status, 503);
  assert.equal(getSpotifyImportDbState().playlists.length, 2, "Missing credentials do not create a playlist");
  console.log("PASS: authenticated Spotify import route saves matched videos, reports misses, and enforces daily quota");
} finally {
  globalThis.fetch = realFetch;
  restoreEnv("SPOTIFY_CLIENT_ID", oldEnv.clientId);
  restoreEnv("SPOTIFY_CLIENT_SECRET", oldEnv.clientSecret);
  restoreEnv("YOUTUBE_DATA_API_KEY", oldEnv.youtubeKey);
  restoreEnv("SPOTIFY_IMPORT_DAILY_SEARCH_LIMIT", oldEnv.dailyLimit);
  await new Promise<void>((resolve, reject) => server.close((err) => err ? reject(err) : resolve()));
}
