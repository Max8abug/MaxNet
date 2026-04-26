import webpush from "web-push";
import { db, siteSettingsTable, pushSubscriptionsTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { logger } from "./logger";

// VAPID identity — the "from" address the browser push services need so
// they can contact us back if our subscriptions go stale. A public mailto
// is conventional; nothing actually emails it.
const VAPID_SUBJECT = process.env["VAPID_SUBJECT"] || "mailto:owner@portfolio98.local";

let initPromise: Promise<{ publicKey: string; privateKey: string } | null> | null = null;

// Lazily initialise web-push the first time anything needs the keys. We
// store the keypair in the existing site_settings singleton so it survives
// restarts without requiring the operator to set env vars by hand. If the
// row is empty we generate a fresh keypair and persist it.
export async function ensureVapid(): Promise<{ publicKey: string; privateKey: string } | null> {
  if (initPromise) return initPromise;
  initPromise = (async () => {
    try {
      let [row] = await db.select().from(siteSettingsTable).limit(1);
      if (!row) {
        await db.insert(siteSettingsTable).values({});
        [row] = await db.select().from(siteSettingsTable).limit(1);
      }
      let publicKey = row?.vapidPublicKey || "";
      let privateKey = row?.vapidPrivateKey || "";
      if (!publicKey || !privateKey) {
        const keys = webpush.generateVAPIDKeys();
        publicKey = keys.publicKey;
        privateKey = keys.privateKey;
        await db.update(siteSettingsTable)
          .set({ vapidPublicKey: publicKey, vapidPrivateKey: privateKey })
          .where(eq(siteSettingsTable.id, row!.id));
        logger.info("Generated and persisted new VAPID keys for web push");
      }
      webpush.setVapidDetails(VAPID_SUBJECT, publicKey, privateKey);
      return { publicKey, privateKey };
    } catch (e) {
      logger.error({ err: e }, "Failed to initialise web push (VAPID)");
      initPromise = null; // allow retry on next call
      return null;
    }
  })();
  return initPromise;
}

export async function getPublicKey(): Promise<string> {
  const k = await ensureVapid();
  return k?.publicKey || "";
}

// Send the same notification payload to every device the user has registered.
// Stale subscriptions (HTTP 404/410 from the push service) are pruned on the
// fly so they don't accumulate.
export async function sendPushToUser(
  username: string,
  payload: { title: string; body: string; tag?: string; url?: string },
): Promise<void> {
  const v = await ensureVapid();
  if (!v) return;
  let subs;
  try {
    subs = await db.select().from(pushSubscriptionsTable).where(eq(pushSubscriptionsTable.username, username));
  } catch (e) {
    logger.error({ err: e, username }, "Failed to load push subscriptions");
    return;
  }
  if (subs.length === 0) return;

  const json = JSON.stringify(payload);
  await Promise.all(subs.map(async (s) => {
    try {
      await webpush.sendNotification(
        { endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } },
        json,
        { TTL: 60 * 60 * 24 }, // server holds the message up to 24h if device offline
      );
    } catch (e: any) {
      const code = e?.statusCode;
      // 404 / 410 mean the subscription has been revoked or expired.
      if (code === 404 || code === 410) {
        await db.delete(pushSubscriptionsTable).where(eq(pushSubscriptionsTable.id, s.id)).catch(() => {});
      } else {
        logger.warn({ err: e?.message || e, statusCode: code, username }, "Push send failed");
      }
    }
  }));
}
