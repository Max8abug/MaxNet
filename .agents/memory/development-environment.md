---
name: Development environment dependency state
description: Notes workspace dependency links, composite type declarations, and browser verification quirks.
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

With pnpm, bundling a parent SDK while externalizing its provider dependency can cause
a runtime module-not-found error even when that dependency is correctly installed.

**Why:** The generated API bundle resolves the external import relative to its output
directory, outside the parent package's nested dependency links.

**How to apply:** Inspect bundler externalization before adding redundant direct
dependencies. Keep a provider-backed SDK external as a unit when it relies on its
own nested dependency resolution.

Rebuild a composite shared library's declarations after changing its exports or schema before checking a consuming application in isolation.

**Why:** An API-only no-emit check continued reporting that a newly added database field did not exist, despite correct source and runtime exports. Rebuilding the shared database project resolved the stale declaration errors without application changes.

**How to apply:** When source and consuming types disagree, check referenced-library build state before editing the application to work around the error. An isolated app type check does not rebuild its project references.

Self-hosted installs must use the repository's pinned pnpm version and validate
the frozen lockfile before stopping services. A lockfile configuration mismatch
does not necessarily mean the canonical lockfile is broken.

**Why:** Older pnpm versions can ignore override settings in
`pnpm-workspace.yaml`, even when the same frozen lock validates with the supported
installer. Regenerating the lock with incompatible tooling can remove platform
and security overrides and create another dirty-worktree update conflict.

**How to apply:** Check the client's actual pnpm version against `packageManager`
first. Do not use `--no-frozen-lockfile` as a compatibility workaround. Keep a
config/manifest-only preflight ahead of service shutdown.