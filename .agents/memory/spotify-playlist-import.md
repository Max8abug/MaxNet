---
name: Spotify playlist import scope
description: Initial Spotify playlist import access scope and production credential handling.
---

The initial importer supports public Spotify playlists only. Do not add per-user Spotify authorization or private playlist access unless the owner changes this scope.

**Why:** The owner chose public-only imports for v1.

**How to apply:** Keep Spotify and YouTube credentials on the server. The owner self-hosts production, so Replit secrets alone do not configure the live site.
