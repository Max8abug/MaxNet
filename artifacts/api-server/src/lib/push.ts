import webpush from "web-push";
import { db, siteSettingsTable, pushSubscriptionsTable, expoPushTokensTable } from "@workspace/db";
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

type PushPayload = { title: string; body: string; tag?: string; url?: string; kind?: string; excludeUsername?: string };

async function sendExpoNotifications(
  rows: Array<{ id: number; username: string; token: string }>,
  payload: PushPayload,
): Promise<void> {
  if (rows.length === 0) return;
  for (let offset = 0; offset < rows.length; offset += 100) {
    const batch = rows.slice(offset, offset + 100);
    const messages = batch.map((row) => ({
      to: row.token,
      title: payload.title,
      body: payload.body,
      sound: "default",
      channelId: "default",
      data: { url: payload.url || "/", kind: payload.kind || "site" },
    }));
    try {
      const response = await fetch("https://exp.host/--/api/v2/push/send", {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify(messages),
      });
      if (!response.ok) {
        logger.warn({ status: response.status }, "Expo push request failed");
        continue;
      }
      const result = await response.json() as {
        data?: Array<{ status?: string; details?: { error?: string } }>;
      };
      const tickets = Array.isArray(result.data) ? result.data : [];
      await Promise.all(tickets.flatMap((ticket, index) => {
        if (ticket.status !== "error" || ticket.details?.error !== "DeviceNotRegistered") return [];
        const row = batch[index];
        return row
          ? [db.delete(expoPushTokensTable).where(eq(expoPushTokensTable.id, row.id)).catch(() => {})]
          : [];
      }));
    } catch (e) {
      logger.warn({ err: e }, "Expo push delivery failed");
    }
  }
}

async function sendPushToSubscriptions(
  subs: Array<{ id: number; endpoint: string; p256dh: string; auth: string; username: string }>,
  payload: PushPayload,
): Promise<void> {
  if (subs.length === 0) return;
  const json = JSON.stringify(payload);
  await Promise.all(subs.map(async (s) => {
    try {
      await webpush.sendNotification(
        { endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } },
        json,
        { TTL: 60 * 60 * 24 },
      );
    } catch (e: any) {
      const code = e?.statusCode;
      if (code === 404 || code === 410) {
        await db.delete(pushSubscriptionsTable).where(eq(pushSubscriptionsTable.id, s.id)).catch(() => {});
      } else {
        logger.warn({ err: e?.message || e, statusCode: code, username: s.username }, "Push send failed");
      }
    }
  }));
}

// Send the same notification payload to every device the user has registered.
// Stale subscriptions (HTTP 404/410 from the push service) are pruned on the
// fly so they don't accumulate.
export async function sendPushToUser(
  username: string,
  payload: PushPayload,
): Promise<void> {
  try {
    const native = await db.select({
      id: expoPushTokensTable.id,
      username: expoPushTokensTable.username,
      token: expoPushTokensTable.token,
    }).from(expoPushTokensTable).where(eq(expoPushTokensTable.username, username));
    await sendExpoNotifications(native, payload);
  } catch (e) {
    logger.error({ err: e, username }, "Failed to load native push tokens");
  }
  const vapid = await ensureVapid();
  if (!vapid) return;
  try {
    const subs = await db.select().from(pushSubscriptionsTable).where(eq(pushSubscriptionsTable.username, username));
    await sendPushToSubscriptions(subs, payload);
  } catch (e) {
    logger.error({ err: e, username }, "Failed to load push subscriptions");
  }
}

// Broadcast public announcements to every subscribed browser/device.
export async function sendPushToAll(payload: PushPayload): Promise<void> {
  try {
    const native = await db.select({
      id: expoPushTokensTable.id,
      username: expoPushTokensTable.username,
      token: expoPushTokensTable.token,
    }).from(expoPushTokensTable);
    await sendExpoNotifications(
      payload.excludeUsername ? native.filter((s) => s.username !== payload.excludeUsername) : native,
      payload,
    );
  } catch (e) {
    logger.error({ err: e }, "Failed to load native push tokens for broadcast");
  }
  const vapid = await ensureVapid();
  if (!vapid) return;
  try {
    const subs = await db.select().from(pushSubscriptionsTable);
    await sendPushToSubscriptions(
      payload.excludeUsername ? subs.filter((s) => s.username !== payload.excludeUsername) : subs,
      payload,
    );
  } catch (e) {
    logger.error({ err: e }, "Failed to load push subscriptions for broadcast");
  }
}
