import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import express from "express";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { once } from "node:events";
import path from "node:path";
import { runInNewContext } from "node:vm";
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
  await mkdir(path.join(assetDirectory, "undertale"), { recursive: true });
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
    '<!doctype html><html><head><title>PVZ</title><script id="early-storage">window.localStorage=window.localStorage||{};</script></head><body></body></html>',
  );
  await writeFile(
    path.join(assetDirectory, "undertale", "index.html"),
    "<!doctype html><html><head></head><body><script>const blob = new Blob([document.querySelector('#tick-worker').textContent]);\nconst worker = new Worker(window.URL.createObjectURL(blob));\n\nworker.onmessage = function () {\n  GM_tick(performance.now());\n};</script><script>worker.postMessage({run: false});</script></body></html>",
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
  assert.match(gameHtml, /ported-game-indexeddb-save-bridge/);
  assert.match(gameHtml, /createObjectStore/);
  const indexedDbBridge = gameHtml.match(/\/\* ported-game-indexeddb-save-bridge \*\/([\s\S]*?)<\/script>/);
  assert(indexedDbBridge, "IndexedDB bridge script is present");
  assert.doesNotThrow(() => new Function(indexedDbBridge[1]), "IndexedDB bridge script parses");
  response = await fetch(`${baseUrl}/ported-games/undertale/index.html`);
  assert.equal(response.status, 200);
  const undertaleHtml = await response.text();
  assert.match(undertaleHtml, /tickWorkerScript/);
  assert.match(undertaleHtml, /requestAnimationFrame\(fallbackTick\)/);
  assert.match(undertaleHtml, /worker\?\.postMessage/);
  const fallbackStart = undertaleHtml.indexOf("const tickWorkerScript");
  const fallbackScript = undertaleHtml.slice(
    undertaleHtml.lastIndexOf("<script>", fallbackStart) + "<script>".length,
    undertaleHtml.indexOf("</script>", fallbackStart),
  );
  assert.doesNotThrow(() => new Function(fallbackScript), "Undertale worker fallback script parses");
  for (const [gameId, database, storeName] of [
    ["undertale", "emscripten_filesystem", "FILES"],
    ["hillclimb", "hcrwasm", "files"],
    ["ac-gamecube", "EM_FS", "FILE_DATA"],
    ["another-idb-game", "saveDB", "saves"],
  ]) {
    const savedFiles = new Map<string, Uint8Array>();
    let onMessage: ((event: { source: unknown; data: Record<string, unknown> }) => void) | undefined;
    const parent = {
      postMessage(message: Record<string, unknown>) {
        queueMicrotask(() => {
          const name = String(message.name);
          if (message.operation === "read") {
            const saved = savedFiles.get(name);
            onMessage?.({
              source: parent,
              data: saved
                ? { source: "ported-game-indexeddb-response", requestId: message.requestId, ok: true, bytes: saved.slice().buffer }
                : { source: "ported-game-indexeddb-response", requestId: message.requestId, ok: false, error: "NotFoundError" },
            });
          } else {
            savedFiles.set(name, new Uint8Array(message.bytes as ArrayBuffer).slice());
            onMessage?.({
              source: parent,
              data: { source: "ported-game-indexeddb-response", requestId: message.requestId, ok: true, bytes: new ArrayBuffer(0) },
            });
          }
        });
      },
    };
    const context: Record<string, unknown> = {
      window: { __pdGameSaveBootstrap: { gameId } },
      parent,
      addEventListener: (type: string, callback: typeof onMessage) => {
        if (type === "message") onMessage = callback;
      },
      crypto: { randomUUID },
      TextEncoder,
      TextDecoder,
      Uint8Array,
      ArrayBuffer,
      Map,
      Set,
      Object,
      JSON,
      Promise,
      DOMException,
      queueMicrotask,
      structuredClone,
      btoa,
      atob,
    };
    runInNewContext(indexedDbBridge[1], context);
    const windowObject = context.window as {
      indexedDB: { open: (name: string, version: number) => Record<string, any> };
      IDBKeyRange?: { only: (value: unknown) => unknown };
    };
    const openRequest = windowObject.indexedDB.open(database, 1);
    const db = await new Promise<any>((resolve, reject) => {
      openRequest.onupgradeneeded = (event: { target: { result: any } }) => {
        const store = event.target.result.createObjectStore(
          storeName,
          gameId === "another-idb-game" ? { keyPath: ["owner", "slot"] } : undefined,
        );
        if (gameId === "another-idb-game") {
          store.createIndex("by-title", "title", { unique: true });
          store.createIndex("by-owner-slot", ["owner", "slot"]);
        }
      };
      openRequest.onsuccess = (event: { target: { result: any } }) => resolve(event.target.result);
      openRequest.onerror = (event: { target: { error: unknown } }) => reject(event.target.error);
    });
    const transaction = db.transaction(storeName, "readwrite");
    let writeRequestCompleted = false;
    const transactionComplete = new Promise<void>((resolve, reject) => {
      transaction.oncomplete = () => {
        assert.equal(writeRequestCompleted, true, "IDB transaction completes after its requests");
        resolve();
      };
      transaction.onabort = () => reject(new Error(`${gameId} IndexedDB transaction aborted`));
    });
    const store = transaction.objectStore(storeName);
    const testValue = gameId === "another-idb-game"
      ? runInNewContext('({owner:"player-1",slot:2,title:"Save A",payload:new Uint8Array([4,5,6]).buffer})', context)
      : gameId === "ac-gamecube"
        ? runInNewContext('({timestamp:1,mode:33206,contents:new Uint8Array([4,5,6]).buffer})', context)
        : runInNewContext("new Uint8Array([4, 5, 6]).buffer", context);
    await new Promise<void>((resolve, reject) => {
      const request = gameId === "another-idb-game" ? store.put(testValue) : store.put(testValue, gameId === "ac-gamecube" ? "/save-000" : "save-slot");
      request.onsuccess = () => {
        writeRequestCompleted = true;
        resolve();
      };
      request.onerror = (event: { target: { error: unknown } }) => reject(event.target.error);
    });
    await transactionComplete;
    assert(savedFiles.has(`idb-${database}.json`), `${gameId} IndexedDB writes reach account storage`);
    if (gameId === "ac-gamecube") {
      const reloadContext: Record<string, unknown> = {
        window: { __pdGameSaveBootstrap: { gameId } },
        parent,
        addEventListener: (type: string, callback: typeof onMessage) => {
          if (type === "message") onMessage = callback;
        },
        crypto: { randomUUID },
        TextEncoder,
        TextDecoder,
        Uint8Array,
        ArrayBuffer,
        Map,
        Set,
        Object,
        JSON,
        Promise,
        DOMException,
        queueMicrotask,
        structuredClone,
        btoa,
        atob,
      };
      runInNewContext(indexedDbBridge[1], reloadContext);
      const reloadWindow = reloadContext.window as typeof windowObject;
      const reopenedDb = await new Promise<any>((resolve, reject) => {
        const request = reloadWindow.indexedDB.open(database, 1);
        request.onsuccess = (event: { target: { result: any } }) => resolve(event.target.result);
        request.onerror = (event: { target: { error: unknown } }) => reject(event.target.error);
      });
      const restoredFile = await new Promise<any>((resolve, reject) => {
        const request = reopenedDb.transaction(storeName, "readonly").objectStore(storeName).get("/save-000");
        request.onsuccess = (event: { target: { result: unknown } }) => resolve(event.target.result);
        request.onerror = (event: { target: { error: unknown } }) => reject(event.target.error);
      });
      assert.equal(restoredFile.timestamp, 1, "Emscripten IDBFS records survive a fresh page context");
      assert.deepEqual(Array.from(new Uint8Array(restoredFile.contents)), [4, 5, 6]);
    }
    if (gameId === "another-idb-game") {
      const range = windowObject.IDBKeyRange?.only(["player-1", 2]);
      const compoundResult = await new Promise<any>((resolve, reject) => {
        const request = store.get(range);
        request.onsuccess = (event: { target: { result: unknown } }) => resolve(event.target.result);
        request.onerror = (event: { target: { error: unknown } }) => reject(event.target.error);
      });
      assert.equal(compoundResult.title, "Save A", "compound primary keys can be queried");
      const indexedResult = await new Promise<any>((resolve, reject) => {
        const request = store.index("by-title").get("Save A");
        request.onsuccess = (event: { target: { result: unknown } }) => resolve(event.target.result);
        request.onerror = (event: { target: { error: unknown } }) => reject(event.target.error);
      });
      assert.equal(indexedResult.owner, "player-1", "secondary indexes can retrieve values");
      const compoundIndexResult = await new Promise<any>((resolve, reject) => {
        const request = store.index("by-owner-slot").get(["player-1", 2]);
        request.onsuccess = (event: { target: { result: unknown } }) => resolve(event.target.result);
        request.onerror = (event: { target: { error: unknown } }) => reject(event.target.error);
      });
      assert.equal(compoundIndexResult.title, "Save A", "compound secondary indexes can retrieve values");
      const indexedRange = windowObject.IDBKeyRange?.bound("A", "Z");
      const indexedCount = await new Promise<number>((resolve, reject) => {
        const request = store.index("by-title").count(indexedRange);
        request.onsuccess = (event: { target: { result: number } }) => resolve(event.target.result);
        request.onerror = (event: { target: { error: unknown } }) => reject(event.target.error);
      });
      assert.equal(indexedCount, 1, "indexed key ranges are respected");
    }
  }
  assert.ok(
    gameHtml.indexOf('id="early-storage"') < gameHtml.indexOf("ported-game-save-bridge"),
    "save storage bridge runs after any existing game storage shim",
  );
  assert.match(gameHtml, /unhandledrejection/);
  assert.match(gameHtml, /securitypolicyviolation/);
  assert.match(gameHtml, /Object\.getOwnPropertyDescriptor\(Window\.prototype, key\)/);
  assert.match(gameHtml, /Gamepad access:/);
  assert.match(gameHtml, /CacheStorage:/);
  assert.match(gameHtml, /window\.fetch =/);
  assert.match(gameHtml, /XMLHttpRequest\.prototype\.send =/);
  assert.match(gameHtml, /ported-game-save-bridge/);
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
