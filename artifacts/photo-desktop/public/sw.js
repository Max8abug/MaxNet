// Service worker for the photo desktop site. Its only real job is to receive
// push messages from the server while the page is closed and surface them as
// system notifications. Clicking the notification focuses the existing tab if
// one is open, or opens a fresh one.

self.addEventListener("install", (event) => {
  // Activate immediately so users get push handling on first install.
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener("push", (event) => {
  let payload = { title: "New notification", body: "", tag: undefined, url: "/" };
  if (event.data) {
    try { payload = Object.assign(payload, event.data.json()); }
    catch { payload.body = event.data.text(); }
  }
  event.waitUntil(
    self.registration.showNotification(payload.title, {
      body: payload.body,
      tag: payload.tag,                    // collapses repeated alerts in same thread
      renotify: !!payload.tag,             // still vibrate/sound when same tag updates
      icon: "/favicon.svg",
      badge: "/favicon.svg",
      data: { url: payload.url || "/" },
    }),
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const targetUrl = (event.notification.data && event.notification.data.url) || "/";
  event.waitUntil((async () => {
    const all = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
    for (const c of all) {
      if ("focus" in c) {
        try { await c.focus(); } catch {}
        try { c.postMessage({ type: "open-dms" }); } catch {}
        return;
      }
    }
    if (self.clients.openWindow) await self.clients.openWindow(targetUrl);
  })());
});
