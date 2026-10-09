---
name: NewCP hosted game
description: Distinguishes NewCP desktop-wrapper source, the hosted browser game, and the limits of embed verification.
---

Use NewCP's hosted browser game rather than treating its public GitHub organization as self-hostable game source.

**Why:** The owner linked the New-Club-Penguin organization to request an embedded game. Its NewCP-App repository describes an Electron desktop wrapper, not the full game or server. The official hosted browser page is a separate service.

**How to apply:** Keep NewCP accounts and authentication on its own origin. Do not copy game assets, proxy authentication, or assume the wrapper's source license covers the hosted game's assets.

Verify the live runtime rather than assuming NewCP's HTML5 announcement means the game is entirely native HTML5.

**Why:** On 2026-10-08, the hosted embed rendered its login interface while reporting Ruffle canvas rendering and SWF loading, despite the official browser-migration announcement.

**How to apply:** Recheck upstream behavior when changing compatibility or hosting. A rendered login screen establishes iframe display, not successful account sign-in or gameplay. Keep an external-tab alternative for browser storage or upstream framing restrictions.
