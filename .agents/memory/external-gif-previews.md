---
name: External GIF previews
description: Why external GIF attachment previews need the same resolution boundary as saved messages.
---

Treat provider share pages and actual image URLs as distinct inputs. Resolve the provider link and confirm browser image loading before accepting a draft attachment.

**Why:** The owner repeatedly reported blank Tenor attachments after send-time resolution had been added. The earlier fix left the Add GIF preview pointing at HTML, and some website links ending in .gif still redirect to share pages.

**How to apply:** Verify preview, sending, saved-message display, and failure feedback together when changing GIF handling. Never infer an image solely from a website link's suffix; distinguish provider website URLs from its media CDN.

Tenor's numeric GIF ID determines the content; an incorrect descriptive URL slug can still resolve to a different, valid GIF.

**Why:** A misleadingly named test link produced a false content-mismatch report even though the displayed image matched Tenor's canonical page and image metadata.

**How to apply:** Use provider canonical URLs for test fixtures and compare resolved images against provider metadata, not the wording of a guessed slug.
