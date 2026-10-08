---
name: Native app and hosted-site scope
description: User-confirmed rollout and permission rules for native mobile and user-hosted sites.
---

Launch the native app on iOS first. Android can follow later.

Hosted mini-sites default to 1 GB per user, but ranks may grant lower or higher storage allowances. A rank must explicitly permit creation of an HTML page. JavaScript is off by default and requires its own rank permission. Wiki editing must also be granted through rank permissions.

**Why:** The user explicitly selected iOS-first rollout and requested differentiated storage and scripting privileges rather than giving all accounts identical hosting capabilities.

**How to apply:** Preserve these defaults when expanding mobile release support or hosting administration. Do not silently enable JavaScript or grant hosting to every account.
