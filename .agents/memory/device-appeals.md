---
name: Device appeal cookie association
description: Browser device tracking must handle a cookie issued during the current request.
---

When the device middleware creates a browser cookie, downstream authentication in that same request must be able to resolve the new token; otherwise the first signup or login after clearing cookies succeeds without creating a device association.

**Why:** The response cookie is not present in the incoming request headers, so association code that only reads request cookies silently skips the new device.

**How to apply:** Preserve this same-request visibility whenever changing device-cookie issuance or authentication association behavior, and verify both first signup and first login after cookie clearing.