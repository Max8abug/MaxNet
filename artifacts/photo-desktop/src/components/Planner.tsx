import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { CalendarDays } from "lucide-react";
import {
  createPlannerEntry,
  deletePlannerEntry,
  dismissPlannerReminder,
  fetchDueReminders,
  fetchPlanner,
  updatePlannerEntry,
  type PlannerEntry,
  type PlannerInput,
} from "../lib/planner-api";
import { useAuth } from "../lib/auth-store";
import { enablePushNotifications } from "../lib/notifications";
import { useTimeZone } from "../lib/time-settings";
import { PlannerView } from "./PlannerView";

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

export function Planner() {
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
      <div className="planner-root planner-signed-out" data-testid="planner-signed-out">
        <div className="planner-signed-out-card">
          <CalendarDays className="planner-signed-out-icon" aria-hidden="true" />
          <h2>Planner</h2>
          <p>Your planner is private. Sign in to keep notes, events, and reminders.</p>
        </div>
      </div>
    );
  }

  const [sy, sm, sd] = selected.split("-").map(Number);
  const selectedLabel = new Date(sy, sm - 1, sd).toLocaleDateString([], { weekday: "long", month: "long", day: "numeric" });
  const monthLabel = new Date(cursor.y, cursor.m, 1).toLocaleDateString([], { month: "long", year: "numeric" });
  const localTimeZone = Intl.DateTimeFormat().resolvedOptions().timeZone;

  return (
    <PlannerView
      today={today}
      selected={selected}
      selectedLabel={selectedLabel}
      monthLabel={monthLabel}
      localTimeZone={localTimeZone}
      siteTimeZone={siteTimeZone}
      cells={cells}
      byDay={byDay}
      dayEntries={dayEntries}
      due={due}
      loading={loading}
      saving={saving}
      error={error}
      status={status}
      pushMsg={pushMsg}
      pushBusy={pushBusy}
      form={form}
      onGo={(delta) => go(delta)}
      onGoToday={goToday}
      onPickDay={pickDay}
      onEdit={edit}
      onDelete={(entry) => void remove(entry)}
      onDismiss={(entry) => void dismiss(entry)}
      onSetKind={setKind}
      onFormChange={(changes) => setForm((current) => ({ ...current, ...changes }))}
      onClear={() => setForm(blankForm(selected, form.kind))}
      onSave={() => void save()}
      onRetry={() => void load(true)}
      onEnablePush={() => void enablePush()}
    />
  );
}
