import { Router, type IRouter } from "express";
import { createHash, randomBytes } from "node:crypto";
import { db, pushSubscriptionsTable, expoPushTokensTable, usersTable } from "@workspace/db";
import { and, eq } from "drizzle-orm";
import { requireAuth } from "../lib/auth";
import { ensureVapid, getPublicKey, sendResendEmail } from "../lib/push";

const router: IRouter = Router();

// Public — the client needs the VAPID public key to ask the browser for a
// push subscription. The private half stays on the server.
router.get("/push/public-key", async (_req, res) => {
  await ensureVapid();
  const publicKey = await getPublicKey();
  res.json({ publicKey });
});

router.get("/push/preferences", requireAuth, async (req, res) => {
  const [user] = await db.select({
    notificationPreferences: usersTable.notificationPreferences,
    email: usersTable.email,
    emailVerifiedAt: usersTable.emailVerifiedAt,
  }).from(usersTable).where(eq(usersTable.username, req.session.username!)).limit(1);
  res.json({
    preferences: user?.notificationPreferences || {},
    email: user?.email || "",
    emailVerified: !!user?.emailVerifiedAt,
  });
});

router.put("/push/preferences", requireAuth, async (req, res) => {
  const valid = (x: any) => x && typeof x === "object"
    && typeof x.directMessages === "boolean" && typeof x.siteNews === "boolean"
    && typeof x.planner === "boolean" && ["all", "mentions", "off"].includes(x.chat);
  const p = req.body?.preferences;
  if (!p || !valid(p.push) || !valid(p.email)) {
    res.status(400).json({ error: "Invalid notification preferences" });
    return;
  }
  await db.update(usersTable).set({ notificationPreferences: { push: p.push, email: p.email } })
    .where(eq(usersTable.username, req.session.username!));
  res.json({ ok: true });
});

router.post("/push/email", requireAuth, async (req, res) => {
  const email = typeof req.body?.email === "string" ? req.body.email.trim().toLowerCase() : "";
  if (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    res.status(400).json({ error: "Enter a valid email address." });
    return;
  }
  const token = randomBytes(32).toString("hex");
  const hash = createHash("sha256").update(token).digest("hex");
  const expiry = new Date(Date.now() + 30 * 60 * 1000);
  await db.update(usersTable).set({
    email, emailVerifiedAt: null, emailVerificationHash: hash, emailVerificationExpiresAt: expiry,
  }).where(eq(usersTable.username, req.session.username!));
  const proto = String(req.headers["x-forwarded-proto"] || req.protocol).split(",")[0]!.trim();
  const host = String(req.headers["x-forwarded-host"] || req.get("host") || "");
  const link = `${proto}://${host}/api/push/email/verify?token=${token}`;
  const delivered = await sendResendEmail(email, "Verify your Portfolio 98 email", `<p>Click to verify this address for notifications:</p><p><a href="${link}">Verify email</a></p><p>This link expires in 30 minutes.</p>`);
  if (!delivered) {
    res.status(503).json({ error: "Email could not be sent. Configure RESEND_API_KEY and RESEND_FROM_EMAIL in the launcher first." });
    return;
  }
  res.json({ ok: true });
});

router.get("/push/email/verify", async (req, res) => {
  const token = typeof req.query.token === "string" ? req.query.token : "";
  if (!/^[a-f0-9]{64}$/.test(token)) { res.status(400).send("Invalid or expired verification link."); return; }
  const hash = createHash("sha256").update(token).digest("hex");
  const [user] = await db.select({
    id: usersTable.id,
    emailVerificationExpiresAt: usersTable.emailVerificationExpiresAt,
  }).from(usersTable).where(eq(usersTable.emailVerificationHash, hash))
    .limit(1);
  if (!user || !user.emailVerificationExpiresAt || user.emailVerificationExpiresAt <= new Date()) {
    res.status(400).send("Invalid or expired verification link.");
    return;
  }
  await db.update(usersTable).set({
    emailVerifiedAt: new Date(), emailVerificationHash: null, emailVerificationExpiresAt: null,
  }).where(eq(usersTable.id, user.id));
  res.send("Email verified. You can close this page.");
});

// Save (or update) a subscription for the logged-in user. Subscriptions are
// uniquely identified by their endpoint, so we upsert by endpoint to avoid
// duplicates if the same browser re-subscribes.
router.post("/push/subscribe", requireAuth, async (req, res) => {
  const me = req.session.username!;
  const sub = req.body?.subscription;
  if (!sub || !sub.endpoint || !sub.keys?.p256dh || !sub.keys?.auth) {
    res.status(400).json({ error: "Invalid subscription" });
    return;
  }
  const ua = String(req.get("user-agent") || "").slice(0, 200);
  const existing = await db.select().from(pushSubscriptionsTable).where(eq(pushSubscriptionsTable.endpoint, sub.endpoint)).limit(1);
  if (existing.length) {
    await db.update(pushSubscriptionsTable)
      .set({ username: me, p256dh: sub.keys.p256dh, auth: sub.keys.auth, userAgent: ua })
      .where(eq(pushSubscriptionsTable.endpoint, sub.endpoint));
  } else {
    await db.insert(pushSubscriptionsTable).values({
      username: me,
      endpoint: sub.endpoint,
      p256dh: sub.keys.p256dh,
      auth: sub.keys.auth,
      userAgent: ua,
    });
  }
  res.json({ ok: true });
});

router.post("/push/unsubscribe", requireAuth, async (req, res) => {
  const me = req.session.username!;
  const endpoint = req.body?.endpoint;
  if (!endpoint) { res.status(400).json({ error: "endpoint required" }); return; }
  await db.delete(pushSubscriptionsTable).where(and(
    eq(pushSubscriptionsTable.username, me),
    eq(pushSubscriptionsTable.endpoint, endpoint),
  ));
  res.json({ ok: true });
});

router.post("/push/expo/register", requireAuth, async (req, res) => {
  const token = typeof req.body?.token === "string" ? req.body.token.trim() : "";
  const platform = req.body?.platform === "android" ? "android" : "ios";
  if (!/^Expo(?:nent)?PushToken\[[\w-]{20,200}\]$/.test(token)) {
    res.status(400).json({ error: "Invalid Expo push token" });
    return;
  }
  await db.insert(expoPushTokensTable).values({
    username: req.session.username!,
    token,
    platform,
  }).onConflictDoUpdate({
    target: expoPushTokensTable.token,
    set: { username: req.session.username!, platform },
  });
  res.json({ ok: true });
});

router.post("/push/expo/unregister", requireAuth, async (req, res) => {
  const token = typeof req.body?.token === "string" ? req.body.token.trim() : "";
  if (!token) {
    res.status(400).json({ error: "token required" });
    return;
  }
  await db.delete(expoPushTokensTable).where(and(
    eq(expoPushTokensTable.username, req.session.username!),
    eq(expoPushTokensTable.token, token),
  ));
  res.json({ ok: true });
});

export default router;
