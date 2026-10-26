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
const gameDataDirectory = await mkdtemp(path.join(tmpdir(), "ported-game-data-"));
const app = express();
const gameAssets = createPortedGameAssetsRouter(assetDirectory, {
  gameDataDirectory,
  isGameApproved: async gameId => gameId === "duke3d",
});
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
  await mkdir(path.join(assetDirectory, "deltarune"), { recursive: true });
  await mkdir(path.join(assetDirectory, "hill-climb-racing"), { recursive: true });
  await mkdir(path.join(assetDirectory, "quake3"), { recursive: true });
  await mkdir(path.join(gameDataDirectory, "belgian-chocolate-duke3d"), { recursive: true });
  await mkdir(path.join(gameDataDirectory, "fallout1-ce"), { recursive: true });
  await writeFile(
    path.join(assetDirectory, "asset-manifest.json"),
    JSON.stringify({ version: 1, games: { pvz: { installed: true } } }),
  );
  await writeFile(
    path.join(assetDirectory, "pvz", "index.html"),
    "<!doctype html><html><head><title>PVZ</title></head><body></body></html>",
  );
  await writeFile(
    path.join(assetDirectory, "deltarune", "index.html"),
    '<!doctype html><html><head><title>DELTARUNE</title><script src="https://cdnjs.cloudflare.com/ajax/libs/jszip/3.10.1/jszip.min.js"></script></head></html>',
  );
  await writeFile(
    path.join(assetDirectory, "quake3", "Quake3.htm"),
    "<!doctype html><html><head><title>Quake III</title></head><body>demo</body></html>",
  );
  await writeFile(path.join(assetDirectory, "hill-climb-racing", "hcr.wasm.part1"), Buffer.from([0, 1, 2]));
  await writeFile(path.join(assetDirectory, "hill-climb-racing", "hcr.wasm.part2"), Buffer.from([3, 4]));
  await writeFile(path.join(gameDataDirectory, "belgian-chocolate-duke3d", "DUKE3D.GRP"), Buffer.from("game data"));
  await writeFile(path.join(gameDataDirectory, "fallout1-ce", "master.dat"), Buffer.from("private until approved"));

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
  const gameHtml = await response.text();
  assert.match(gameHtml, /source: "ported-game-diagnostics"/);
  assert.match(gameHtml, /unhandledrejection/);
  assert.match(gameHtml, /securitypolicyviolation/);
  assert.match(gameHtml, /Object\.getOwnPropertyDescriptor\(Window\.prototype, key\)/);
  assert.match(gameHtml, /Gamepad access:/);
  assert.match(gameHtml, /CacheStorage:/);
  assert.match(gameHtml, /window\.fetch =/);
  assert.match(gameHtml, /XMLHttpRequest\.prototype\.send =/);
  assert.match(gameHtml, /<title>PVZ<\/title>/);
  assert.doesNotMatch(csp, /cdnjs\.cloudflare\.com/);

  response = await fetch(`${baseUrl}/ported-games/deltarune/index.html`);
  assert.equal(response.status, 200);
  const deltaruneCsp = response.headers.get("content-security-policy") ?? "";
  assert.match(deltaruneCsp, /https:\/\/cdnjs\.cloudflare\.com/);
  assert.match(deltaruneCsp, /https:\/\/mrdoob\.github\.io/);
  assert.doesNotMatch(deltaruneCsp, /allow-same-origin/);

  response = await fetch(`${baseUrl}/ported-games/quake3/Quake3.htm?demo`);
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-security-policy") ?? "", /sandbox allow-forms/);
  assert.match(await response.text(), /<title>Quake III<\/title>/);

  response = await fetch(`${baseUrl}/ported-games/hill-climb-racing/hcr.wasm`);
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("content-type"), "application/wasm");
  assert.equal(response.headers.get("content-length"), "5");
  assert.deepEqual(Buffer.from(await response.arrayBuffer()), Buffer.from([0, 1, 2, 3, 4]));

  response = await fetch(`${baseUrl}/ported-games/belgian-chocolate-duke3d/DUKE3D.GRP`);
  assert.equal(response.status, 200, "approved games can fetch uploaded user data");
  assert.equal(await response.text(), "game data");
  response = await fetch(`${baseUrl}/ported-games/fallout1-ce/master.dat`);
  assert.equal(response.status, 404, "unapproved game uploads are not public");

  response = await fetch(`${baseUrl}/ported-games/missing/index.html`);
  assert.equal(response.status, 404);
  assert.equal(await response.text(), "Game asset not found");

  response = await fetch(`${baseUrl}/ported-games/%252e%252e/package.json`);
  assert.equal(response.status, 404, "encoded traversal cannot escape the game asset directory");

  response = await fetch(`${baseUrl}/`);
  assert.equal(response.status, 200);
  assert.equal(await response.text(), "main site");

  console.log("PASS: path hosting, sandbox CSP, runtime permission/request diagnostics, missing files, and normal routes");
} finally {
  server.close();
  await once(server, "close");
  await rm(assetDirectory, { recursive: true, force: true });
  await rm(gameDataDirectory, { recursive: true, force: true });
}
