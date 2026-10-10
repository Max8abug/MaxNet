import { useEffect, useState } from "react";
import { Bell, Mail, Smartphone } from "lucide-react";
import {
  fetchNotificationSettings, requestNotificationEmail, saveNotificationPreferences,
  type NotificationChannelPreferences, type NotificationPreferences,
} from "../lib/api";

const defaults: NotificationPreferences = {
  push: { directMessages: true, chat: "mentions", siteNews: true, planner: true },
  email: { directMessages: false, chat: "off", siteNews: false, planner: false },
};
const categories: Array<{ key: keyof Omit<NotificationChannelPreferences, "chat">; label: string }> = [
  { key: "directMessages", label: "Direct messages" },
  { key: "siteNews", label: "Site news" },
  { key: "planner", label: "Planner reminders" },
];

export function NotificationPreferencesPanel() {
  const [preferences, setPreferences] = useState(defaults);
  const [email, setEmail] = useState("");
  const [verified, setVerified] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState("");
  useEffect(() => {
    let alive = true;
    void fetchNotificationSettings().then((result) => {
      if (!alive) return;
      setPreferences({
        push: { ...defaults.push, ...result.preferences?.push },
        email: { ...defaults.email, ...result.preferences?.email },
      });
      setEmail(result.email);
      setVerified(result.emailVerified);
    }).catch((error) => setNotice(error.message || "Could not load settings."))
      .finally(() => alive && setLoading(false));
    return () => { alive = false; };
  }, []);

  const persist = async (next: NotificationPreferences) => {
    setPreferences(next);
    setSaving(true);
    setNotice("");
    try { await saveNotificationPreferences(next); setNotice("Notification preferences saved."); }
    catch (error: any) { setNotice(error.message || "Could not save settings."); }
    finally { setSaving(false); }
  };
  const update = (channel: "push" | "email", key: keyof NotificationChannelPreferences, value: boolean | "all" | "mentions" | "off") => {
    const next = { ...preferences, [channel]: { ...preferences[channel], [key]: value } } as NotificationPreferences;
    void persist(next);
  };

  return <div className="flex h-full flex-col gap-3 overflow-y-auto p-3 text-sm">
    <div className="win98-inset flex items-center gap-2 p-3">
      <Bell className="h-5 w-5" /><div><b>Notification controls</b><div className="text-xs text-gray-600">Choose which apps can alert you and where.</div></div>
    </div>
    {(["push", "email"] as const).map((channel) => <section className="win98-inset p-3" key={channel}>
      <h3 className="mb-2 flex items-center gap-2 font-bold">{channel === "push" ? <Smartphone className="h-4 w-4" /> : <Mail className="h-4 w-4" />}{channel === "push" ? "Push notifications" : "Email notifications"}</h3>
      <label className="mb-2 flex items-center justify-between gap-2">
        <span>Chat</span>
        <select className="win98-inset min-h-8 px-2" disabled={loading || saving} value={preferences[channel].chat}
          onChange={(event) => update(channel, "chat", event.target.value as NotificationChannelPreferences["chat"])}>
          <option value="all">All messages</option><option value="mentions">Only @mentions</option><option value="off">Off</option>
        </select>
      </label>
      {categories.map(({ key, label }) => <label className="flex min-h-8 items-center justify-between gap-2" key={key}>
        <span>{label}</span><input type="checkbox" disabled={loading || saving} checked={preferences[channel][key]}
          onChange={(event) => update(channel, key, event.target.checked)} />
      </label>)}
    </section>)}
    <section className="win98-inset p-3">
      <h3 className="mb-2 flex items-center gap-2 font-bold"><Mail className="h-4 w-4" />Email address</h3>
      <p className="mb-2 text-xs text-gray-600">Verify your address before the site sends email alerts. Push settings work independently.</p>
      <div className="flex flex-wrap gap-2">
        <input className="win98-inset min-h-9 min-w-0 flex-1 px-2" type="email" autoComplete="email" value={email}
          onChange={(event) => { setEmail(event.target.value); setVerified(false); }} placeholder="you@example.com" />
        <button className="win98-button min-h-9 px-3" disabled={!email || saving} onClick={async () => {
          setSaving(true); setNotice("");
          try { await requestNotificationEmail(email); setNotice("Verification email sent. Check your inbox."); }
          catch (error: any) { setNotice(error.message || "Could not send verification email."); }
          finally { setSaving(false); }
        }}>{verified ? "Send verification again" : "Verify email"}</button>
      </div>
      {verified && <p className="mt-2 text-xs text-green-700">Email verified</p>}
    </section>
    {notice && <p role="status" className="text-xs">{notice}</p>}
    {saving && <p className="text-xs text-gray-600">Saving…</p>}
  </div>;
}
