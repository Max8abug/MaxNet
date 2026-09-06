---
name: Shifted hover submenus
description: Interaction constraint for cascading menus whose submenus move away from their anchor rows
---

When a cascading submenu is shifted upward to stay within the viewport, pointer travel can cross sibling category rows or re-enter the open category. Hover handlers must not replace or reset the active submenu during that travel; item activation should occur before hover cleanup can dismiss it.

**Why:** A visually correct submenu can still be unclickable if viewport correction changes the pointer path through the parent menu.

**How to apply:** Keep the submenu in the same interaction tree, ignore hover changes for the already-open category, suppress sibling hover changes while the submenu is shifted, and activate items on pointer-down as well as keyboard input.