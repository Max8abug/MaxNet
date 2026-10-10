---
name: Notification email delivery
description: Outbound email configuration and recipient verification for the self-hosted site.
---

Use Resend for outbound notification and verification emails. The self-hosted server requires its Resend API key, verified sender address, and public HTTPS site URL to be configured in the launcher’s local `.env` settings; a Replit-only integration or secret does not configure the owner's server. Only send account notifications to verified recipient addresses, using an expiring verification link.

**Why:** The user selected Resend, and production runs on the user's own server rather than inside Replit.

**How to apply:** Keep provider credentials out of chat and client code. Add or change provider values through the launcher’s protected settings, which preserve configured values across updates.
