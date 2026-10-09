---
name: Self-hosted uploads
description: Production hosting and persistence constraints for wiki and mini-site media.
---

The owner self-hosts this site and updates their own machine from Git. Do not
treat a successful Replit storage check as proof that production uploads work.

**Why:** The owner repeated that the site is self-hosted during upload enablement.
Replit-managed storage relies on the Replit environment, which is not their server.

**How to apply:** Preserve separate development and production storage. Self-hosted
uploads must survive rebuilds and must be backed up with the database; never
silently migrate or overwrite an existing upload directory or bucket.
