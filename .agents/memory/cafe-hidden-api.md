---
name: Cafe UI/API separation
description: Keep Cafe unavailable from user launchers without disabling its service endpoints.
---

Cafe must remain hidden from desktop and mobile launchers, existing window lists, and the feature archive panel, while its API routes stay enabled for other apps that depend on them.

**Why:** The owner reported that disabling Cafe's API also broke multiple other apps.

**How to apply:** Keep launcher visibility separate from API availability. Preserve Cafe's database schema and auth checks; do not use the launcher-hidden flag as an API authorization restriction.
