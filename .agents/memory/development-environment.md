---
name: Development environment dependency state
description: Notes a workspace dependency-install quirk encountered while restarting the API.
---

The API package can have a dependency recorded in its package manifest and lockfile while its local pnpm links are incomplete; a clean workspace install may be required before restarting the API workflow.

**Why:** The API only revealed the missing package when the workflow was restarted, even though the source and lockfile already declared it.

**How to apply:** If an API restart fails with a module-not-found error for an already-declared package, restore the workspace install before changing application code or dependency versions.