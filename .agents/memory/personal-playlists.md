---
name: Personal playlist scope
description: Local-only personal music playback and the constraints of YouTube embedding.
---

Personal playlists are private saved libraries. Playback must remain on the user's device and must never update shared-room playback or start audio for other users.

**Why:** The owner explicitly requested saved playlists that play “on that users side only”; this is distinct from the site's shared music and YouTube rooms.

**How to apply:** Keep personal playback commands separate from synchronized-room commands, including future player integrations and notification actions.

Shuffle changes the local playback queue, not the user's saved track ordering. Without a repeat option, automatic playback still stops after one pass.

**Why:** Saved libraries may be deliberately ordered; a playback control should not destroy that order or silently introduce repeat playback.

**How to apply:** Keep shuffle/history device-local, preserve normal ordering when shuffle is turned off, and handle library additions/removals without playing deleted entries.

YouTube playback uses the official, visible embedded player. Its viewport must stay at least 200 × 200 px. Do not hide it during playback, separate or extract audio, proxy media, or present decorative bars as a genuine audio spectrum.

**Why:** YouTube's current developer policies prohibit hidden background playback and separating a video's audio from its video; its minimum-functionality requirements set a 200 × 200 px player viewport. The owner wants the visible player to shrink as much as those rules allow.

**How to apply:** Keep the official player and controls visible and unobscured, and never size its viewport below 200 × 200 px. Label any playback animation honestly and handle unavailable videos and autoplay restrictions explicitly.
