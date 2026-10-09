---
name: Backup restore test isolation
description: Destructive backup tests need isolation at the database boundary, not just disposable rows.
---

Full-site restore verification must use a disposable database or private
PostgreSQL cluster, including any browser-driven restore. A temporary admin,
wiki page, or upload in the configured database is not sufficient isolation.

**Why:** Site restore replaces entire tables. Even a backup containing only
generated test identities would erase unrelated users and content if restored
into the normal development or production database.

**How to apply:** Match test isolation to the mutation boundary. Keep browser
restore tests on an isolated API/database harness, and never point a restore
test at the normal app merely because its selected backup contains test data.

Use transactional sequence restarts for an atomic restore, not `setval`.

**Why:** PostgreSQL `setval` changes survive rollback. A late restore failure can
therefore retain original rows but leave their ID sequence behind those rows,
causing collisions on subsequent inserts.

**How to apply:** Use `ALTER SEQUENCE ... RESTART WITH ...` inside the replacement
transaction. Include a failure after one successful sequence reset in disposable
restore checks, and verify both live rows and the next generated ID.
