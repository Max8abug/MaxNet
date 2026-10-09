---
name: Personal playlist scope
description: Local-only personal music playback and the constraints of YouTube embedding.
---

Personal playlists are private saved libraries. Playback must remain on the user's device and must never update shared-room playback or start audio for other users.

**Why:** The owner explicitly requested saved playlists that play “on that users side only”; this is distinct from the site's shared music and YouTube rooms.

**How to apply:** Keep personal playback commands separate from synchronized-room commands, including future player integrations and notification actions.

YouTube playback uses the official, visible embedded player. Do not extract or proxy audio or present decorative bars as a genuine audio spectrum.

**Why:** YouTube embeds do not expose their audio stream to Web Audio analysis, and audio-only extraction is not an appropriate substitute for supported embedding.

**How to apply:** Preserve the visible player and its controls. Label any playback animation honestly and handle unavailable videos and autoplay restrictions explicitly.
