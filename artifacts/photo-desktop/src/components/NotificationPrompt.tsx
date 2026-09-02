import { useEffect, useState } from "react";
import { useAuth } from "../lib/auth-store";
import {
  browserNotificationsSupported,
  enablePushNotifications,
  notificationPermission,
  requestNotificationPermission,
} from "../lib/notifications";

const PROMPT_SEEN_KEY = "pd-notifications-prompted";
const PROMPT_OPERATION_TIMEOUT_MS = 15_000;

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = window.setTimeout(() => reject(new Error("Notification setup timed out. You can try again from the Start menu.")), ms);
    promise.then(
      (value) => { window.clearTimeout(timer); resolve(value); },
      (error) => { window.clearTimeout(timer); reject(error); },
    );
  });
}

export function NotificationPrompt() {
  const user = useAuth((s) => s.user);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!browserNotificationsSupported() || notificationPermission() !== "default") return;
    if (localStorage.getItem(PROMPT_SEEN_KEY)) return;
    localStorage.setItem(PROMPT_SEEN_KEY, "1");
    const timer = window.setTimeout(() => setOpen(true), 700);
    return () => window.clearTimeout(timer);
  }, []);

  async function enable() {
    setBusy(true);
    setError(null);
    try {
      if (user) {
        const result = await withTimeout(enablePushNotifications(), PROMPT_OPERATION_TIMEOUT_MS);
        if (!result.ok) {
          setError(result.reason || "Could not enable notifications.");
          return;
        }
      } else {
        const permission = await withTimeout(requestNotificationPermission(), PROMPT_OPERATION_TIMEOUT_MS);
        if (permission !== "granted") {
          setError(
            permission === "denied"
              ? "Notifications are blocked for this site. You can re-enable them in your browser's site settings."
              : "Notification permission was not granted.",
          );
          return;
        }
      }
      setOpen(false);
    } catch (e: any) {
      setError(e?.message || "Could not enable notifications.");
    } finally {
      setBusy(false);
    }
  }

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[1200] flex items-center justify-center bg-black/30 p-3">
      <div className="win98-window bg-[#c0c0c0] w-[340px] max-w-full flex flex-col">
        <div className="win98-titlebar px-1 flex items-center justify-between text-xs">
          <span>Site Notifications</span>
          <button className="win98-button px-1.5 leading-none" onClick={() => setOpen(false)}>x</button>
        </div>
        <div className="p-3 flex flex-col gap-2 text-sm">
          <div className="font-bold">Stay up to date?</div>
          <div className="text-xs">
            Allow notifications for new messages and @mentions, even when this site is in another tab.
          </div>
          {error && <div className="text-red-700 text-xs">{error}</div>}
          <div className="flex gap-2 justify-end mt-1">
            <button className="win98-button px-3 py-1" onClick={() => setOpen(false)}>Not now</button>
            <button className="win98-button px-3 py-1 font-bold" disabled={busy} onClick={() => void enable()}>
              {busy ? "Enabling…" : "Enable Notifications"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}