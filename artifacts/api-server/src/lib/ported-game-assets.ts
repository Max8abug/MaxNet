import express, { type Router } from "express";
import { createReadStream } from "node:fs";
import { lstat, readFile, readdir, stat } from "node:fs/promises";
import path from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { GAME_PORT_DATA_CATALOG, GAME_PORT_DATA_ROOT, safeGameDataPath } from "./game-port-data";

const GAME_CONTENT_SECURITY_POLICY = [
  "sandbox allow-forms allow-modals allow-pointer-lock allow-downloads allow-scripts",
  "default-src 'self' data: blob:",
  "script-src 'self' 'unsafe-inline' 'unsafe-eval' 'wasm-unsafe-eval' blob:",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "font-src 'self' data: blob:",
  "media-src 'self' data: blob:",
  "connect-src 'self' data: blob:",
  "worker-src 'self' blob:",
  "frame-src 'self' data: blob:",
  "form-action 'self'",
  "object-src 'none'",
  "base-uri 'self'",
].join("; ");

const GAME_SAVE_BOOTSTRAP = `<script>
/* ported-game-save-bridge */
(() => {
  try {
    const params = new URLSearchParams(location.hash.slice(1));
    const raw = params.get("__pd_save");
    if (!raw) return;
    const bootstrap = JSON.parse(raw);
    if (bootstrap.version !== 1 || typeof bootstrap.gameId !== "string") return;
    window.__pdGameSaveBootstrap = bootstrap;
    const values = new Map(Object.entries(bootstrap.storage || {}).filter(
      ([key, value]) => typeof key === "string" && typeof value === "string"
    ));
    try {
      const previous = window.localStorage;
      for (let index = 0; index < previous.length; index += 1) {
        const key = previous.key(index);
        if (key !== null && !values.has(key)) values.set(key, previous.getItem(key) || "");
      }
    } catch (_) {}
    const save = () => {
      try {
        const storage = Object.fromEntries(values);
        if (new Blob([JSON.stringify(storage)]).size <= 128 * 1024) {
          parent.postMessage({ source: "ported-game-save", version: 1, gameId: bootstrap.gameId, storage }, "*");
        }
      } catch (_) {}
    };
    const makeStorage = (storageValues, persist) => ({
      get length() { return storageValues.size; },
      key: index => Array.from(storageValues.keys())[index] ?? null,
      getItem: key => storageValues.has(String(key)) ? storageValues.get(String(key)) : null,
      setItem: (key, value) => { storageValues.set(String(key), String(value)); if (persist) save(); },
      removeItem: key => { storageValues.delete(String(key)); if (persist) save(); },
      clear: () => { storageValues.clear(); if (persist) save(); }
    });
    Object.defineProperty(window, "localStorage", { configurable: true, value: makeStorage(values, true) });
    try { Object.defineProperty(window, "sessionStorage", { configurable: true, value: makeStorage(new Map(), false) }); } catch (_) {}
    if (bootstrap.gameId === "stardewwasm") {
    const saveFiles = new Set(["Saves.tar", "DevicePreferences.tar"]);
    const memoryFiles = new Map();
    const pending = new Map();
    addEventListener("message", event => {
      const data = event.data;
      if (event.source !== parent || !data || data.source !== "ported-game-opfs-response") return;
      const callbacks = pending.get(data.requestId);
      if (!callbacks) return;
      pending.delete(data.requestId);
      if (data.ok) callbacks.resolve(data.bytes || null);
      else callbacks.reject(new DOMException(data.error || "Save file unavailable", data.error === "NotFoundError" ? "NotFoundError" : "NotAllowedError"));
    });
    const requestFile = (operation, name, bytes) => new Promise((resolve, reject) => {
      const requestId = crypto.randomUUID();
      pending.set(requestId, { resolve, reject });
      const message = { source: "ported-game-opfs", version: 1, gameId: bootstrap.gameId, requestId, operation, name, bytes };
      try {
        if (bytes instanceof ArrayBuffer) parent.postMessage(message, "*", [bytes]);
        else parent.postMessage(message, "*");
      } catch (error) {
        pending.delete(requestId);
        reject(error);
      }
    });
    const makeHandle = name => ({
      getFile: async () => {
        let bytes = memoryFiles.get(name);
        if (!bytes && saveFiles.has(name)) bytes = await requestFile("read", name);
        if (!bytes) throw new DOMException("File not found", "NotFoundError");
        return new File([bytes], name);
      },
      createWritable: async () => {
        const chunks = [];
        return {
          write: async chunk => {
            if (chunk instanceof Blob) chunks.push(await chunk.arrayBuffer());
            else if (chunk instanceof ArrayBuffer) chunks.push(chunk);
            else if (ArrayBuffer.isView(chunk)) chunks.push(chunk.buffer.slice(chunk.byteOffset, chunk.byteOffset + chunk.byteLength));
            else throw new TypeError("Unsupported save stream chunk");
          },
          close: async () => {
            const bytes = await new Blob(chunks).arrayBuffer();
            if (saveFiles.has(name)) await requestFile("write", name, bytes.slice(0));
            memoryFiles.set(name, bytes);
          },
          abort: async () => { chunks.length = 0; }
        };
      }
    });
    const directory = {
      getFileHandle: async (name, options = {}) => {
        if (!/^[A-Za-z0-9_.-]{1,128}$/.test(name)) throw new TypeError("Invalid save file name");
        if (!options.create && !memoryFiles.has(name) && saveFiles.has(name)) {
          const bytes = await requestFile("read", name);
          if (bytes) memoryFiles.set(name, bytes);
        }
        if (!options.create && !memoryFiles.has(name)) throw new DOMException("File not found", "NotFoundError");
        return makeHandle(name);
      },
      removeEntry: async name => { memoryFiles.delete(name); }
    };
    try {
      const storage = Object.create(navigator.storage);
      Object.defineProperty(storage, "getDirectory", { value: async () => directory });
      Object.defineProperty(storage, "persist", { value: async () => true });
      Object.defineProperty(navigator, "storage", { configurable: true, value: storage });
    } catch (_) {}
    }
    const originalHash = params.get("__pd_hash") || "";
    params.delete("__pd_save");
    params.delete("__pd_hash");
    const remaining = params.toString();
    try {
      history.replaceState(null, "", location.pathname + location.search + (originalHash || remaining ? "#" + (originalHash || remaining) : ""));
    } catch (_) {
      location.hash = originalHash || remaining;
    }
  } catch (_) {}
})();
</script>`;

const GAME_INDEXEDDB_BOOTSTRAP = `<script>
/* ported-game-indexeddb-save-bridge */
(() => {
  const boot = window.__pdGameSaveBootstrap;
  if (!boot) return;
  const dbFile = name => /^[A-Za-z0-9_-]{1,64}$/.test(name) ? "idb-"+name+".json" : null;
  const dbs = new Map(), pending = new Map();
  const b64 = bytes => { let s = ""; const a = new Uint8Array(bytes); for (let i=0;i<a.length;i+=0x8000) s += String.fromCharCode(...a.subarray(i,i+0x8000)); return btoa(s); };
  const un64 = s => Uint8Array.from(atob(s), c => c.charCodeAt(0)).buffer;
  const encode = value => {
    if (value instanceof ArrayBuffer) return { __pdType: "ArrayBuffer", data: b64(value) };
    if (ArrayBuffer.isView(value)) return { __pdType: value.constructor.name, data: b64(value.buffer.slice(value.byteOffset,value.byteOffset+value.byteLength)) };
    if (Array.isArray(value)) return value.map(encode);
    if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).map(([k,v])=>[k,encode(v)]));
    return value;
  };
  const decode = value => {
    if (value && value.__pdType === "ArrayBuffer") return un64(value.data);
    if (value && value.__pdType && value.data) {
      const bytes = new Uint8Array(un64(value.data)), C = window[value.__pdType];
      return typeof C === "function" ? new C(bytes.buffer) : bytes;
    }
    if (Array.isArray(value)) return value.map(decode);
    if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).map(([k,v])=>[k,decode(v)]));
    return value;
  };
  const rpc = (operation, name, bytes) => new Promise((resolve,reject) => {
    const requestId = crypto.randomUUID();
    pending.set(requestId,{resolve,reject});
    const message = {source:"ported-game-indexeddb",version:1,gameId:boot.gameId,requestId,operation,name,bytes};
    try { if (bytes instanceof ArrayBuffer) parent.postMessage(message,"*",[bytes]); else parent.postMessage(message,"*"); }
    catch (error) { pending.delete(requestId); reject(error); }
  });
  addEventListener("message", event => {
    const d=event.data, p=d&&pending.get(d.requestId);
    if (event.source!==parent || !p || d.source!=="ported-game-indexeddb-response") return;
    pending.delete(d.requestId);
    if (d.ok) p.resolve(d.bytes || null);
    else p.reject(new DOMException(d.error||"Save storage unavailable",d.error==="NotFoundError"?"NotFoundError":"NotAllowedError"));
  });
  const emit = (request, error) => queueMicrotask(() => {
    if (error) { request.error=error; request.onerror&&request.onerror({target:request}); }
    else request.onsuccess&&request.onsuccess({target:request});
  });
  const persist = db => {
    const file=dbFile(db.name); if(!file) return Promise.reject(new DOMException("Unsupported database name","NotSupportedError"));
    const snapshot={version:db.version,stores:Object.fromEntries([...db.stores].map(([n,m])=>[n,[...m].map(([k,v])=>[k,encode(v)])]))};
    const bytes=new TextEncoder().encode(JSON.stringify(snapshot)).buffer;
    return rpc("write",file,bytes);
  };
  const makeStore=(db,name)=>({
    name,
    put(value,key) { const r={result:key}; const m=db.stores.get(name); m.set(String(key),structuredClone(value)); persist(db).then(()=>emit(r),e=>emit(r,e)); return r; },
    delete(key) { const r={result:undefined}; db.stores.get(name).delete(String(key)); persist(db).then(()=>emit(r),e=>emit(r,e)); return r; },
    clear() { const r={result:undefined}; db.stores.get(name).clear(); persist(db).then(()=>emit(r),e=>emit(r,e)); return r; },
    get(key) { const r={result:undefined}; r.result=structuredClone(db.stores.get(name).get(String(key))); emit(r); return r; },
    count() { const r={result:db.stores.get(name).size}; emit(r); return r; },
    getAll() { const r={result:[...db.stores.get(name).values()].map(v=>structuredClone(v))}; emit(r); return r; },
    getAllKeys() { const r={result:[...db.stores.get(name).keys()]}; emit(r); return r; },
    openCursor() {
      const r={result:null}, entries=[...db.stores.get(name)];
      let i=0;
      const next=()=>{ r.result=i<entries.length?{key:entries[i][0],primaryKey:entries[i][0],value:structuredClone(entries[i][1]),continue:()=>{i++;queueMicrotask(next);}}:null; emit(r); };
      queueMicrotask(next); return r;
    }
  });
  const open = (name, version) => {
    const req={result:null,error:null,onupgradeneeded:null,onsuccess:null,onerror:null};
    (async()=>{
      const file=dbFile(name); if (!file) throw new DOMException("Unsupported game database","NotSupportedError");
      let db=dbs.get(name);
      if (!db) {
        db={name,version:0,stores:new Map(),close(){}};
        try {
          const bytes=await rpc("read",file);
          if (bytes) {
            const saved=JSON.parse(new TextDecoder().decode(bytes));
            db.version=saved.version||0;
            for(const [store,rows] of Object.entries(saved.stores||{})) db.stores.set(store,new Map(rows.map(([k,v])=>[k,decode(v)])));
          }
        } catch(e) { if(e.name!=="NotFoundError") throw e; }
        db.objectStoreNames={contains:n=>db.stores.has(n),[Symbol.iterator]:function*(){yield* db.stores.keys();}};
        db.createObjectStore=n=>{if(db.stores.has(n)) throw new DOMException("Store exists","ConstraintError");db.stores.set(n,new Map());return makeStore(db,n);};
        db.deleteObjectStore=n=>db.stores.delete(n);
        db.transaction=(names)=>({objectStore:n=>{const key=typeof n==="string"?n:names[0];if(!db.stores.has(key))throw new DOMException("Missing store","NotFoundError");return makeStore(db,key);}});
        dbs.set(name,db);
      }
      const nextVersion=version||db.version||1;
      if(nextVersion>db.version){db.version=nextVersion;req.result=db;req.onupgradeneeded&&req.onupgradeneeded({target:req});await persist(db);}
      req.result=db; emit(req);
    })().catch(e=>emit(req,e));
    return req;
  };
  try {
    const factory={open,databases:async()=>[...dbs.keys()].map(name=>({name,version:dbs.get(name).version})),deleteDatabase:name=>{dbs.delete(name);return {onsuccess:null};}};
    Object.defineProperty(window,"indexedDB",{configurable:true,value:factory});
  } catch (_) {}
})();
</script>`;

const DELTARUNE_CONTENT_SECURITY_POLICY = GAME_CONTENT_SECURITY_POLICY.replace(
  "script-src 'self' 'unsafe-inline' 'unsafe-eval' 'wasm-unsafe-eval' blob:",
  "script-src 'self' 'unsafe-inline' 'unsafe-eval' 'wasm-unsafe-eval' blob: https://cdnjs.cloudflare.com https://mrdoob.github.io",
);

function gameContentSecurityPolicy(relativePath: string): string {
  return relativePath.replace(/\\/g, "/").startsWith("deltarune/")
    ? DELTARUNE_CONTENT_SECURITY_POLICY
    : GAME_CONTENT_SECURITY_POLICY;
}

const GAME_DIAGNOSTIC_BOOTSTRAP = `<script>
(() => {
  const report = (type, detail) => {
    try {
      parent.postMessage({
        source: "ported-game-diagnostics",
        version: 1,
        type,
        detail: String(detail || "No additional details").slice(0, 500)
      }, "*");
    } catch (_) {}
  };
  const isSecurityError = error =>
    error?.name === "SecurityError" || /permission policy|not allowed|insecure operation|securityerror/i.test(String(error?.message || error));
  addEventListener("error", event => {
    const target = event.target;
    if (target && target !== window) {
      const resource = target.src || target.href || target.currentSrc || target.tagName || "unknown resource";
      report("resource-error", resource + (event.message ? ": " + event.message : ""));
      return;
    }
    const message = event.message || "Game script failed";
    report(isSecurityError(event.error || message) ? "permission-error" : "runtime-error", message);
  }, true);
  addEventListener("unhandledrejection", event => {
    const error = event.reason;
    report(isSecurityError(error) ? "permission-error" : "async-error", error?.stack || error?.message || error);
  });
  addEventListener("securitypolicyviolation", event => {
    report("policy-error", event.violatedDirective + " blocked " + (event.blockedURI || "a resource"));
  });
  for (const key of ["localStorage", "sessionStorage"]) {
    const getter = Object.getOwnPropertyDescriptor(Window.prototype, key)?.get;
    if (!getter) continue;
    try {
      Object.defineProperty(window, key, {
        configurable: true,
        get() {
          try {
            return getter.call(window);
          } catch (error) {
            report("permission-error", key + ": " + (error?.message || error));
            throw error;
          }
        }
      });
    } catch (_) {}
  }
  const originalGetGamepads = Navigator.prototype.getGamepads;
  if (typeof originalGetGamepads === "function") {
    try {
      Navigator.prototype.getGamepads = function(...args) {
        try {
          return originalGetGamepads.apply(this, args);
        } catch (error) {
          report("permission-error", "Gamepad access: " + (error?.message || error));
          throw error;
        }
      };
    } catch (_) {}
  }
  const originalCacheOpen = window.caches?.open;
  if (typeof originalCacheOpen === "function") {
    try {
      window.caches.open = function(...args) {
        let result;
        try {
          result = originalCacheOpen.apply(this, args);
        } catch (error) {
          report("permission-error", "CacheStorage: " + (error?.message || error));
          throw error;
        }
        return Promise.resolve(result).catch(error => {
          if (isSecurityError(error)) report("permission-error", "CacheStorage: " + (error?.message || error));
          throw error;
        });
      };
    } catch (_) {}
  }
  const originalFetch = window.fetch.bind(window);
  window.fetch = (...args) => {
    const requestedUrl = args[0]?.url || String(args[0] || "unknown request");
    return originalFetch(...args).then(response => {
      if (!response.ok) report("request-error", "HTTP " + response.status + " for " + response.url);
      return response;
    }, error => {
      report(isSecurityError(error) ? "permission-error" : "request-error", requestedUrl + ": " + (error?.message || error));
      throw error;
    });
  };
  const xhrOpen = XMLHttpRequest.prototype.open;
  const xhrSend = XMLHttpRequest.prototype.send;
  XMLHttpRequest.prototype.open = function(method, url, ...args) {
    this.__portedGameUrl = String(url);
    return xhrOpen.call(this, method, url, ...args);
  };
  XMLHttpRequest.prototype.send = function(...args) {
    this.addEventListener("loadend", () => {
      if (this.status === 0 || this.status >= 400) {
        report("request-error", "HTTP " + this.status + " for " + (this.__portedGameUrl || "unknown request"));
      }
    }, { once: true });
    return xhrSend.apply(this, args);
  };
})();
</script>`;

function instrumentGameHtml(html: string): string {
  let instrumented = html;
  const headOpen = /<head\b[^>]*>/i;
  const bodyOpen = /<body\b[^>]*>/i;
  const inject = (source: string) => {
    if (headOpen.test(instrumented)) instrumented = instrumented.replace(headOpen, match => `${match}${source}`);
    else if (bodyOpen.test(instrumented)) instrumented = instrumented.replace(bodyOpen, match => `${match}${source}`);
    else instrumented = `${source}${instrumented}`;
  };
  if (!instrumented.includes('source: "ported-game-diagnostics"')) inject(GAME_DIAGNOSTIC_BOOTSTRAP);
  if (!instrumented.includes("ported-game-save-bridge")) {
    if (/<\/head>/i.test(instrumented)) {
      instrumented = instrumented.replace(/<\/head>/i, `${GAME_SAVE_BOOTSTRAP}</head>`);
    } else inject(GAME_SAVE_BOOTSTRAP);
  }
  if (!instrumented.includes("ported-game-indexeddb-save-bridge")) {
    if (/<\/head>/i.test(instrumented)) {
      instrumented = instrumented.replace(/<\/head>/i, `${GAME_INDEXEDDB_BOOTSTRAP}</head>`);
    } else inject(GAME_INDEXEDDB_BOOTSTRAP);
  }
  return instrumented;
}

export function shouldServePortedGameRequest(
  hostname: string,
  pathname: string,
): boolean {
  const isLegacyGameHost = hostname.toLowerCase().startsWith("games.");
  const isGameAssetPath =
    pathname === "/ported-games" || pathname.startsWith("/ported-games/");

  return isLegacyGameHost || isGameAssetPath;
}

export function createPortedGameAssetsRouter(
  assetDirectory: string,
  options: {
    gameDataDirectory?: string;
    isGameApproved?: (gameId: string) => Promise<boolean>;
  } = {},
): Router {
  const router = express.Router();
  const resolvedAssetDirectory = path.resolve(assetDirectory);
  const gameDataDirectory = path.resolve(options.gameDataDirectory ?? GAME_PORT_DATA_ROOT);

  router.use("/ported-games", async (request, response, next) => {
    if (!/\.html?$/i.test(request.path)) return next();
    let relativePath: string;
    try {
      relativePath = decodeURIComponent(request.path).replace(/^\/+/, "");
    } catch {
      return response.status(400).type("text/plain").send("Invalid game path");
    }
    const filePath = path.resolve(resolvedAssetDirectory, relativePath);
    if (!filePath.startsWith(`${resolvedAssetDirectory}${path.sep}`)) {
      return response.status(404).type("text/plain").send("Game asset not found");
    }
    try {
      const html = await readFile(filePath, "utf8");
      response.setHeader("X-Content-Type-Options", "nosniff");
      response.setHeader("Access-Control-Allow-Origin", "*");
      response.setHeader("Cache-Control", "no-store");
      response.setHeader("Content-Security-Policy", gameContentSecurityPolicy(relativePath));
      return response.type("html").send(instrumentGameHtml(html));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return next();
      return next(error);
    }
  });

  router.use("/ported-games/hill-climb-racing", async (request, response, next) => {
    const assetName = request.path.replace(/^\/+/, "");
    if (
      !["hcr.wasm", "hcr.data", "image.bin"].includes(assetName) ||
      (request.method !== "GET" && request.method !== "HEAD")
    ) return next();

    const gameDirectory = path.join(resolvedAssetDirectory, "hill-climb-racing");
    const assembledFile = path.join(gameDirectory, assetName);
    try {
      await stat(assembledFile);
      return next();
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") return next(error);
    }

    try {
      const partPattern = new RegExp(`^${assetName.replace(".", "\\.")}\\.part(\\d+)$`);
      const partNumbers = (await readdir(gameDirectory))
        .map(name => ({ name, match: partPattern.exec(name) }))
        .filter((entry): entry is { name: string; match: RegExpExecArray } => entry.match !== null)
        .map(entry => ({ name: entry.name, number: Number(entry.match[1]) }))
        .sort((left, right) => left.number - right.number);
      if (partNumbers.length === 0) return next();

      for (let index = 0; index < partNumbers.length; index += 1) {
        if (partNumbers[index].number !== index + 1) {
          return response.status(503).type("text/plain").send(
            `Incomplete Hill Climb Racing asset ${assetName}: missing chunk ${index + 1}`,
          );
        }
      }

      const parts = partNumbers.map(part => path.join(gameDirectory, part.name));
      const sizes = await Promise.all(parts.map(async file => (await stat(file)).size));
      response.status(200);
      response.setHeader(
        "Content-Type",
        assetName === "hcr.wasm" ? "application/wasm" : "application/octet-stream",
      );
      response.setHeader("Content-Length", String(sizes.reduce((sum, size) => sum + size, 0)));
      response.setHeader("Access-Control-Allow-Origin", "*");
      response.setHeader("X-Content-Type-Options", "nosniff");
      response.setHeader("Cache-Control", "public, max-age=3600");
      if (request.method === "HEAD") return response.end();

      const joinedParts = Readable.from((async function* () {
        for (const file of parts) {
          for await (const chunk of createReadStream(file)) yield chunk;
        }
      })());
      await pipeline(joinedParts, response);
      return;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return next();
      if (response.headersSent) return response.destroy(error as Error);
      return next(error);
    }
  });

  router.use(
    "/ported-games",
    express.static(assetDirectory, {
      dotfiles: "deny",
      fallthrough: true,
      setHeaders(response, filePath) {
        response.setHeader("X-Content-Type-Options", "nosniff");
        // Sandboxed game frames have an opaque origin. These public, static
        // assets can be fetched without credentials from that origin.
        response.setHeader("Access-Control-Allow-Origin", "*");

        if (filePath.endsWith("asset-manifest.json")) {
          response.setHeader("Cache-Control", "no-store");
        } else if (filePath.endsWith(".html")) {
          // Keep direct navigation sandboxed too; the iframe sandbox attribute
          // is defense in depth. In particular, never grant same-origin access.
          response.setHeader(
            "Content-Security-Policy",
            gameContentSecurityPolicy(path.relative(resolvedAssetDirectory, filePath)),
          );
        }
      },
    }),
  );

  router.use("/ported-games", async (request, response, next) => {
    if (request.method !== "GET" && request.method !== "HEAD") return next();
    let parts: string[];
    try {
      parts = decodeURIComponent(request.path).split("/").filter(Boolean);
    } catch {
      return response.status(400).type("text/plain").send("Invalid game path");
    }
    if (parts.length < 2) return next();
    const [assetId, ...pathParts] = parts;
    const game = GAME_PORT_DATA_CATALOG.find(item => item.assetId === assetId);
    const relativePath = safeGameDataPath(pathParts.join("/"));
    if (!game || !relativePath || !options.isGameApproved) return next();
    if (!await options.isGameApproved(game.id)) return next();

    const filePath = path.resolve(gameDataDirectory, game.assetId, ...relativePath.split("/"));
    if (!filePath.startsWith(`${path.resolve(gameDataDirectory, game.assetId)}${path.sep}`)) return next();
    try {
      const info = await lstat(filePath);
      if (!info.isFile() || info.isSymbolicLink()) return next();
      response.status(200).set({
        "Content-Type": "application/octet-stream",
        "Content-Length": String(info.size),
        "Access-Control-Allow-Origin": "*",
        "X-Content-Type-Options": "nosniff",
        "Cache-Control": "public, max-age=3600",
      });
      if (request.method === "HEAD") return response.end();
      await pipeline(createReadStream(filePath), response);
      return;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return next();
      if (response.headersSent) return response.destroy(error as Error);
      return next(error);
    }
  });

  router.use((_request, response) => {
    response.status(404).type("text/plain").send("Game asset not found");
  });

  return router;
}
