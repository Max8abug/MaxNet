---
name: Feature archive scope
description: Menu-only archiving semantics and why administration must remain accessible.
---

Feature archiving is site-wide menu visibility, not uninstallation, data deletion, or a permission toggle. Keep existing windows, saved data, and underlying feature behavior intact.

**Why:** The owner asked for old features to disappear from the Start menu until unarchived. Blocking existing windows or deleting feature data would exceed that reversible request.

**How to apply:** Hide archived launch entries, including duplicate pinned shortcuts, from desktop Start and the mobile web launcher. Do not reinterpret the archive flag as an API authorization restriction.

Administration and settings controls remain unarchivable.

**Why:** Administrators must always retain a way to restore hidden features and manage site access.

**How to apply:** Keep archive management and other administration launch entries outside the archivable feature catalog and enforce this boundary on the server as well as the UI.
