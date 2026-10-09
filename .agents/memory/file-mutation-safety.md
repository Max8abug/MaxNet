---
name: File mutation safety
description: Safety tradeoffs for deleting and replacing hosted-site and wiki files during storage outages.
---

Treat deletion as an atomic metadata change with durable, retryable byte cleanup.
A storage outage after that commit does not make logical deletion fail. Never
restore delete-bytes-first behavior to preserve the old storage-error response.

**Why:** Bulk byte deletion cannot be rolled back. Reporting failure after several
unlinks can leave an apparently surviving site or wiki page with missing media.
Temporarily retaining unused bytes is safer than damaging referenced content.

**How to apply:** Queue cleanup in the same transaction as metadata removal.
Keep failed cleanup durable across restarts, and verify that an object is no
longer referenced before removing its bytes. Do not sweep legacy production
objects automatically.

Reserve independent database capacity for durable upload intents written while
a metadata transaction holds its mutation lock.

**Why:** If both operations share an exhausted connection pool, concurrent writers
waiting for that lock can consume every connection and prevent its holder from
recording the upload intent, deadlocking all writers.

**How to apply:** Preserve an independent journal connection pool or an equivalent
explicit capacity reservation. Include more writers than the normal pool capacity
when checking changes to the locking/journaling strategy.
