import express, { type Router } from "express";
import { readFile } from "node:fs/promises";
import path from "node:path";

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
  const originalFetch = window.fetch.bind(window);
  window.fetch = (...args) => originalFetch(...args).then(response => {
    if (!response.ok) report("request-error", "HTTP " + response.status + " for " + response.url);
    return response;
  }, error => {
    report(isSecurityError(error) ? "permission-error" : "request-error", error?.message || error);
    throw error;
  });
})();
</script>`;

function instrumentGameHtml(html: string): string {
  if (html.includes('source: "ported-game-diagnostics"')) return html;
  const headClose = /<\/head\s*>/i;
  if (headClose.test(html)) return html.replace(headClose, `${GAME_DIAGNOSTIC_BOOTSTRAP}</head>`);
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
      response.setHeader("Content-Security-Policy", GAME_CONTENT_SECURITY_POLICY);
      return response.type("html").send(instrumentGameHtml(html));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return next();
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
            GAME_CONTENT_SECURITY_POLICY,
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
