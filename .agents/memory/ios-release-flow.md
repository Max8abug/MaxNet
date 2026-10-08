---
name: iOS release flow
description: Supported signing flow and evidence required for the iOS-first release.
---

Use Replit Expo Launch for this project's iOS release, even when an older plan
describes manual EAS setup. Do not run EAS authentication/build/submission
commands or substitute the managed Expo session as an Expo token.

**Why:** Replit's managed mobile publishing requires its guided Expo project and
Apple signing flow; the Expo skill explicitly prohibits manual EAS commands.
The original release plan predates that constraint.

The owner self-hosts the site and deploys changes by pushing to Git and then
updating their machine. Do not require migration of their backend to Replit.

**Why:** The owner explicitly clarified the hosting arrangement. A missing
Replit deployment does not mean their production site is absent.

**How to apply:** Ask for the actual self-hosted public HTTPS origin, verify
reachability, and use it for the native build. Deployment metadata only identifies
Replit-hosted URLs, not this external server. Guide Apple authorization in the
Launch wizard and treat any workspace publishing requirement as a separate
Launch prerequisite, not a reason to change the backend's hosting.
Keep the release incomplete until a signed TestFlight build has been exercised
on a physical iPhone. Browser checks cannot establish native push delivery or
session persistence across a native app restart.

iOS release development is suspended until the owner explicitly asks to resume.
Do not recreate or queue the deferred signing and physical-device checks merely
because other work finishes.

**Why:** The owner explicitly paused this work and asked to close it so unrelated
queued work can proceed; this is not approval to declare the native release tested.

**How to apply:** Preserve the existing preparation, leave Android deferred,
and resume Apple signing/TestFlight work only after a new explicit request.
