---
name: Theme Lab scope
description: Owner-approved isolation boundary for experimental window themes and fonts.
---

Experimental themes and font choices belong inside an admin-only Theme Lab preview. Windows XP light/dark, Windows Vista light/dark, Gold picture frame, and Silver picture frame are explicit exceptions approved as regular, user-selectable themes; other experimental styles remain isolated.

**Why:** The owner chose an isolated Theme Lab, then separately approved its XP light/dark, Vista, and Gold frame demos as public theme choices, followed by Silver as a counterpart to Gold and a dark version of Vista.

**How to apply:** Keep unapproved preview styles, typography, and interactions local to the admin-only lab. XP, Vista, Gold frame, and Silver frame can be offered through ordinary user display preferences; other themes still require a separate request.

Permanent display themes are account-wide preferences covering the desktop, all app windows, and the launcher—not individual-window selections. Guest preferences may remain browser-local; Theme Lab selections remain isolated previews.

**Why:** The owner explicitly reported browser/window-local theme behavior as a bug and requested account-wide synchronization.

**How to apply:** Keep permanent theme selection in ordinary Profile/Settings controls. Verify signed-in preferences in an independent browser session and after reload, while preserving guest/account separation.

Validate promoted lab themes on the actual desktop, not just the preview.

**Why:** Neither the static lab demo nor an opened Start-menu screenshot exposed all regressions: global window skin rules can also clip nested menus and prevent launching apps.

**How to apply:** Check dragging, window positioning, menu/button geometry, actual pointer travel into each submenu, and item activation in every promoted theme. Keep menu skins independent of window-content clipping and thick decorative rails. Decoration styles must not replace the layout rules owned by desktop windows and launchers.

Keep viewport-level settings dialogs outside themed window/taskbar containers, and bound their outer geometry independently of their content.

**Why:** Aero backdrop filters create containing blocks for fixed descendants; a dialog nested under a filtered taskbar can become anchored to its 40px area. Unbounded settings also prevent users from reaching the controls needed to leave a larger theme. Responsive launcher replacement must not discard an open settings form.

**How to apply:** Portal viewport dialogs to the document body and keep their ownership outside responsive launcher branches. Avoid backdrop filters on containers that own fixed overlays. Verify inner scrolling, unsaved-form preservation across breakpoints, and accessible theme controls at short heights, after resizing, and while changing themes with the dialog open.
