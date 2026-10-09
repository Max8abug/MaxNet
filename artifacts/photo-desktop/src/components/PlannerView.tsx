import {
  Bell,
  CalendarDays,
  Check,
  ChevronLeft,
  ChevronRight,
  Clock3,
  Pencil,
  Plus,
  StickyNote,
  Trash2,
  X,
} from "lucide-react";
import type { PlannerEntry } from "../lib/planner-api";
import "./Planner.css";

type PlannerKind = PlannerEntry["kind"];
interface PlannerForm {
  day: string;
  id: number | null;
  kind: PlannerKind;
  title: string;
  notes: string;
  startsAt: string;
  remindOn: boolean;
  remindAt: string;
}

interface PlannerViewProps {
  today: string;
  selected: string;
  selectedLabel: string;
  monthLabel: string;
  localTimeZone: string;
  siteTimeZone: string;
  cells: (string | null)[];
  byDay: Map<string, PlannerEntry[]>;
  dayEntries: PlannerEntry[];
  due: PlannerEntry[];
  loading: boolean;
  saving: boolean;
  error: string | null;
  status: string | null;
  pushMsg: { ok: boolean; text: string } | null;
  pushBusy: boolean;
  form: PlannerForm;
  onGo: (delta: number) => void;
  onGoToday: () => void;
  onPickDay: (day: string) => void;
  onEdit: (entry: PlannerEntry) => void;
  onDelete: (entry: PlannerEntry) => void;
  onDismiss: (entry: PlannerEntry) => void;
  onSetKind: (kind: PlannerKind) => void;
  onFormChange: (changes: Partial<PlannerForm>) => void;
  onClear: () => void;
  onSave: () => void;
  onRetry: () => void;
  onEnablePush: () => void;
}

const WEEK = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const dayKey = (date: Date) =>
  `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
const formatTime = (iso: string | null) =>
  iso ? new Date(iso).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }) : "";
const formatFull = (iso: string | null) =>
  iso ? new Date(iso).toLocaleString([], { dateStyle: "medium", timeStyle: "short" }) : "";

const kindLabel: Record<PlannerKind, string> = {
  note: "Note",
  event: "Event",
  reminder: "Reminder",
};

export function PlannerView({
  today,
  selected,
  selectedLabel,
  monthLabel,
  localTimeZone,
  siteTimeZone,
  cells,
  byDay,
  dayEntries,
  due,
  loading,
  saving,
  error,
  status,
  pushMsg,
  pushBusy,
  form,
  onGo,
  onGoToday,
  onPickDay,
  onEdit,
  onDelete,
  onDismiss,
  onSetKind,
  onFormChange,
  onClear,
  onSave,
  onRetry,
  onEnablePush,
}: PlannerViewProps) {
  const todayLabel = new Date().toLocaleDateString([], {
    weekday: "short",
    month: "short",
    day: "numeric",
  });
  const fieldClass = "planner-field";

  return (
    <div className="planner-root" data-testid="planner">
      <div className="planner-content">
        <header className="planner-intro">
          <div>
            <div className="planner-eyebrow">Your private everyday space</div>
            <h1>Planner</h1>
            <p>Gather the little things you want to remember.</p>
          </div>
          <div className="planner-today">
            <span>Today</span>
            <strong>{todayLabel}</strong>
          </div>
        </header>

        {due.length > 0 && (
          <section role="alert" className="planner-card planner-due" data-testid="planner-due">
            <div className="planner-due-heading">
              <span className="planner-icon planner-icon-reminder"><Bell aria-hidden="true" /></span>
              <div>
                <h2>A gentle nudge</h2>
                <span>{due.length} reminder{due.length === 1 ? "" : "s"} ready</span>
              </div>
            </div>
            {due.map((entry) => (
              <div key={entry.id} className="planner-due-row">
                <span className="planner-due-detail">
                  <strong>{entry.title || "Note"}</strong>
                  <time>{formatFull(entry.remindAt)}</time>
                </span>
                <button type="button" className="planner-button" onClick={() => onEdit(entry)}>Open</button>
                <button
                  type="button"
                  className="planner-button planner-button-reminder"
                  onClick={() => onDismiss(entry)}
                  data-testid={`button-dismiss-${entry.id}`}
                >
                  Dismiss
                </button>
              </div>
            ))}
          </section>
        )}

        <main className="planner-layout">
          <section className="planner-calendar-column">
            <div className="planner-section-heading">
              <div>
                <span className="planner-eyebrow">Take a look around</span>
                <h2 data-testid="text-month">{monthLabel}</h2>
              </div>
              <div className="planner-month-actions">
                <button type="button" className="planner-icon-button" onClick={() => onGo(-1)} aria-label="Previous month" data-testid="button-prev-month">
                  <ChevronLeft aria-hidden="true" />
                </button>
                <button type="button" className="planner-icon-button" onClick={() => onGo(1)} aria-label="Next month" data-testid="button-next-month">
                  <ChevronRight aria-hidden="true" />
                </button>
                <button type="button" className="planner-button planner-button-today" onClick={onGoToday} data-testid="button-today">
                  Today
                </button>
              </div>
            </div>

            <div className="planner-calendar-card">
              <div className="planner-weekdays">
                {WEEK.map((weekday) => <div key={weekday}>{weekday}</div>)}
              </div>
              <div className="planner-days">
                {cells.map((day, index) => {
                  if (!day) return <div key={`blank-${index}`} className="planner-day-empty" aria-hidden="true" />;
                  const dayEntriesForCell = byDay.get(day) ?? [];
                  const isToday = day === today;
                  const isSelected = day === selected;
                  return (
                    <button
                      key={day}
                      type="button"
                      className="planner-day"
                      data-selected={isSelected}
                      data-today={isToday}
                      onClick={() => onPickDay(day)}
                      aria-pressed={isSelected}
                      aria-label={`${day}${isToday ? " today" : ""}, ${dayEntriesForCell.length} entries`}
                      data-testid={`day-${day}`}
                    >
                      <span className="planner-day-number">{Number(day.slice(8))}</span>
                      {dayEntriesForCell.length > 0 && (
                        <span className="planner-day-dots" aria-hidden="true">
                          {dayEntriesForCell.slice(0, 4).map((entry) => (
                            <i key={entry.id} className={`planner-dot planner-dot-${entry.kind}`} />
                          ))}
                          {dayEntriesForCell.length > 4 && <small>+</small>}
                        </span>
                      )}
                    </button>
                  );
                })}
              </div>
            </div>

            <div className="planner-legend">
              {(["note", "event", "reminder"] as const).map((kind) => (
                <span key={kind}><i className={`planner-dot planner-dot-${kind}`} />{kindLabel[kind]}</span>
              ))}
              <span><i className="planner-dot planner-dot-today" />Today</span>
              {loading && <span role="status" className="planner-loading">Loading plans…</span>}
            </div>

            <aside className="planner-time-note">
              <CalendarDays aria-hidden="true" />
              <div>
                <strong>A small note about time</strong>
                <p>Times follow this device ({localTimeZone}).{siteTimeZone !== localTimeZone ? ` The site clock is set to ${siteTimeZone}; your planner stays local.` : ""}</p>
              </div>
            </aside>
          </section>

          <section className="planner-day-column">
            <div className="planner-section-heading planner-selected-heading">
              <div>
                <span className="planner-eyebrow">On this day</span>
                <h2 data-testid="text-selected-day">{selectedLabel}</h2>
              </div>
              <span className="planner-count">{dayEntries.length} {dayEntries.length === 1 ? "entry" : "entries"}</span>
            </div>

            <div className="planner-entry-list">
              {dayEntries.length === 0 ? (
                <div className="planner-empty" data-testid="planner-empty">
                  <StickyNote aria-hidden="true" />
                  <strong>{loading ? "One moment…" : "A little breathing room"}</strong>
                  <p>{loading ? "Your plans are on their way." : "Nothing here yet. Add a note, event, or reminder below."}</p>
                </div>
              ) : dayEntries.map((entry) => {
                const startsOnSameDay = entry.startsAt && dayKey(new Date(entry.startsAt)) === entry.day;
                return (
                  <article key={entry.id} className="planner-entry-card" data-testid={`entry-${entry.id}`}>
                    <span className={`planner-icon planner-icon-${entry.kind}`} aria-hidden="true">
                      {entry.kind === "note" ? <StickyNote /> : entry.kind === "event" ? <Clock3 /> : <Bell />}
                    </span>
                    <div className="planner-entry-content">
                      <div className="planner-entry-meta">
                        <span className={`planner-kind planner-kind-${entry.kind}`}>{kindLabel[entry.kind]}</span>
                        {entry.startsAt && <span className="planner-entry-time"><Clock3 aria-hidden="true" />{startsOnSameDay ? formatTime(entry.startsAt) : formatFull(entry.startsAt)}</span>}
                      </div>
                      <h3>{entry.title || "(untitled note)"}</h3>
                      {entry.notes && <p className="planner-entry-notes">{entry.notes}</p>}
                      {entry.remindAt && (
                        <p className="planner-entry-reminder">
                          <Bell aria-hidden="true" /> Remind {formatFull(entry.remindAt)}
                          {entry.dismissed ? " · dismissed" : entry.notifiedAt ? " · alert attempted" : ""}
                        </p>
                      )}
                    </div>
                    <div className="planner-entry-actions">
                      <button type="button" className="planner-icon-button" aria-label={`Edit ${entry.title || "note"}`} onClick={() => onEdit(entry)}>
                        <Pencil aria-hidden="true" />
                      </button>
                      <button type="button" className="planner-icon-button planner-delete-button" aria-label={`Delete ${entry.title || "note"}`} onClick={() => onDelete(entry)}>
                        <Trash2 aria-hidden="true" />
                      </button>
                    </div>
                  </article>
                );
              })}
            </div>

            <form className="planner-form-card" onSubmit={(event) => { event.preventDefault(); onSave(); }} data-testid="planner-form">
              <div className="planner-form-heading">
                <span className="planner-icon planner-icon-add"><Plus aria-hidden="true" /></span>
                <div>
                  <h3>{form.id === null ? "Make a note of it" : "Edit your entry"}</h3>
                  <p>{form.id === null ? "A note, a plan, or a gentle nudge." : "Your changes stay private."}</p>
                </div>
                <label className="sr-only" htmlFor="planner-kind">Entry type</label>
                <select
                  id="planner-kind"
                  className={`${fieldClass} planner-kind-select`}
                  value={form.kind}
                  onChange={(event) => onSetKind(event.target.value as PlannerKind)}
                  aria-label="Entry type"
                  data-testid="select-kind"
                >
                  <option value="note">Note</option>
                  <option value="event">Timed event</option>
                  <option value="reminder">Reminder</option>
                </select>
              </div>

              <div className="planner-fields">
                <input
                  className={fieldClass}
                  placeholder={form.kind === "note" ? "A title, if you like" : "Give it a title"}
                  maxLength={120}
                  value={form.title}
                  onChange={(event) => onFormChange({ title: event.target.value })}
                  aria-label="Title"
                  data-testid="input-title"
                />
                <textarea
                  className={`${fieldClass} planner-notes-field`}
                  placeholder="Add a few details…"
                  maxLength={5000}
                  value={form.notes}
                  onChange={(event) => onFormChange({ notes: event.target.value })}
                  aria-label="Notes"
                  data-testid="input-notes"
                />
                {form.kind === "event" && (
                  <label className="planner-field-label">
                    Starts
                    <input
                      type="datetime-local"
                      className={fieldClass}
                      value={form.startsAt}
                      onChange={(event) => onFormChange({ startsAt: event.target.value })}
                      data-testid="input-starts"
                    />
                  </label>
                )}
                {form.kind !== "reminder" && (
                  <label className="planner-checkbox">
                    <input
                      type="checkbox"
                      checked={form.remindOn}
                      onChange={(event) => onFormChange({
                        remindOn: event.target.checked,
                        remindAt: event.target.checked && !form.remindAt ? form.startsAt || `${selected}T09:00` : form.remindAt,
                      })}
                      data-testid="check-remind"
                    />
                    Remind me
                  </label>
                )}
                {(form.kind === "reminder" || form.remindOn) && (
                  <label className="planner-field-label">
                    Remind at
                    <input
                      type="datetime-local"
                      className={fieldClass}
                      value={form.remindAt}
                      onChange={(event) => onFormChange({ remindAt: event.target.value })}
                      data-testid="input-remind"
                    />
                  </label>
                )}
              </div>

              <div className="planner-form-actions">
                {form.id !== null || form.title || form.notes ? (
                  <button type="button" className="planner-button" onClick={onClear} disabled={saving}>
                    <X aria-hidden="true" />{form.id !== null ? "Cancel edit" : "Clear"}
                  </button>
                ) : <span />}
                <button type="submit" className="planner-button planner-button-primary" disabled={saving} data-testid="button-save-entry">
                  <Check aria-hidden="true" />{saving ? "Saving…" : form.id === null ? "Save entry" : "Save changes"}
                </button>
              </div>
            </form>

            {error && (
              <div role="alert" className="planner-alert planner-alert-error">
                <span>{error}</span>
                <button type="button" className="planner-button" onClick={onRetry}>Retry</button>
              </div>
            )}
            {status && <div role="status" className="planner-status" data-testid="text-planner-status">{status}</div>}

            <section className="planner-push-card">
              <div>
                <h3>Reminders on this device</h3>
                <p>Push alerts need browser permission and a subscription on this device. Delivery is best-effort; reminders are checked about every 30 seconds.</p>
              </div>
              <button type="button" className="planner-button planner-button-today" onClick={onEnablePush} disabled={pushBusy} data-testid="button-enable-push">
                <Bell aria-hidden="true" />{pushBusy ? "Enabling…" : "Enable push"}
              </button>
              {pushMsg && <p role="status" className={`planner-push-status ${pushMsg.ok ? "is-ok" : "is-error"}`} data-testid="text-push-status">{pushMsg.text}</p>}
            </section>
          </section>
        </main>
      </div>
    </div>
  );
}
