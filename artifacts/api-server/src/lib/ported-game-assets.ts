import express, { type Router } from "express";
import { createReadStream } from "node:fs";
import { readFile, readdir, stat } from "node:fs/promises";
import path from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";

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
  if (html.includes('source: "ported-game-diagnostics"')) return html;
  const headOpen = /<head\b[^>]*>/i;
  if (headOpen.test(html)) return html.replace(headOpen, match => `${match}${GAME_DIAGNOSTIC_BOOTSTRAP}`);
  const bodyOpen = /<body\b[^>]*>/i;
  if (bodyOpen.test(html)) return html.replace(bodyOpen, match => `${match}${GAME_DIAGNOSTIC_BOOTSTRAP}`);
  return `${GAME_DIAGNOSTIC_BOOTSTRAP}${html}`;
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

export function createPortedGameAssetsRouter(assetDirectory: string): Router {
  const router = express.Router();
  const resolvedAssetDirectory = path.resolve(assetDirectory);

  router.use("/ported-games", async (request, response, next) => {
    if (!request.path.toLowerCase().endsWith(".html")) return next();
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

  router.use((_request, response) => {
    response.status(404).type("text/plain").send("Game asset not found");
  });

  return router;
}
