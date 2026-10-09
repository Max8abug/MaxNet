# Feature archive registry

This package contains only browser-safe data and pure archive-ID helpers. Do not
add database, server, environment, or secret imports/dependencies.

To add an archivable feature:

1. Keep its persisted `WindowType` ID stable and register its ID, name, and
   category in `ARCHIVABLE_FEATURES`. This automatically adds it to the archive
   panel and server validation.
2. Add its desktop menu entry with a matching `feature` ID, and its mobile web
   `APPS` entry with the same `type`. Guard any duplicate pinned shortcuts too.
3. Run `pnpm test:feature-registry` (also part of root typecheck/build). This checks
   launcher coverage, action-target matching, pinned shortcuts, and saved IDs.

`PROTECTED_LAUNCHER_IDS` is reserved for administration/settings. Public features
must not use it to avoid registering an archive ID. Desktop non-window actions
(reset and notification permission) explicitly use `protected: true`.
Contextual photo/gallery/user-page windows do not appear in the site launchers.

Archive flags must only filter launch entries. Never use them to authorize API
requests, delete content, change saved desktop state, or close existing windows.
