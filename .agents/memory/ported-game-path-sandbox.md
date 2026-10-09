---
name: Path-based game hosting
description: User-approved same-domain path and isolation requirements for hosted game ports.
---

Serve self-hosted game ports under `/ported-games/` on the main site origin rather than requiring a separate `games.` hostname. Keep the game documents sandboxed without `allow-same-origin`; preserve the public static-only route before session and API middleware. Some games may lose browser-storage-based saves under this isolation. Treat CacheStorage as optional and fall back to fetched in-memory blobs. For gamepad-based ports, delegate `gamepad *` to the opaque sandboxed frame; the default `self` allowlist does not include its sandboxed origin.

**Why:** The public HTTPS endpoint for the separate game hostname had no matching certificate or route. The user chose same-site path hosting and explicitly asked to sandbox game content. Undertale's console showed `getGamepads()` denied by Permissions Policy until gamepad was delegated to the opaque frame; PvZ's startup failed when `caches.open()` threw `Operation is insecure` in the same opaque-origin sandbox.

**How to apply:** When changing game hosting, keep the route on the main site's HTTPS origin, maintain iframe and response-level sandboxing, and avoid granting the game access to account-site storage or APIs to restore compatibility. Make optional caches fail open to network-loaded blobs, delegate only required browser features explicitly (for example, gamepad to the frame), and verify actual port behavior after updates because storage and input needs vary by game.
