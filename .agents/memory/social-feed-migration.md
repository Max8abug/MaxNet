---
name: Social feed migration scope
description: Preserve the standalone drawing app while moving legacy My Page artwork into social profiles.
---

The standalone Drawpad app and its saved drawings must remain available. Only the artwork stored in the old My Page draw/image pad is migrated into that account's first social post. Keep the legacy My Page record intact during migration so a failed conversion cannot destroy user work.

**Why:** The user explicitly distinguished the shared Drawpad from the old per-user My Page canvas and asked not to remove the standalone Drawpad or drawings.

**How to apply:** When changing social profiles or cleaning up legacy page data, do not delete the `drawings` records; migrate My Page data idempotently and retain its source until the resulting post is confirmed.
