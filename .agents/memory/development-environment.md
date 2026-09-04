---
name: Development environment dependency state
description: Notes workspace dependency and browser verification quirks that can affect local checks.
---

The API package can have a dependency recorded in its package manifest and lockfile while its local pnpm links are incomplete; a clean workspace install may be required before restarting the API workflow.

**Why:** The API only revealed the missing package when the workflow was restarted, even though the source and lockfile already declared it.

**How to apply:** If an API restart fails with a module-not-found error for an already-declared package, restore the workspace install before changing application code or dependency versions.

Headless Chromium viewport checks may require temporary Nix graphics libraries. Installing
them can add a packages entry to `.replit`; restore that environment file after the check
if those libraries are not intended as project configuration.

**Why:** The browser runner could not start until its shared libraries were available, and
the environment installer persisted its package list in the project config.

**How to apply:** For local-only browser verification, use the environment package tooling,
then compare `git status` and remove unintended `.replit` changes before completing the task.