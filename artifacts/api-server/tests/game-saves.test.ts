import assert from "node:assert/strict";
import express, { type RequestHandler } from "express";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { once } from "node:events";

const dataDir = await mkdtemp(path.join(tmpdir(), "game-saves-test-"));
process.env["GAME_SAVE_DATA_DIR"] = dataDir;
const { createGameSavesRouter } = await import("../src/routes/game-saves");
const app = express();
app.use(express.json({ limit: "1mb" }));
const testAuth: RequestHandler = (request, response, next) => {
  const userId = Number(request.get("x-test-user") ?? 0);
  if (!userId) {
    response.status(401).json({ error: "Login required" });
    return;
  }
  Object.assign(request, { session: { userId } });
  next();
};
app.use(createGameSavesRouter(testAuth));
const server = app.listen(0, "127.0.0.1");
await once(server, "listening");
const address = server.address();
assert(address && typeof address !== "string");
const url = `http://127.0.0.1:${address.port}`;

try {
  let response = await fetch(`${url}/game-saves/pvz`);
  assert.equal(response.status, 401, "saves require an account");

  response = await fetch(`${url}/game-saves/pvz`, {
    method: "PUT",
    headers: { "content-type": "application/json", "x-test-user": "17" },
    body: JSON.stringify({ storage: { progress: "level-4", score: "900" } }),
  });
  assert.equal(response.status, 200);

  response = await fetch(`${url}/game-saves/pvz`, { headers: { "x-test-user": "17" } });
  assert.deepEqual(await response.json(), { storage: { progress: "level-4", score: "900" } });

  response = await fetch(`${url}/game-saves/pvz`, { headers: { "x-test-user": "18" } });
  assert.deepEqual(await response.json(), { storage: {} }, "accounts cannot read each other's saves");

  const saveFile = new Uint8Array([0, 1, 2, 255]).buffer;
  response = await fetch(`${url}/game-saves/stardewwasm/files/Saves.tar`, {
    method: "PUT",
    headers: {
      "content-type": "application/octet-stream",
      "x-save-file-size": String(saveFile.byteLength),
      "x-test-user": "17",
    },
    body: saveFile,
  });
  assert.equal(response.status, 200, "OPFS save archives can be stored");

  response = await fetch(`${url}/game-saves/stardewwasm/files/Saves.tar`, { headers: { "x-test-user": "17" } });
  assert.deepEqual([...new Uint8Array(await response.arrayBuffer())], [0, 1, 2, 255]);

  response = await fetch(`${url}/game-saves/stardewwasm/files/Saves.tar`, { headers: { "x-test-user": "18" } });
  assert.equal(response.status, 404, "accounts cannot read another user's OPFS files");

  const indexedDbSnapshot = new TextEncoder().encode('{"stores":{"FILES":[["save",{"__pdType":"ArrayBuffer","data":"AQID"}]]}}').buffer;
  response = await fetch(`${url}/game-saves/undertale/files/idb-emscripten_filesystem.json`, {
    method: "PUT",
    headers: {
      "content-type": "application/octet-stream",
      "x-save-file-size": String(indexedDbSnapshot.byteLength),
      "x-test-user": "17",
    },
    body: indexedDbSnapshot,
  });
  assert.equal(response.status, 200, "IndexedDB snapshots can be stored");
  response = await fetch(`${url}/game-saves/undertale/files/idb-emscripten_filesystem.json`, { headers: { "x-test-user": "17" } });
  assert.equal(await response.text(), new TextDecoder().decode(indexedDbSnapshot));
  response = await fetch(`${url}/game-saves/undertale/files/idb-emscripten_filesystem.json`, { headers: { "x-test-user": "18" } });
  assert.equal(response.status, 404, "accounts cannot read another user's IndexedDB snapshot");

  response = await fetch(`${url}/game-saves/pvz`, {
    method: "PUT",
    headers: { "content-type": "application/json", "x-test-user": "17" },
    body: JSON.stringify({ storage: { tooLarge: "x".repeat(128 * 1024 + 1) } }),
  });
  assert.equal(response.status, 400, "oversized saves are rejected");
  console.log("PASS: account-only localStorage, OPFS, and IndexedDB saves; isolation, round-trips, and limits");
} finally {
  server.close();
  await once(server, "close");
  await rm(dataDir, { recursive: true, force: true });
}
