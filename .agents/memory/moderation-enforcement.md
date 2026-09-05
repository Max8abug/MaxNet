---
name: Moderation enforcement
description: Durable rule for keeping account bans and device blocks effective across sessions and login flows.
---

Account and device moderation must be checked both when a user signs in and when an existing session refreshes its identity. Chat-only checks are insufficient because an already-authenticated session can continue using the rest of the site.

**Why:** A ban/device-review record can exist while login or an active session still succeeds if enforcement is implemented only in the moderated feature.

**How to apply:** Keep account-ban and device-review checks in the auth boundary, invalidate affected active sessions, and keep moderation actions idempotent so retrying a ban also re-flags newly associated devices.