---
name: Path-based game hosting
description: User-approved same-domain path and isolation requirements for hosted game ports.
---

Serve self-hosted game ports under `/ported-games/` on the main site origin rather than requiring a separate `games.` hostname. Keep game documents sandboxed without `allow-same-origin`; preserve the public static-only route before session and API middleware. Bridge localStorage and IndexedDB privately; cache file-based saves in the parent page's IndexedDB for guests and sync them to per-account server storage when signed in. Use narrow adapters for special formats such as Stardew's OPFS archives. Treat CacheStorage as optional and fall back to fetched in-memory blobs. For gamepad-based ports, delegate `gamepad *` to the opaque sandboxed frame; the default `self` allowlist does not include its sandboxed origin.

**Why:** The public HTTPS endpoint for the separate game hostname had no matching certificate or route. The user chose same-site path hosting and explicitly asked to sandbox game content. Undertale's console showed `getGamepads()` denied by Permissions Policy until gamepad was delegated to the opaque frame; PvZ's startup failed when `caches.open()` threw `Operation is insecure` in the same opaque-origin sandbox.

Open games in a new tab through the signed-in app's standalone game window, not by navigating directly to the raw game document. The standalone app remains the parent of the sandboxed iframe and can receive and persist save messages; direct navigation has no app-side save broker.

**Why:** A raw game tab has no MaxNet parent component to consume save-bridge messages, so its save shim is only in-memory. A standalone app window preserves both origin isolation and the existing account/device save flow.

**How to apply:** When changing game hosting, keep the route on the main site's HTTPS origin, maintain iframe and response-level sandboxing, and avoid granting the game access to account-site storage or APIs to restore compatibility. Give games only a narrow save bridge, keep saves private per account, cache file saves locally for guests, make optional caches fail open to network-loaded blobs, delegate only required browser features explicitly, and verify actual port behavior after updates because storage and input needs vary by game. IndexedDB open events must be asynchronous, and cursor transactions must stay active through every `continue()` until the terminal null result; premature completion can overlap Emscripten `FS.syncfs` and lose saves.
