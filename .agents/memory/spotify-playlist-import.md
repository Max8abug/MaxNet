---
name: Spotify playlist import scope
description: Initial Spotify playlist import access scope and production credential handling.
---

The initial importer supports public Spotify playlists only. Do not add per-user Spotify authorization or private playlist access unless the owner changes this scope.

Launcher-managed Spotify and YouTube keys belong in the ignored `selfhost/.env`; setup rewrites and code updates must preserve them.

**Why:** The owner chose public-only imports for v1 and explicitly asked for launcher API key settings to survive future updates.

**How to apply:** Keep credentials server-side in the ignored `.env`, mask them in the launcher, and never put real values in tracked templates. The owner self-hosts production, so Replit secrets alone do not configure the live site.
