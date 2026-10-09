---
name: Eaglercraft launch configuration
description: Why launch settings are applied outside the oversized bundled game, and the startup timing constraint.
---

Leave the bundled game payload intact when making small launch-setting changes. Apply settings through the same-origin launcher before the game starts.

**Why:** The self-contained game exceeds the editing tool's 16 MiB patch limit. Reconstructing or duplicating the payload just to change settings risks damaging the game and increases browser memory usage.

**How to apply:** The current client gates main behind a countdown started on window load, so the parent iframe load handler can configure it before launch. Verify that this gate still exists before replacing the bundled client; an immediately starting client would need an earlier configuration hook. Preserve existing worlds and unrelated launch options.
