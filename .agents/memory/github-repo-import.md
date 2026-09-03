---
name: GitHub repository import
description: Durable setup lessons for importing an existing GitHub project into a Replit workspace.
---

When importing an existing repository, preserve the repository source while registering its runnable artifact through the artifact lifecycle so preview routing recognizes it. Keep generated artifact routing metadata separate from copied repository metadata.

**Why:** A copied artifact folder can run on its own workflow but remain invisible to the preview/artifact registry until it is registered.

**How to apply:** Register the existing app artifact first, then restore the repository files without overwriting the generated artifact metadata; install dependencies from the repository lockfile and resolve firewall-blocked pins with a current safe release.