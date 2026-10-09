---
name: Feature archive scope
description: Menu-only archiving semantics and why administration must remain accessible.
---

Feature archiving is site-wide menu visibility, not uninstallation, data deletion, or a permission toggle. Keep existing windows, saved data, and underlying feature behavior intact.

**Why:** The owner asked for old features to disappear from the Start menu until unarchived. Blocking existing windows or deleting feature data would exceed that reversible request.

**How to apply:** Hide archived launch entries, including duplicate pinned shortcuts, from desktop Start and the mobile web launcher. Do not reinterpret the archive flag as an API authorization restriction.

Keep archive drift checks scoped to the Start menu and mobile web launcher.
Taskbar presence/unread chips, notification actions, and minimized-window restore
buttons are outside that menu-only boundary.

**Why:** Treating every button that opens or restores a window as an archive
launcher would silently broaden archiving into disabling existing access paths.

**How to apply:** Check duplicate shortcuts within the Start menu, but do not
filter taskbar window restoration or notification delivery by archive state.

Administration and settings controls remain unarchivable.

**Why:** Administrators must always retain a way to restore hidden features and manage site access.

**How to apply:** Keep archive management and other administration launch entries outside the archivable feature catalog and enforce this boundary on the server as well as the UI.

Keep frequent archive visibility refreshes independent from branding refreshes.
Archive cache validators should depend on visibility, not unrelated theme changes.

**Why:** Uploaded branding images can make the full public settings response very
large. Building or transferring that response every time menus check visibility
adds avoidable work per visitor, even with conditional responses.

**How to apply:** Poll only archive state; retain full settings loads for startup,
focus and settings editing. Do not use a branding change to invalidate an otherwise
unchanged archive snapshot.
