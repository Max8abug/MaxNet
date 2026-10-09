---
name: Path-based game hosting
description: User-approved same-domain path and isolation requirements for hosted game ports.
---

Serve self-hosted game ports under `/ported-games/` on the main site origin rather than requiring a separate `games.` hostname. Keep the game documents sandboxed without `allow-same-origin`; preserve the public static-only route before session and API middleware. Some games may lose browser-storage-based saves under this isolation.

**Why:** The public HTTPS endpoint for the separate game hostname had no matching certificate or route. The user chose same-site path hosting and explicitly asked to sandbox game content.

**How to apply:** When changing game hosting, keep the route on the main site's HTTPS origin, maintain iframe and response-level sandboxing, and avoid granting the game access to account-site storage or APIs to restore compatibility. Verify actual port behavior after updates because browser storage and input features can vary by game.
