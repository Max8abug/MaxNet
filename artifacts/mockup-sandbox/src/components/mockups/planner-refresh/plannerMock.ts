import type {} from "react";

export interface PlannerEntry {
  id: number;
  kind: "note" | "event" | "reminder";
  title: string;
  notes: string;
  day: string;
  startsAt: string | null;
  remindAt: string | null;
  notifiedAt: string | null;
  dismissed: boolean;
}
export type PlannerInput = Pick<PlannerEntry, "kind" | "title" | "notes" | "day" | "startsAt" | "remindAt">;
const dayKey = (offset: number) => { const d = new Date(); d.setDate(d.getDate() + offset); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`; };
const at = (offset: number, hour: number, minute: number) => { const d = new Date(); d.setDate(d.getDate() + offset); d.setHours(hour, minute, 0, 0); return d.toISOString(); };
let items: PlannerEntry[] = [
  { id: 1, kind: "event", title: "Draft the site update", notes: "Collect the latest changes and prepare a short summary.", day: dayKey(0), startsAt: at(0, 10, 30), remindAt: null, notifiedAt: null, dismissed: false },
  { id: 2, kind: "note", title: "Photo gallery ideas", notes: "Review the new uploads and pick a few images for the front page.", day: dayKey(0), startsAt: null, remindAt: null, notifiedAt: null, dismissed: false },
  { id: 3, kind: "event", title: "Planner polish", notes: "Check calendar spacing and reminder flow.", day: dayKey(1), startsAt: at(1, 14, 0), remindAt: at(1, 13, 45), notifiedAt: null, dismissed: false },
  { id: 4, kind: "reminder", title: "Review the release notes", notes: "", day: dayKey(-1), startsAt: null, remindAt: at(-1, 16, 0), notifiedAt: null, dismissed: false },
];
let nextId = 5;
const copy = (entry: PlannerEntry): PlannerEntry => ({ ...entry });
export const fetchPlanner = async (month: string) => items.filter((entry) => entry.day.startsWith(month)).map(copy);
export const fetchDueReminders = async () => items.filter((entry) => entry.kind === "reminder" && !!entry.remindAt && new Date(entry.remindAt).getTime() <= Date.now() && !entry.dismissed).map(copy);
export const createPlannerEntry = async (input: PlannerInput) => { const entry: PlannerEntry = { ...input, id: nextId++, notifiedAt: null, dismissed: false }; items = [...items, entry]; return copy(entry); };
export const updatePlannerEntry = async (id: number, input: PlannerInput) => { const entry = { ...items.find((item) => item.id === id)!, ...input }; items = items.map((item) => item.id === id ? entry : item); return copy(entry); };
export const deletePlannerEntry = async (id: number) => { items = items.filter((entry) => entry.id !== id); return { ok: true }; };
export const dismissPlannerReminder = async (id: number) => { const entry = { ...items.find((item) => item.id === id)!, dismissed: true }; items = items.map((item) => item.id === id ? entry : item); return copy(entry); };
export function useAuth<T>(selector: (state: { user: { username: string } | null }) => T): T { return selector({ user: { username: "Sam" } }); }
export function useTimeZone(): string { return Intl.DateTimeFormat().resolvedOptions().timeZone; }
export async function enablePushNotifications(): Promise<{ ok: boolean; reason?: string }> { return { ok: true }; }