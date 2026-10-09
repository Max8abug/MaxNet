import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import "./_group.css";
import {
  createPlannerEntry,
  deletePlannerEntry,
  dismissPlannerReminder,
  fetchDueReminders,
  fetchPlanner,
  updatePlannerEntry,
  type PlannerEntry,
  type PlannerInput,
} from "./plannerMock";
import { enablePushNotifications, useAuth, useTimeZone } from "./plannerMock";

const pad = (n: number) => String(n).padStart(2, "0");
const dayStr = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const monthStr = (y: number, m: number) => `${y}-${pad(m + 1)}`;
const toLocalInput = (iso: string | null) => {
  if (!iso) return "";
  const d = new Date(iso);
  if (isNaN(d.getTime())) return "";
  return `${dayStr(d)}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
};
const toIso = (v: string) => new Date(v).toISOString();
const fmtTime = (iso: string | null) => (iso ? new Date(iso).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }) : "");
const fmtFull = (iso: string | null) => (iso ? new Date(iso).toLocaleString([], { dateStyle: "medium", timeStyle: "short" }) : "");
const WEEK = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const POLL_MS = 30_000;

interface Form {
  day: string;
  id: number | null;
  kind: PlannerEntry["kind"];
  title: string;
  notes: string;
  startsAt: string;
  remindOn: boolean;
  remindAt: string;
}
const blankForm = (day: string, kind: Form["kind"] = "note"): Form => ({
  day, id: null, kind, title: "", notes: "",
  startsAt: kind === "event" ? `${day}T09:00` : "",
  remindOn: kind === "reminder", remindAt: kind === "reminder" ? `${day}T09:00` : "",
});

function CurrentPlanner() {
  const user = useAuth((s) => s.user);
  const siteTimeZone = useTimeZone();
  const username = user?.username ?? null;
  const [clock, setClock] = useState(Date.now);
  const today = dayStr(new Date(clock));
  const [cursor, setCursor] = useState(() => { const n = new Date(); return { y: n.getFullYear(), m: n.getMonth() }; });
  const [selected, setSelected] = useState(today);
  const [entries, setEntries] = useState<PlannerEntry[]>([]);
  const [due, setDue] = useState<PlannerEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [form, setForm] = useState<Form>(() => blankForm(today));
  const [pushMsg, setPushMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [pushBusy, setPushBusy] = useState(false);
  const [pollTick, setPollTick] = useState(0);
  const month = monthStr(cursor.y, cursor.m);
  const monthRef = useRef(month);
  monthRef.current = month;
  const accountRef = useRef(username);
  accountRef.current = username;

  const load = useCallback(async (showSpinner: boolean) => {
    const m = monthRef.current;
    const who = accountRef.current;
    if (!who) return;
    if (showSpinner) setLoading(true);
    try {
      const [list, dueList] = await Promise.all([fetchPlanner(m), fetchDueReminders()]);
      if (monthRef.current !== m || accountRef.current !== who) return;
      setEntries(list);
      setDue(dueList.filter((e) => !e.dismissed));
      setError(null);
    } catch (e) {
      if (showSpinner || monthRef.current === m) setError(e instanceof Error ? e.message : "Could not load your planner.");
    } finally {
      if (showSpinner) setLoading(false);
    }
  }, []);

  // Account change: wipe everything.
  useEffect(() => {
    setEntries([]); setDue([]); setError(null); setStatus(null); setPushMsg(null);
    setForm(blankForm(dayStr(new Date())));
    setSaving(false);
  }, [username]);

  useEffect(() => {
    if (!username) return;
    setEntries([]);
    void load(true);
  }, [username, month, load, pollTick]);

  // Poll while mounted; never touches an unsaved form.
  useEffect(() => {
    if (!username) return;
    const id = window.setInterval(() => {
      setClock(Date.now());
      if (!document.hidden) void load(false);
    }, POLL_MS);
    const onVisible = () => {
      if (!document.hidden) { setClock(Date.now()); void load(false); }
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => { window.clearInterval(id); document.removeEventListener("visibilitychange", onVisible); };
  }, [username, month, load, pollTick]);

  const byDay = useMemo(() => {
    const map = new Map<string, PlannerEntry[]>();
    for (const e of entries) map.set(e.day, [...(map.get(e.day) ?? []), e]);
    return map;
  }, [entries]);

  const dayEntries = useMemo(() => {
    const list = byDay.get(selected) ?? [];
    const key = (e: PlannerEntry) => e.startsAt ?? e.remindAt ?? "";
    return [...list].sort((a, b) => (key(a) || "~").localeCompare(key(b) || "~"));
  }, [byDay, selected]);

  const cells = useMemo(() => {
    const first = new Date(cursor.y, cursor.m, 1);
    const count = new Date(cursor.y, cursor.m + 1, 0).getDate();
    const out: (string | null)[] = Array(first.getDay()).fill(null);
    for (let d = 1; d <= count; d++) out.push(dayStr(new Date(cursor.y, cursor.m, d)));
    while (out.length % 7) out.push(null);
    return out;
  }, [cursor]);

  function go(delta: number) {
    const d = new Date(cursor.y, cursor.m + delta, 1);
    setCursor({ y: d.getFullYear(), m: d.getMonth() });
  }
  function goToday() {
    const n = new Date();
    setCursor({ y: n.getFullYear(), m: n.getMonth() });
    pickDay(dayStr(n));
  }
  function pickDay(day: string) {
    if (day !== selected && (form.id !== null || form.title || form.notes)
      && !confirm("Discard unsaved entry changes and switch days?")) return;
    setSelected(day);
    setStatus(null);
    setForm(blankForm(day, form.kind));
  }
  function edit(e: PlannerEntry) {
    setSelected(e.day);
    const [y, m] = e.day.split("-").map(Number);
    setCursor({ y, m: m - 1 });
    setStatus(null);
    setForm({
      day: e.day, id: e.id, kind: e.kind, title: e.title, notes: e.notes,
      startsAt: toLocalInput(e.startsAt), remindOn: !!e.remindAt, remindAt: toLocalInput(e.remindAt),
    });
  }
  function setKind(kind: Form["kind"]) {
    setForm((f) => ({
      ...f, kind,
      startsAt: kind === "event" ? f.startsAt || `${selected}T09:00` : "",
      remindOn: kind === "reminder" ? true : f.remindOn,
      remindAt: kind === "reminder" ? f.remindAt || `${selected}T09:00` : f.remindAt,
    }));
  }

  async function save() {
    setError(null); setStatus(null);
    if (!form.title.trim() && form.kind !== "note") { setError("Give it a title."); return; }
    if (!form.title.trim() && !form.notes.trim()) { setError("Write a title or a note first."); return; }
    if (form.kind === "event" && !form.startsAt) { setError("Events need a start time."); return; }
    if ((form.kind === "reminder" || form.remindOn) && !form.remindAt) { setError("Choose when to be reminded."); return; }
    for (const value of [form.kind === "event" ? form.startsAt : "", form.kind === "reminder" || form.remindOn ? form.remindAt : ""]) {
      if (value && (!Number.isFinite(new Date(value).getTime()) || toLocalInput(toIso(value)) !== value)) {
        setError("Choose a valid local time. This time may fall in a daylight-saving clock change.");
        return;
      }
    }
    const previous = entries.find(e => e.id === form.id) || due.find(e => e.id === form.id);
    const preserveTime = (local: string, original: string | null | undefined) =>
      original && toLocalInput(original) === local ? original : toIso(local);
    const input: PlannerInput = {
      kind: form.kind,
      title: form.title.trim(),
      notes: form.notes,
      day: form.kind === "event" && form.startsAt ? form.startsAt.slice(0, 10) : form.kind === "reminder" && form.remindAt ? form.remindAt.slice(0, 10) : form.day,
      startsAt: form.kind === "event" ? preserveTime(form.startsAt, previous?.startsAt) : null,
      remindAt: form.kind === "reminder" || form.remindOn ? preserveTime(form.remindAt, previous?.remindAt) : null,
    };
    setSaving(true);
    try {
      if (form.id === null) await createPlannerEntry(input);
      else await updatePlannerEntry(form.id, input);
      setStatus(form.id === null ? "Saved to your planner." : "Entry updated.");
      setForm(blankForm(selected, form.kind));
      setSelected(input.day);
      const [y, m] = input.day.split("-").map(Number);
      if (monthStr(y, m - 1) !== month) setCursor({ y, m: m - 1 });
      else await load(false);
      setPollTick((t) => t + 1);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not save.");
    } finally {
      setSaving(false);
    }
  }

  async function remove(e: PlannerEntry) {
    if (!confirm(`Delete "${e.title || "this note"}"?`)) return;
    setError(null);
    try {
      await deletePlannerEntry(e.id);
      if (form.id === e.id) setForm(blankForm(selected));
      setEntries((c) => c.filter((x) => x.id !== e.id));
      setDue((c) => c.filter((x) => x.id !== e.id));
      setStatus("Entry deleted.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not delete.");
    }
  }

  async function dismiss(e: PlannerEntry) {
    setError(null);
    try {
      const updated = await dismissPlannerReminder(e.id);
      setDue((c) => c.filter((x) => x.id !== e.id));
      setEntries((c) => c.map((x) => (x.id === e.id ? updated : x)));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not dismiss.");
    }
  }

  async function enablePush() {
    setPushBusy(true); setPushMsg(null);
    try {
      const r = await enablePushNotifications();
      setPushMsg(r.ok
        ? { ok: true, text: "Push notifications are on for this device." }
        : { ok: false, text: r.reason || "Push notifications could not be enabled." });
    } catch (e) {
      setPushMsg({ ok: false, text: e instanceof Error ? e.message : "Push notifications could not be enabled." });
    } finally {
      setPushBusy(false);
    }
  }

  if (!username) {
    return (
      <div className="flex h-full items-center justify-center bg-[#c0c0c0] p-4 text-xs text-black" data-testid="planner-signed-out">
        <div className="win98-inset max-w-xs bg-white p-4 text-center">
          <div className="mb-1 text-base font-bold text-[#000080]">Planner</div>
          <p>Your planner is private. Sign in to keep notes, events, and reminders.</p>
        </div>
      </div>
    );
  }

  const [sy, sm, sd] = selected.split("-").map(Number);
  const selectedLabel = new Date(sy, sm - 1, sd).toLocaleDateString([], { weekday: "long", month: "long", day: "numeric" });
  const monthLabel = new Date(cursor.y, cursor.m, 1).toLocaleDateString([], { month: "long", year: "numeric" });
  const field = "win98-inset w-full bg-white px-1 py-1 text-xs font-normal text-black";

  return (
    <div className="flex h-full min-h-0 flex-col overflow-auto bg-[#c0c0c0] text-xs text-black" data-testid="planner">
      {due.length > 0 && (
        <div role="alert" className="m-1 border border-[#800000] bg-[#ffffe1] p-2" data-testid="planner-due">
          <div className="mb-1 font-bold text-[#800000]">Due reminders ({due.length})</div>
          {due.map((e) => (
            <div key={e.id} className="flex flex-wrap items-center gap-1 border-t border-[#ccc] py-1">
              <span className="min-w-0 flex-1 break-words"><b>{e.title || "Note"}</b> · {fmtFull(e.remindAt)}</span>
              <button type="button" className="win98-button px-2" onClick={() => edit(e)}>Open</button>
              <button type="button" className="win98-button px-2" onClick={() => void dismiss(e)} data-testid={`button-dismiss-${e.id}`}>Dismiss</button>
            </div>
          ))}
        </div>
      )}

      <div className="flex min-h-0 flex-1 flex-col gap-1 p-1 md:flex-row">
        <section className="flex min-w-0 flex-col md:w-[55%]">
          <div className="mb-1 flex items-center gap-1">
            <button type="button" className="win98-button px-2 py-1" onClick={() => go(-1)} aria-label="Previous month" data-testid="button-prev-month">&lt;</button>
            <div className="min-w-0 flex-1 truncate text-center text-sm font-bold text-[#000080]" data-testid="text-month">{monthLabel}</div>
            <button type="button" className="win98-button px-2 py-1" onClick={() => go(1)} aria-label="Next month" data-testid="button-next-month">&gt;</button>
            <button type="button" className="win98-button px-2 py-1" onClick={goToday} data-testid="button-today">Today</button>
          </div>
          <div className="win98-inset bg-white p-1">
            <div className="grid grid-cols-7 text-center font-bold text-[#000080]">
              {WEEK.map((w) => <div key={w} className="py-0.5 text-[10px]">{w}</div>)}
            </div>
            <div className="grid grid-cols-7 gap-px">
              {cells.map((day, i) => {
                if (!day) return <div key={i} className="min-h-[34px] bg-[#eee]" />;
                const list = byDay.get(day) ?? [];
                const isToday = day === today;
                const isSel = day === selected;
                return (
                  <button
                    key={day}
                    type="button"
                    onClick={() => pickDay(day)}
                    aria-pressed={isSel}
                    aria-label={`${day}${isToday ? " today" : ""}, ${list.length} entries`}
                    data-testid={`day-${day}`}
                    className={`relative flex min-h-[34px] flex-col items-start border p-0.5 text-left sm:min-h-[44px] ${isSel ? "border-[#000080] bg-[#000080] text-white" : isToday ? "border-[#cc0000] bg-[#ffffe1] text-black" : "border-[#ccc] bg-white text-black hover:bg-[#eef3ff]"}`}
                    style={isToday ? { outline: "2px solid #cc0000", outlineOffset: "-2px" } : undefined}
                  >
                    <span className={`text-[11px] ${isToday ? "font-bold" : ""}`}>{Number(day.slice(8))}</span>
                    {list.length > 0 && (
                      <span className="mt-auto flex gap-0.5">
                        {list.slice(0, 4).map((e) => (
                          <span key={e.id} className="inline-block h-1.5 w-1.5" style={{ background: e.kind === "event" ? "#1084d0" : e.kind === "reminder" ? "#cc6600" : "#008000", outline: isSel ? "1px solid #fff" : undefined }} />
                        ))}
                        {list.length > 4 && <span className="text-[8px] leading-none">+</span>}
                      </span>
                    )}
                  </button>
                );
              })}
            </div>
          </div>
          <div className="mt-1 flex flex-wrap gap-2 text-[10px] text-gray-700">
            <span><i className="inline-block h-2 w-2 bg-[#008000]" /> Note</span>
            <span><i className="inline-block h-2 w-2 bg-[#1084d0]" /> Event</span>
            <span><i className="inline-block h-2 w-2 bg-[#cc6600]" /> Reminder</span>
            <span>Red outline = today</span>
            {loading && <span role="status">Loading...</span>}
          </div>
        </section>

        <section className="flex min-w-0 flex-1 flex-col gap-1">
          <div className="text-sm font-bold text-[#000080]" data-testid="text-selected-day">{selectedLabel}</div>
          <div className="win98-inset max-h-40 min-h-[48px] overflow-auto bg-white p-1">
            {dayEntries.length === 0 ? (
              <div className="p-1 text-gray-600">{loading ? "Loading..." : "Nothing here yet. Add a note, event, or reminder below."}</div>
            ) : dayEntries.map((e) => (
              <div key={e.id} className={`flex items-start gap-1 border-b border-[#ddd] py-1 ${form.id === e.id ? "bg-[#dcecff]" : ""}`} data-testid={`entry-${e.id}`}>
                <div className="min-w-0 flex-1">
                  <div className="break-words font-bold">
                    <span className="mr-1 text-[10px] uppercase text-[#000080]">{e.kind}</span>
                    {e.startsAt && <span className="mr-1">{dayStr(new Date(e.startsAt)) === e.day ? fmtTime(e.startsAt) : fmtFull(e.startsAt)}</span>}
                    {e.title || "(untitled note)"}
                  </div>
                  {e.notes && <div className="line-clamp-2 whitespace-pre-wrap break-words text-[10px] text-gray-700">{e.notes}</div>}
                  {e.remindAt && <div className="text-[10px] text-gray-600">Remind {fmtFull(e.remindAt)}{e.dismissed ? " (dismissed)" : e.notifiedAt ? " (alert attempted)" : ""}</div>}
                </div>
                <button type="button" className="win98-button px-1" onClick={() => edit(e)}>Edit</button>
                <button type="button" className="win98-button px-1 text-[#800000]" onClick={() => void remove(e)} aria-label={`Delete ${e.title || "note"}`}>Delete</button>
              </div>
            ))}
          </div>

          <form className="flex flex-col gap-1 border border-[#808080] bg-[#d8d8d8] p-2" onSubmit={(ev) => { ev.preventDefault(); void save(); }} data-testid="planner-form">
            <div className="flex items-center justify-between gap-1">
              <b>{form.id === null ? "New entry" : "Editing entry"}</b>
              <select className={`${field} !w-auto`} value={form.kind} onChange={(e) => setKind(e.target.value as Form["kind"])} aria-label="Entry type" data-testid="select-kind">
                <option value="note">Note</option>
                <option value="event">Timed event</option>
                <option value="reminder">Reminder</option>
              </select>
            </div>
            <input className={field} placeholder={form.kind === "note" ? "Title (optional)" : "Title"} maxLength={120} value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} aria-label="Title" data-testid="input-title" />
            <textarea className={`${field} min-h-[60px] resize-y`} placeholder="Notes" maxLength={5000} value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} aria-label="Notes" data-testid="input-notes" />
            {form.kind === "event" && (
              <label className="flex flex-col gap-0.5 font-bold">Starts
                <input type="datetime-local" className={field} value={form.startsAt} onChange={(e) => setForm({ ...form, startsAt: e.target.value })} data-testid="input-starts" />
              </label>
            )}
            {form.kind !== "reminder" && (
              <label className="flex items-center gap-1">
                <input type="checkbox" checked={form.remindOn} onChange={(e) => setForm({ ...form, remindOn: e.target.checked, remindAt: e.target.checked && !form.remindAt ? form.startsAt || `${selected}T09:00` : form.remindAt })} data-testid="check-remind" />
                Remind me
              </label>
            )}
            {(form.kind === "reminder" || form.remindOn) && (
              <label className="flex flex-col gap-0.5 font-bold">Remind at
                <input type="datetime-local" className={field} value={form.remindAt} onChange={(e) => setForm({ ...form, remindAt: e.target.value })} data-testid="input-remind" />
              </label>
            )}
            <div className="flex justify-end gap-1">
              {(form.id !== null || form.title || form.notes) && (
                <button type="button" className="win98-button px-3 py-1" onClick={() => setForm(blankForm(selected, form.kind))} disabled={saving}>{form.id !== null ? "Cancel edit" : "Clear"}</button>
              )}
              <button type="submit" className="win98-button px-3 py-1" disabled={saving} data-testid="button-save-entry">{saving ? "Saving..." : form.id === null ? "Save entry" : "Save changes"}</button>
            </div>
          </form>

          {error && (
            <div role="alert" className="flex items-center gap-1 border border-[#800000] bg-[#ffffe1] p-2 text-[#800000]">
              <span className="flex-1">{error}</span>
              <button type="button" className="win98-button px-2" onClick={() => void load(true)}>Retry</button>
            </div>
          )}
          {status && <div role="status" className="text-[10px] text-[#006000]" data-testid="text-planner-status">{status}</div>}

          <div className="border border-[#808080] bg-[#e2e2e2] p-2 text-[10px] leading-snug text-gray-700">
            <p>Times use this device's timezone ({Intl.DateTimeFormat().resolvedOptions().timeZone}). Due reminders always stay at the top of the planner until dismissed.</p>
            {siteTimeZone !== Intl.DateTimeFormat().resolvedOptions().timeZone && <p className="mt-1">The site's clock is set to {siteTimeZone}; Planner dates and times use your device's timezone instead.</p>}
            <p className="mt-1">Push alerts need browser permission and a subscription on this device, and the server must be running. Delivery is best-effort; reminders are normally checked within 30 seconds.</p>
            <div className="mt-1 flex flex-wrap items-center gap-2">
              <button type="button" className="win98-button px-2 py-1 text-xs" onClick={() => void enablePush()} disabled={pushBusy} data-testid="button-enable-push">{pushBusy ? "Enabling..." : "Enable push notifications"}</button>
              {pushMsg && <span role="status" className={pushMsg.ok ? "text-[#006000]" : "text-[#800000]"} data-testid="text-push-status">{pushMsg.text}</span>}
            </div>
          </div>
        </section>
      </div>
    </div>
  );
}


export function Current() {
  return (
    <div className="flex min-h-screen w-full items-center justify-center bg-[#008080] p-3">
      <section className="win98-window flex h-[calc(100vh-24px)] max-h-[760px] min-h-[560px] w-full max-w-[1120px] flex-col">
        <header className="win98-titlebar min-h-8 px-3 py-1">
          <span>Planner</span>
          <span aria-hidden="true" className="font-mono">_ &nbsp; □ &nbsp; ×</span>
        </header>
        <div className="min-h-0 flex-1 overflow-hidden">
          <CurrentPlanner />
        </div>
      </section>
    </div>
  );
}
