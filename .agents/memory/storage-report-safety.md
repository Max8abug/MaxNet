---
name: Storage inventory safety
description: Conservative safety rules for read-only legacy upload reports.
---

Acquire the shared file-mutation namespace exclusively before taking the
reference snapshot. Use READ COMMITTED explicitly, then read references only
after acquisition; fail without waiting if a writer holds the lock.

**Why:** A repeatable-read snapshot established by the lock query can precede
metadata committed by the previous lock holder and incorrectly make its newly
referenced object look unused. The report is advisory, but false positives can
still encourage unsafe manual deletion.

**How to apply:** Preserve snapshot-after-lock ordering when extending storage
inventory reports. Treat missing object-age information as uncertainty rather
than proof of an old unused file, and never silently turn reporting into cleanup.
