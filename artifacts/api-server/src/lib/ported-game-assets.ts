import express, { type Router } from "express";

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
