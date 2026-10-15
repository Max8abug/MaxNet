---
name: Sladenator bot posting
description: The Network bot's source and requested timing for photos from sladenator.org.
---

The bot uses the public photo collection on sladenator.org. Newly detected photos should be posted promptly with `#new`; existing photos should be rolled out randomly over the first week, then one random older photo daily after a week without new uploads.

**Why:** The user explicitly requested both automatic new-photo posting and an ongoing fallback cadence so the bot remains active when the source is quiet.

**How to apply:** Preserve the `#new` tag for newly detected photos and this cadence when changing the Network bot, its source integration, or its scheduler; avoid posting a backlog all at once.
