---
name: Unattended backup safeguards
description: Why scheduled backup crash locks require owner review and encryption uses public recipients.
---

Do not automatically expire a scheduled-backup destination lock based on age.
Require the operator to confirm no backup process is running before removing a
crash-left lock.

**Why:** Export duration varies with site size and storage speed. An arbitrary
expiry could permit overlapping publication/retention during a legitimate
long-running backup; a visible failed schedule is safer than deleting recovery
copies concurrently.

**How to apply:** Preserve fail-visible overlap behavior when adding scheduling,
status monitoring, or remote destinations. If automatic recovery is introduced,
require reliable process ownership/liveness evidence, not elapsed time alone.

Unattended encryption should need only a public recipient; the recovery private
key belongs off the server.

**Why:** A server compromise should not provide both encrypted backups and their
decryption key. Automated jobs must not prompt for or save private passphrases.

**How to apply:** Keep future scheduled encryption options public-key based, and
document that recovery-key loss makes encrypted backups unrecoverable.
