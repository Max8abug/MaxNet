import { Router, type IRouter } from "express";
import { db, pushSubscriptionsTable } from "@workspace/db";
import { and, eq } from "drizzle-orm";
import { requireAuth } from "../lib/auth";
import { ensureVapid, getPublicKey } from "../lib/push";

const router: IRouter = Router();

// Public — the client needs the VAPID public key to ask the browser for a
// push subscription. The private half stays on the server.
router.get("/push/public-key", async (_req, res) => {
  await ensureVapid();
  const publicKey = await getPublicKey();
  res.json({ publicKey });
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

export default router;
