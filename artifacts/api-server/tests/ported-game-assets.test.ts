import assert from "node:assert/strict";
import express from "express";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { once } from "node:events";
import path from "node:path";
import { tmpdir } from "node:os";
import {
  createPortedGameAssetsRouter,
  shouldServePortedGameRequest,
} from "../src/lib/ported-game-assets";

const assetDirectory = await mkdtemp(path.join(tmpdir(), "ported-game-assets-"));
const app = express();
const gameAssets = createPortedGameAssetsRouter(assetDirectory);
app.use((request, response, next) => {
  if (!shouldServePortedGameRequest(request.hostname, request.path)) return next();
  return gameAssets(request, response, next);
});
app.get("*splat", (_request, response) => response.status(200).send("main site"));

const server = app.listen(0, "127.0.0.1");
await once(server, "listening");
const address = server.address();
assert(address && typeof address !== "string");
const baseUrl = `http://127.0.0.1:${address.port}`;

try {
  await mkdir(path.join(assetDirectory, "pvz"), { recursive: true });
  await writeFile(
    path.join(assetDirectory, "asset-manifest.json"),
    JSON.stringify({ version: 1, games: { pvz: { installed: true } } }),
  );
  await writeFile(
    path.join(assetDirectory, "pvz", "index.html"),
    "<!doctype html><title>PVZ</title>",
  );

  assert.equal(
    shouldServePortedGameRequest(
      "moonbat.ddns.net",
      "/ported-games/asset-manifest.json",
    ),
    true,
    "the main hostname serves game assets under the path",
  );
  assert.equal(
    shouldServePortedGameRequest("games.moonbat.ddns.net", "/"),
    true,
    "legacy game hosts remain static-only",
  );
  assert.equal(
    shouldServePortedGameRequest("moonbat.ddns.net", "/api/users"),
    false,
    "ordinary main-site routes keep their normal handlers",
  );
  assert.equal(
    shouldServePortedGameRequest("moonbat.ddns.net", "/ported-games-extra"),
    false,
    "similarly prefixed unrelated paths are not intercepted",
  );

  let response = await fetch(`${baseUrl}/ported-games/asset-manifest.json`);
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("access-control-allow-origin"), "*");
  assert.equal(response.headers.get("cache-control"), "no-store");
  assert.deepEqual(await response.json(), {
    version: 1,
    games: { pvz: { installed: true } },
  });

  response = await fetch(`${baseUrl}/ported-games/pvz/index.html`);
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("access-control-allow-origin"), "*");
  const csp = response.headers.get("content-security-policy") ?? "";
  assert.match(csp, /sandbox allow-forms allow-modals allow-pointer-lock allow-downloads allow-scripts/);
  assert.doesNotMatch(csp, /allow-same-origin/);

  response = await fetch(`${baseUrl}/ported-games/missing/index.html`);
  assert.equal(response.status, 404);
  assert.equal(await response.text(), "Game asset not found");

  response = await fetch(`${baseUrl}/`);
  assert.equal(response.status, 200);
  assert.equal(await response.text(), "main site");

  console.log("PASS: main-site path, legacy game host, static CORS, sandbox CSP, missing files, and normal routes");
} finally {
  server.close();
  await once(server, "close");
  await rm(assetDirectory, { recursive: true, force: true });
}
