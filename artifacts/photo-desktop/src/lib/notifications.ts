// Front-end helpers for both in-app toasts and browser push notifications.
// Two layers:
//   1. In-app toast — a small Win98-styled popup in the corner. Always works.
//   2. Browser Notification — uses the Notifications API while the tab is
//      open (background tabs included), and the Web Push API + service worker
//      when the tab is fully closed but the browser is still running.

const BASE = "/api";

export type ToastListener = (toast: Toast) => void;
export interface Toast {
  id: number;
  title: string;
  body: string;
  kind?: "dm" | "info";
}

const listeners = new Set<ToastListener>();
let nextId = 1;

export function subscribeToasts(fn: ToastListener): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function pushToast(t: Omit<Toast, "id">): void {
  const toast = { id: nextId++, ...t };
  listeners.forEach((l) => l(toast));
}

// --- Browser Notifications (foreground / background-tab path) ---

export function browserNotificationsSupported(): boolean {
  return typeof window !== "undefined" && "Notification" in window;
}

export function notificationPermission(): NotificationPermission {
  if (!browserNotificationsSupported()) return "denied";
  return Notification.permission;
}

export async function requestNotificationPermission(): Promise<NotificationPermission> {
  if (!browserNotificationsSupported()) return "denied";
  if (Notification.permission === "granted" || Notification.permission === "denied") return Notification.permission;
  return await Notification.requestPermission();
}

export function showBrowserNotification(title: string, body: string, opts: { tag?: string; url?: string } = {}): void {
  if (!browserNotificationsSupported() || Notification.permission !== "granted") return;
  try {
    const n = new Notification(title, {
      body,
      tag: opts.tag,
      icon: "/favicon.svg",
      badge: "/favicon.svg",
    });
    n.onclick = () => {
      try { window.focus(); } catch {}
      n.close();
    };
  } catch {
    // Some browsers throw if called from outside a user gesture; that's fine,
    // the service-worker push path covers the closed-tab case anyway.
  }
}

// --- Service Worker + Web Push (closed-tab path) ---

function urlBase64ToUint8Array(base64: string): Uint8Array {
  const padding = "=".repeat((4 - (base64.length % 4)) % 4);
  const b64 = (base64 + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(b64);
  const out = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

let swReg: ServiceWorkerRegistration | null = null;
async function getSwRegistration(): Promise<ServiceWorkerRegistration | null> {
  if (!("serviceWorker" in navigator)) return null;
  if (swReg) return swReg;
  try {
    swReg = await navigator.serviceWorker.register("/sw.js");
    return swReg;
  } catch {
    return null;
  }
}

export async function registerServiceWorker(): Promise<void> {
  await getSwRegistration();
}

// Subscribe this browser to push for the logged-in user. Idempotent — calling
// it twice with permission already granted just refreshes the subscription on
// the server. Returns true if the browser is now subscribed.
export async function enablePushNotifications(): Promise<{ ok: boolean; reason?: string }> {
  if (!browserNotificationsSupported()) return { ok: false, reason: "Your browser doesn't support notifications." };
  const perm = await requestNotificationPermission();
  if (perm !== "granted") return { ok: false, reason: "Notification permission was not granted." };

  if (!("serviceWorker" in navigator) || !("PushManager" in window)) {
    // Permission granted but no push support — foreground notifications still work.
    return { ok: true, reason: "Foreground notifications enabled (this browser doesn't support background push)." };
  }

  const reg = await getSwRegistration();
  if (!reg) return { ok: false, reason: "Could not register the service worker." };

  let key: string;
  try {
    const r = await fetch(`${BASE}/push/public-key`, { credentials: "include" });
    const j = await r.json();
    key = j.publicKey;
    if (!key) return { ok: false, reason: "Server is missing a push key." };
  } catch {
    return { ok: false, reason: "Could not reach the server for the push key." };
  }

  let sub: PushSubscription | null = null;
  try {
    sub = await reg.pushManager.getSubscription();
    if (sub) {
      // Re-subscribe if the server's key has changed (would otherwise be a no-op).
      const existingKey = sub.options?.applicationServerKey
        ? btoa(String.fromCharCode(...new Uint8Array(sub.options.applicationServerKey)))
        : "";
      if (existingKey && key && existingKey !== key) {
        await sub.unsubscribe().catch(() => {});
        sub = null;
      }
    }
    if (!sub) {
      sub = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(key),
      });
    }
  } catch (e: any) {
    return { ok: false, reason: e?.message || "Could not subscribe this browser to push." };
  }

  try {
    await fetch(`${BASE}/push/subscribe`, {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ subscription: sub.toJSON() }),
    });
  } catch {
    return { ok: false, reason: "Could not save the subscription on the server." };
  }
  return { ok: true };
}

export async function isPushSubscribed(): Promise<boolean> {
  if (!("serviceWorker" in navigator) || !("PushManager" in window)) return false;
  const reg = await getSwRegistration();
  if (!reg) return false;
  const sub = await reg.pushManager.getSubscription();
  return !!sub;
}

export async function disablePushNotifications(): Promise<void> {
  if (!("serviceWorker" in navigator)) return;
  const reg = await getSwRegistration();
  if (!reg) return;
  const sub = await reg.pushManager.getSubscription();
  if (!sub) return;
  try {
    await fetch(`${BASE}/push/unsubscribe`, {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ endpoint: sub.endpoint }),
    });
  } catch {}
  try { await sub.unsubscribe(); } catch {}
}
