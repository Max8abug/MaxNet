import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Bell,
  CalendarDays,
  Check,
  ChevronLeft,
  ChevronRight,
  Clock3,
  Pencil,
  Plus,
  Sparkles,
  StickyNote,
  Trash2,
  X,
} from "lucide-react";
import "./_group.css";
import {
  createPlannerEntry,
  deletePlannerEntry,
  dismissPlannerReminder,
  enablePushNotifications,
  fetchDueReminders,
  fetchPlanner,
  updatePlannerEntry,
  useAuth,
  useTimeZone,
  type PlannerEntry,
  type PlannerInput,
} from "./plannerMock";

const pad = (n: number) => String(n).padStart(2, "0");
const dayStr = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const monthStr = (y: number, m: number) => `${y}-${pad(m + 1)}`;
const toLocalInput = (iso: string | null) => {
  if (!iso) return "";
  const d = new Date(iso);
  if (isNaN(d.getTime())) return "";
  return `${dayStr(d)}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
};
const toIso = (value: string) => new Date(value).toISOString();
const fmtTime = (iso: string | null) =>
  iso ? new Date(iso).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }) : "";
const fmtFull = (iso: string | null) =>
  iso ? new Date(iso).toLocaleString([], { dateStyle: "medium", timeStyle: "short" }) : "";
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
  day,
  id: null,
  kind,
  title: "",
  notes: "",
  startsAt: kind === "event" ? `${day}T09:00` : "",
  remindOn: kind === "reminder",
  remindAt: kind === "reminder" ? `${day}T09:00` : "",
});

const kindMeta = {
  note: { label: "Note", color: "#547d69", tint: "#e7f0e8", icon: StickyNote },
  event: { label: "Event", color: "#526a9b", tint: "#e9edf7", icon: Clock3 },
  reminder: { label: "Reminder", color: "#bb684f", tint: "#f8e9df", icon: Bell },
} as const;

export function PlannerRefresh() {
  const user = useAuth((state) => state.user);
  const siteTimeZone = useTimeZone();
  const username = user?.username ?? null;
  const [clock, setClock] = useState(Date.now);
  const today = dayStr(new Date(clock));
  const [cursor, setCursor] = useState(() => {
    const now = new Date();
    return { y: now.getFullYear(), m: now.getMonth() };
  });
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

  const load = useCallback(async (showLoading: boolean) => {
    const requestedMonth = monthRef.current;
    const requestedAccount = accountRef.current;
    if (!requestedAccount) return;
    if (showLoading) setLoading(true);
    try {
      const [list, dueList] = await Promise.all([fetchPlanner(requestedMonth), fetchDueReminders()]);
      if (monthRef.current !== requestedMonth || accountRef.current !== requestedAccount) return;
      setEntries(list);
      setDue(dueList.filter((entry) => !entry.dismissed));
      setError(null);
    } catch (cause) {
      if (showLoading || monthRef.current === requestedMonth) {
        setError(cause instanceof Error ? cause.message : "Could not load your planner.");
      }
    } finally {
      if (showLoading) setLoading(false);
    }
  }, []);

  useEffect(() => {
    setEntries([]);
    setDue([]);
    setError(null);
    setStatus(null);
    setPushMsg(null);
    setForm(blankForm(dayStr(new Date())));
    setSaving(false);
  }, [username]);

  useEffect(() => {
    if (!username) return;
    setEntries([]);
    void load(true);
  }, [username, month, load, pollTick]);

  useEffect(() => {
    if (!username) return;
    const id = window.setInterval(() => {
      setClock(Date.now());
      if (!document.hidden) void load(false);
    }, POLL_MS);
    const onVisible = () => {
      if (!document.hidden) {
        setClock(Date.now());
        void load(false);
      }
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      window.clearInterval(id);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [username, month, load, pollTick]);

  const byDay = useMemo(() => {
    const map = new Map<string, PlannerEntry[]>();
    for (const entry of entries) map.set(entry.day, [...(map.get(entry.day) ?? []), entry]);
    return map;
  }, [entries]);

  const dayEntries = useMemo(() => {
    const list = byDay.get(selected) ?? [];
    const key = (entry: PlannerEntry) => entry.startsAt ?? entry.remindAt ?? "";
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
    const next = new Date(cursor.y, cursor.m + delta, 1);
    setCursor({ y: next.getFullYear(), m: next.getMonth() });
  }

  function pickDay(day: string) {
    if (day !== selected && (form.id !== null || form.title || form.notes)
      && !window.confirm("Discard unsaved entry changes and switch days?")) return;
    setSelected(day);
    setStatus(null);
    setForm(blankForm(day, form.kind));
  }

  function goToday() {
    const now = new Date();
    const day = dayStr(now);
    setCursor({ y: now.getFullYear(), m: now.getMonth() });
    pickDay(day);
  }

  function edit(entry: PlannerEntry) {
    setSelected(entry.day);
    const [year, monthNumber] = entry.day.split("-").map(Number);
    setCursor({ y: year, m: monthNumber - 1 });
    setStatus(null);
    setForm({
      day: entry.day,
      id: entry.id,
      kind: entry.kind,
      title: entry.title,
      notes: entry.notes,
      startsAt: toLocalInput(entry.startsAt),
      remindOn: !!entry.remindAt,
      remindAt: toLocalInput(entry.remindAt),
    });
  }

  function setKind(kind: Form["kind"]) {
    setForm((current) => ({
      ...current,
      kind,
      startsAt: kind === "event" ? current.startsAt || `${selected}T09:00` : "",
      remindOn: kind === "reminder" ? true : current.remindOn,
      remindAt: kind === "reminder" ? current.remindAt || `${selected}T09:00` : current.remindAt,
    }));
  }

  async function save() {
    setError(null);
    setStatus(null);
    if (!form.title.trim() && form.kind !== "note") {
      setError("Give it a title.");
      return;
    }
    if (!form.title.trim() && !form.notes.trim()) {
      setError("Write a title or a note first.");
      return;
    }
    if (form.kind === "event" && !form.startsAt) {
      setError("Events need a start time.");
      return;
    }
    if ((form.kind === "reminder" || form.remindOn) && !form.remindAt) {
      setError("Choose when to be reminded.");
      return;
    }
    for (const value of [
      form.kind === "event" ? form.startsAt : "",
      form.kind === "reminder" || form.remindOn ? form.remindAt : "",
    ]) {
      if (value && (!Number.isFinite(new Date(value).getTime()) || toLocalInput(toIso(value)) !== value)) {
        setError("Choose a valid local time. This time may fall in a daylight-saving clock change.");
        return;
      }
    }
    const previous = entries.find((entry) => entry.id === form.id) || due.find((entry) => entry.id === form.id);
    const preserveTime = (local: string, original: string | null | undefined) =>
      original && toLocalInput(original) === local ? original : toIso(local);
    const input: PlannerInput = {
      kind: form.kind,
      title: form.title.trim(),
      notes: form.notes,
      day: form.kind === "event" && form.startsAt
        ? form.startsAt.slice(0, 10)
        : form.kind === "reminder" && form.remindAt
          ? form.remindAt.slice(0, 10)
          : form.day,
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
      const [year, monthNumber] = input.day.split("-").map(Number);
      if (monthStr(year, monthNumber - 1) !== month) setCursor({ y: year, m: monthNumber - 1 });
      else await load(false);
      setPollTick((tick) => tick + 1);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not save.");
    } finally {
      setSaving(false);
    }
  }

  async function remove(entry: PlannerEntry) {
    if (!window.confirm(`Delete "${entry.title || "this note"}"?`)) return;
    setError(null);
    try {
      await deletePlannerEntry(entry.id);
      if (form.id === entry.id) setForm(blankForm(selected));
      setEntries((current) => current.filter((item) => item.id !== entry.id));
      setDue((current) => current.filter((item) => item.id !== entry.id));
      setStatus("Entry deleted.");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not delete.");
    }
  }

  async function dismiss(entry: PlannerEntry) {
    setError(null);
    try {
      const updated = await dismissPlannerReminder(entry.id);
      setDue((current) => current.filter((item) => item.id !== entry.id));
      setEntries((current) => current.map((item) => item.id === entry.id ? updated : item));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not dismiss.");
    }
  }

  async function enablePush() {
    setPushBusy(true);
    setPushMsg(null);
    try {
      const result = await enablePushNotifications();
      setPushMsg(result.ok
        ? { ok: true, text: "Push notifications are on for this device." }
        : { ok: false, text: result.reason || "Push notifications could not be enabled." });
    } catch (cause) {
      setPushMsg({
        ok: false,
        text: cause instanceof Error ? cause.message : "Push notifications could not be enabled.",
      });
    } finally {
      setPushBusy(false);
    }
  }

  const selectedParts = selected.split("-").map(Number);
  const selectedLabel = new Date(selectedParts[0], selectedParts[1] - 1, selectedParts[2])
    .toLocaleDateString([], { weekday: "long", month: "long", day: "numeric" });
  const monthLabel = new Date(cursor.y, cursor.m, 1).toLocaleDateString([], { month: "long", year: "numeric" });
  const selectedDate = new Date(selectedParts[0], selectedParts[1] - 1, selectedParts[2]);
  const fieldClass = "planner-field w-full rounded-lg border px-3 py-2.5 text-sm outline-none transition";

  if (!username) {
    return (
      <div className="planner-refresh min-h-screen p-4" data-testid="planner-signed-out">
        <div className="planner-window mx-auto flex min-h-[calc(100vh-2rem)] max-w-3xl flex-col">
          <div className="planner-titlebar">Portfolio98 <span>Planner</span></div>
          <div className="flex flex-1 items-center justify-center p-8 text-center">
            <div className="max-w-sm rounded-2xl bg-[#fbf8ef] p-8 shadow-sm">
              <CalendarDays className="mx-auto mb-4 h-9 w-9 text-[#50796f]" />
              <h1 className="font-['Fraunces'] text-3xl text-[#29484a]">A space of your own</h1>
              <p className="mt-3 text-sm leading-6 text-[#697b73]">Your planner is private. Sign in to keep notes, events, and reminders.</p>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="planner-refresh min-h-screen p-3 sm:p-5" data-testid="planner">
      <style>{`
        .planner-refresh {
          --ink: #29484a; --muted: #76827a; --paper: #fbf8ef; --line: #e5dfd0;
          --jade: #50796f; --jade-deep: #365e58; --rose: #c5745b; --lavender: #7785a7;
          color: var(--ink); font-family: var(--app-font-sans);
          background:
            radial-gradient(ellipse at 14% 8%, rgba(221,238,218,.54), transparent 35%),
            radial-gradient(ellipse at 88% 92%, rgba(241,220,188,.45), transparent 34%),
            #0c7876;
        }
        .planner-window {
          overflow: hidden; max-width: 1160px; min-height: calc(100dvh - 2.5rem);
          border: 1px solid rgba(22,46,47,.62); border-radius: 14px;
          background: #e8e4d8; box-shadow: 0 18px 52px rgba(14,39,40,.27), inset 0 1px rgba(255,255,255,.9);
        }
        .planner-titlebar {
          display:flex; align-items:center; gap:9px; min-height:37px; padding:0 13px;
          color:#f5f8f1; background:linear-gradient(100deg,#315d61,#4f817e);
          font-size:12px; letter-spacing:.025em; font-weight:700;
        }
        .planner-titlebar:before { content:""; width:9px; height:9px; border:2px solid #e9d7a3; border-radius:2px; }
        .planner-titlebar span { color:rgba(244,248,237,.72); font-weight:400; }
        .planner-surface {
          background-color:var(--paper);
          background-image:radial-gradient(rgba(100,111,90,.07) .65px, transparent .65px);
          background-size:7px 7px;
        }
        .planner-field { color:#30494a; border-color:#d8d6c9; background:#fffef9; }
        .planner-field:focus { border-color:#648f81; box-shadow:0 0 0 3px rgba(91,139,122,.14); }
        .planner-action { transition:transform 140ms ease, background-color 140ms ease, box-shadow 140ms ease, opacity 140ms ease; }
        .planner-action:hover:not(:disabled) { transform:translateY(-1px); }
        .planner-day { transition:background-color 130ms ease, transform 130ms ease, box-shadow 130ms ease; }
        .planner-day:hover:not(:disabled) { transform:translateY(-1px); box-shadow:0 3px 8px rgba(46,72,63,.1); }
        .planner-refresh button:focus-visible, .planner-refresh select:focus-visible,
        .planner-refresh input:focus-visible, .planner-refresh textarea:focus-visible {
          outline:2px solid #b77258; outline-offset:2px;
        }
        @media (max-width: 640px) {
          .planner-window { min-height:calc(100dvh - 1.5rem); border-radius:10px; }
        }
      `}</style>

      <section className="planner-window mx-auto flex w-full flex-col">
        <header className="planner-titlebar">
          <span className="!text-[#f5f8f1]">Portfolio98</span>
          <span> / </span>
          <span>Planner</span>
          <div className="ml-auto flex items-center gap-1.5" aria-hidden="true">
            <span className="h-2.5 w-2.5 rounded-full bg-[#a7c7a6]" />
            <span className="h-2.5 w-2.5 rounded-full bg-[#e9d7a3]" />
            <span className="h-2.5 w-2.5 rounded-full bg-[#dc9b83]" />
          </div>
        </header>

        <div className="planner-surface flex-1 px-4 py-5 sm:px-7 sm:py-6">
          <div className="mb-5 flex flex-wrap items-end justify-between gap-3 border-b border-[#e7e1d3] pb-4">
            <div>
              <div className="mb-1 flex items-center gap-2 text-[10px] font-bold uppercase tracking-[.19em] text-[#698579]">
                <Sparkles className="h-3.5 w-3.5" strokeWidth={1.8} />
                Your private everyday space
              </div>
              <h1 className="font-['Fraunces'] text-[34px] leading-none tracking-[-.035em] text-[#29484a] sm:text-[40px]">Planner</h1>
              <p className="mt-2 text-xs text-[#78837a]">Gather the little things you want to remember.</p>
            </div>
            <div className="rounded-xl border border-[#e4dece] bg-[#f3efe3] px-3.5 py-2 text-right">
              <div className="text-[9px] font-bold uppercase tracking-[.16em] text-[#869083]">Today</div>
              <div className="mt-0.5 text-sm font-semibold text-[#45665f]">
                {new Date().toLocaleDateString([], { weekday: "short", month: "short", day: "numeric" })}
              </div>
            </div>
          </div>

          {due.length > 0 && (
            <section role="alert" className="mb-5 overflow-hidden rounded-xl border border-[#ead2bd] bg-[#fff5e8] shadow-[0_3px_12px_rgba(142,100,64,.07)]" data-testid="planner-due">
              <div className="flex items-start gap-3 px-4 py-3">
                <span className="mt-0.5 rounded-lg bg-[#f4e2ca] p-2 text-[#a85f48]"><Bell className="h-4 w-4" /></span>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
                    <h2 className="text-sm font-bold text-[#744d3a]">A gentle nudge</h2>
                    <span className="text-[11px] text-[#9e7b63]">{due.length} reminder{due.length === 1 ? "" : "s"} ready</span>
                  </div>
                  <div className="mt-2 space-y-2">
                    {due.map((entry) => (
                      <div key={entry.id} className="flex flex-wrap items-center gap-2 border-t border-[#eadbca] pt-2 text-xs">
                        <span className="min-w-0 flex-1 text-[#6a5748]">
                          <b className="text-[#533d31]">{entry.title || "Note"}</b>
                          <span className="ml-2 text-[#9b8069]">{fmtFull(entry.remindAt)}</span>
                        </span>
                        <button type="button" className="planner-action rounded-lg px-2.5 py-1.5 font-semibold text-[#6c6456] hover:bg-[#f4e8d7]" onClick={() => edit(entry)}>Open</button>
                        <button type="button" className="planner-action rounded-lg bg-[#ead2bd] px-3 py-1.5 font-semibold text-[#714c3b] hover:bg-[#dfc0a6]" onClick={() => void dismiss(entry)} data-testid={`button-dismiss-${entry.id}`}>Dismiss</button>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </section>
          )}

          <main className="grid gap-5 lg:grid-cols-[minmax(0,0.94fr)_minmax(340px,1.06fr)] lg:gap-6">
            <section className="min-w-0">
              <div className="mb-3 flex items-center justify-between gap-2">
                <div>
                  <div className="text-[9px] font-bold uppercase tracking-[.17em] text-[#8a9486]">Take a look around</div>
                  <h2 className="mt-0.5 font-['Fraunces'] text-xl leading-tight text-[#355454]" data-testid="text-month">{monthLabel}</h2>
                </div>
                <div className="flex items-center gap-1.5">
                  <button type="button" aria-label="Previous month" data-testid="button-prev-month" className="planner-action rounded-lg border border-[#e5dfd2] bg-[#f6f2e8] p-2 text-[#58746a] hover:bg-[#eaeedf]" onClick={() => go(-1)}>
                    <ChevronLeft className="h-4 w-4" />
                  </button>
                  <button type="button" aria-label="Next month" data-testid="button-next-month" className="planner-action rounded-lg border border-[#e5dfd2] bg-[#f6f2e8] p-2 text-[#58746a] hover:bg-[#eaeedf]" onClick={() => go(1)}>
                    <ChevronRight className="h-4 w-4" />
                  </button>
                  <button type="button" data-testid="button-today" className="planner-action rounded-lg border border-[#d4dfd1] bg-[#e6eee2] px-3 py-2 text-[11px] font-bold text-[#4c6c5e] hover:bg-[#dbe8d8]" onClick={goToday}>Today</button>
                </div>
              </div>

              <div className="rounded-2xl border border-[#e6dfd0] bg-[#fffdf7] p-2.5 shadow-[0_5px_18px_rgba(66,77,60,.05)] sm:p-3.5">
                <div className="mb-1 grid grid-cols-7">
                  {WEEK.map((weekday) => (
                    <div key={weekday} className="py-2 text-center text-[10px] font-bold uppercase tracking-[.08em] text-[#9a9c8d]">{weekday}</div>
                  ))}
                </div>
                <div className="grid grid-cols-7 gap-1 sm:gap-1.5">
                  {cells.map((day, index) => {
                    if (!day) return <div key={`blank-${index}`} className="min-h-[43px] rounded-lg sm:min-h-[52px]" />;
                    const list = byDay.get(day) ?? [];
                    const isToday = day === today;
                    const isSelected = day === selected;
                    return (
                      <button
                        key={day}
                        type="button"
                        onClick={() => pickDay(day)}
                        aria-pressed={isSelected}
                        aria-label={`${day}${isToday ? " today" : ""}, ${list.length} entries`}
                        data-testid={`day-${day}`}
                        className={`planner-day relative flex min-h-[43px] flex-col items-center justify-center rounded-lg border text-xs sm:min-h-[52px] ${
                          isSelected
                            ? "border-[#4c7169] bg-[#4c7169] text-[#fffdf5] shadow-[0_3px_8px_rgba(57,94,84,.18)]"
                            : isToday
                              ? "border-[#d8b386] bg-[#fbf0dc] font-bold text-[#815b3d]"
                              : "border-transparent bg-[#f7f5ed] text-[#596b60] hover:border-[#d8e2d5] hover:bg-[#eef3e9]"
                        }`}
                      >
                        <span className="leading-none">{Number(day.slice(8))}</span>
                        {list.length > 0 && (
                          <span className="mt-1.5 flex min-h-[5px] items-center gap-[3px]" aria-hidden="true">
                            {list.slice(0, 4).map((entry) => (
                              <i key={entry.id} className="h-1 w-1 rounded-full" style={{ backgroundColor: isSelected ? "#e6d79c" : kindMeta[entry.kind].color }} />
                            ))}
                            {list.length > 4 && <span className="text-[8px] leading-none">+</span>}
                          </span>
                        )}
                        {isToday && !isSelected && <span className="absolute right-1.5 top-1.5 h-1 w-1 rounded-full bg-[#c5745b]" />}
                      </button>
                    );
                  })}
                </div>
              </div>

              <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2 px-1 text-[10px] text-[#7e877b]">
                {(["note", "event", "reminder"] as const).map((kind) => (
                  <span key={kind} className="inline-flex items-center gap-1.5">
                    <i className="h-2 w-2 rounded-full" style={{ backgroundColor: kindMeta[kind].color }} />
                    {kindMeta[kind].label}
                  </span>
                ))}
                <span className="inline-flex items-center gap-1.5"><i className="h-2 w-2 rounded-full bg-[#c5745b]" />Today</span>
                {loading && <span role="status" className="ml-auto text-[#6a8477]">Gathering your plans…</span>}
              </div>

              <div className="mt-5 rounded-xl border border-[#e5dfd0] bg-[#f3f0e5] p-3.5 sm:p-4">
                <div className="flex items-start gap-3">
                  <div className="rounded-lg bg-[#e4e9d9] p-2 text-[#587466]"><CalendarDays className="h-4 w-4" /></div>
                  <div className="min-w-0">
                    <div className="text-[9px] font-bold uppercase tracking-[.15em] text-[#899181]">A small note about time</div>
                    <p className="mt-1 text-[11px] leading-5 text-[#747d70]">
                      Times follow this device ({Intl.DateTimeFormat().resolvedOptions().timeZone}).
                      {siteTimeZone !== Intl.DateTimeFormat().resolvedOptions().timeZone && ` The site clock is set to ${siteTimeZone}; your planner stays local.`}
                    </p>
                  </div>
                </div>
              </div>
            </section>

            <section className="min-w-0">
              <div className="mb-3 flex items-end justify-between gap-3">
                <div>
                  <div className="text-[9px] font-bold uppercase tracking-[.17em] text-[#8a9486]">On this day</div>
                  <h2 className="mt-0.5 font-['Fraunces'] text-xl leading-tight text-[#355454]" data-testid="text-selected-day">{selectedLabel}</h2>
                </div>
                <span className="rounded-full bg-[#e8ede2] px-2.5 py-1 text-[10px] font-semibold text-[#668071]">
                  {dayEntries.length} {dayEntries.length === 1 ? "entry" : "entries"}
                </span>
              </div>

              <div className="mb-4 space-y-2">
                {dayEntries.length === 0 ? (
                  <div className="rounded-xl border border-dashed border-[#d8d9ca] bg-[#f7f5ec] px-4 py-5 text-center" data-testid="planner-empty">
                    <div className="mx-auto mb-2 flex h-8 w-8 items-center justify-center rounded-full bg-[#e6ece1] text-[#638071]"><StickyNote className="h-4 w-4" /></div>
                    <p className="font-['Fraunces'] text-base text-[#52675e]">{loading ? "One moment…" : "A little breathing room"}</p>
                    <p className="mt-1 text-[11px] leading-5 text-[#879084]">{loading ? "Your plans are on their way." : "Nothing here yet. Add a note, event, or reminder below."}</p>
                  </div>
                ) : dayEntries.map((entry) => {
                  const meta = kindMeta[entry.kind];
                  const Icon = meta.icon;
                  const time = entry.startsAt
                    ? dayStr(new Date(entry.startsAt)) === entry.day ? fmtTime(entry.startsAt) : fmtFull(entry.startsAt)
                    : null;
                  return (
                    <article
                      key={entry.id}
                      className={`group rounded-xl border px-3.5 py-3 transition ${
                        form.id === entry.id
                          ? "border-[#9ab5a4] bg-[#f0f5ec] shadow-[0_0_0_2px_rgba(93,137,111,.08)]"
                          : "border-[#e9e3d6] bg-[#fffdf8] hover:border-[#d2ddce] hover:shadow-[0_4px_12px_rgba(59,81,68,.06)]"
                      }`}
                      data-testid={`entry-${entry.id}`}
                    >
                      <div className="flex items-start gap-3">
                        <div className="mt-0.5 rounded-lg p-2" style={{ backgroundColor: meta.tint, color: meta.color }}>
                          <Icon className="h-3.5 w-3.5" />
                        </div>
                        <div className="min-w-0 flex-1">
                          <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
                            <span className="text-[9px] font-bold uppercase tracking-[.12em]" style={{ color: meta.color }}>{meta.label}</span>
                            {time && <span className="inline-flex items-center gap-1 text-[10px] font-semibold text-[#8b8a7e]"><Clock3 className="h-3 w-3" />{time}</span>}
                            <h3 className="w-full break-words text-[13px] font-bold leading-snug text-[#3c5552]">{entry.title || "(untitled note)"}</h3>
                          </div>
                          {entry.notes && <p className="mt-1.5 whitespace-pre-wrap break-words text-[11px] leading-[1.55] text-[#778078]">{entry.notes}</p>}
                          {entry.remindAt && (
                            <p className="mt-2 flex flex-wrap items-center gap-1 text-[10px] text-[#9a745e]">
                              <Bell className="h-3 w-3" /> Remind {fmtFull(entry.remindAt)}
                              {entry.dismissed ? " · dismissed" : entry.notifiedAt ? " · alert attempted" : ""}
                            </p>
                          )}
                        </div>
                        <div className="flex shrink-0 gap-1 opacity-75 transition group-hover:opacity-100">
                          <button type="button" aria-label={`Edit ${entry.title || "note"}`} className="planner-action rounded-lg p-1.5 text-[#6c8174] hover:bg-[#eaf0e6]" onClick={() => edit(entry)}>
                            <Pencil className="h-3.5 w-3.5" />
                          </button>
                          <button type="button" aria-label={`Delete ${entry.title || "note"}`} className="planner-action rounded-lg p-1.5 text-[#a66c5b] hover:bg-[#f7e9e1]" onClick={() => void remove(entry)}>
                            <Trash2 className="h-3.5 w-3.5" />
                          </button>
                        </div>
                      </div>
                    </article>
                  );
                })}
              </div>

              <form
                className="rounded-2xl border border-[#dfe2d4] bg-[#f0f2e8] p-4 shadow-[0_5px_16px_rgba(61,78,62,.045)] sm:p-5"
                onSubmit={(event) => { event.preventDefault(); void save(); }}
                data-testid="planner-form"
              >
                <div className="mb-3 flex items-center justify-between gap-3">
                  <div className="flex items-center gap-2">
                    <span className="rounded-lg bg-[#dce7d9] p-1.5 text-[#547a6d]"><Plus className="h-4 w-4" /></span>
                    <div>
                      <h3 className="text-sm font-bold text-[#3f5d55]">{form.id === null ? "Make a note of it" : "Edit your entry"}</h3>
                      <p className="text-[10px] text-[#899187]">{form.id === null ? "A note, a plan, or a gentle nudge." : "Your changes stay private."}</p>
                    </div>
                  </div>
                  <label className="sr-only" htmlFor="planner-kind">Entry type</label>
                  <select
                    id="planner-kind"
                    className="planner-field !w-auto max-w-[145px] rounded-lg px-2.5 py-2 text-xs font-semibold"
                    value={form.kind}
                    onChange={(event) => setKind(event.target.value as Form["kind"])}
                    aria-label="Entry type"
                    data-testid="select-kind"
                  >
                    <option value="note">Note</option>
                    <option value="event">Timed event</option>
                    <option value="reminder">Reminder</option>
                  </select>
                </div>

                <div className="space-y-2.5">
                  <input
                    className={fieldClass}
                    placeholder={form.kind === "note" ? "A title, if you like" : "Give it a title"}
                    maxLength={120}
                    value={form.title}
                    onChange={(event) => setForm({ ...form, title: event.target.value })}
                    aria-label="Title"
                    data-testid="input-title"
                  />
                  <textarea
                    className={`${fieldClass} min-h-[72px] resize-y leading-5`}
                    placeholder="Add a few details…"
                    maxLength={5000}
                    value={form.notes}
                    onChange={(event) => setForm({ ...form, notes: event.target.value })}
                    aria-label="Notes"
                    data-testid="input-notes"
                  />
                  {form.kind === "event" && (
                    <label className="block text-[10px] font-bold uppercase tracking-[.11em] text-[#778579]">
                      Starts
                      <input
                        type="datetime-local"
                        className={`${fieldClass} mt-1.5 normal-case tracking-normal`}
                        value={form.startsAt}
                        onChange={(event) => setForm({ ...form, startsAt: event.target.value })}
                        data-testid="input-starts"
                      />
                    </label>
                  )}
                  {form.kind !== "reminder" && (
                    <label className="flex w-fit cursor-pointer items-center gap-2 rounded-lg py-1 text-xs font-medium text-[#68766b]">
                      <input
                        type="checkbox"
                        className="h-4 w-4 accent-[#557c6c]"
                        checked={form.remindOn}
                        onChange={(event) => setForm({
                          ...form,
                          remindOn: event.target.checked,
                          remindAt: event.target.checked && !form.remindAt ? form.startsAt || `${selected}T09:00` : form.remindAt,
                        })}
                        data-testid="check-remind"
                      />
                      Remind me
                    </label>
                  )}
                  {(form.kind === "reminder" || form.remindOn) && (
                    <label className="block text-[10px] font-bold uppercase tracking-[.11em] text-[#778579]">
                      Remind at
                      <input
                        type="datetime-local"
                        className={`${fieldClass} mt-1.5 normal-case tracking-normal`}
                        value={form.remindAt}
                        onChange={(event) => setForm({ ...form, remindAt: event.target.value })}
                        data-testid="input-remind"
                      />
                    </label>
                  )}
                </div>

                <div className="mt-3 flex items-center justify-between gap-2">
                  {form.id !== null || form.title || form.notes ? (
                    <button
                      type="button"
                      className="planner-action inline-flex items-center gap-1 rounded-lg px-2 py-2 text-[11px] font-semibold text-[#7d8277] hover:bg-[#e6e9de]"
                      onClick={() => setForm(blankForm(selected, form.kind))}
                      disabled={saving}
                    >
                      <X className="h-3.5 w-3.5" /> {form.id !== null ? "Cancel edit" : "Clear"}
                    </button>
                  ) : <span />}
                  <button
                    type="submit"
                    className="planner-action inline-flex items-center gap-2 rounded-lg bg-[#496f66] px-4 py-2.5 text-xs font-bold text-[#fffdf5] shadow-[0_3px_8px_rgba(48,83,73,.16)] hover:bg-[#3d635a] disabled:cursor-wait disabled:opacity-60"
                    disabled={saving}
                    data-testid="button-save-entry"
                  >
                    <Check className="h-3.5 w-3.5" />
                    {saving ? "Saving…" : form.id === null ? "Save entry" : "Save changes"}
                  </button>
                </div>
              </form>

              {error && (
                <div role="alert" className="mt-3 flex items-center gap-2 rounded-xl border border-[#e6c5b4] bg-[#fff1e9] px-3 py-2.5 text-xs text-[#94543f]">
                  <span className="min-w-0 flex-1">{error}</span>
                  <button type="button" className="planner-action rounded-lg bg-[#f0dfd5] px-3 py-1.5 font-bold" onClick={() => void load(true)}>Retry</button>
                </div>
              )}
              {status && <div role="status" className="mt-2 px-1 text-[11px] font-semibold text-[#4d7964]" data-testid="text-planner-status">{status}</div>}

              <section className="mt-4 rounded-xl border border-[#e6dfd1] bg-[#f8f5eb] px-3.5 py-3">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <h3 className="text-xs font-bold text-[#596c61]">Reminders on this device</h3>
                    <p className="mt-1 text-[10px] leading-[1.55] text-[#899084]">
                      Push alerts need browser permission and a subscription on this device. Delivery is best-effort; reminders are checked about every 30 seconds.
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => void enablePush()}
                    disabled={pushBusy}
                    className="planner-action inline-flex shrink-0 items-center gap-1.5 rounded-lg border border-[#d6dfd2] bg-[#e8eee3] px-3 py-2 text-[10px] font-bold text-[#557466] hover:bg-[#dce8d8] disabled:opacity-60"
                    data-testid="button-enable-push"
                  >
                    <Bell className="h-3.5 w-3.5" />
                    {pushBusy ? "Enabling…" : "Enable push"}
                  </button>
                </div>
                {pushMsg && <p role="status" className={`mt-2 text-[10px] ${pushMsg.ok ? "text-[#4d7964]" : "text-[#a65542]"}`} data-testid="text-push-status">{pushMsg.text}</p>}
              </section>
            </section>
          </main>
          <footer className="mt-5 border-t border-[#e7e1d3] pt-3 text-center text-[9px] tracking-[.06em] text-[#a1a091]">
            A quiet place for all the things you mean to do.
          </footer>
        </div>
      </section>
    </div>
  );
}
