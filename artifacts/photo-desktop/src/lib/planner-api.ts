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
async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`/api/planner${path}`, {
    ...init, credentials: "include", headers: { "Content-Type": "application/json" },
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || "Could not update your planner.");
  return data as T;
}
export const fetchPlanner = (month: string) => request<PlannerEntry[]>(`?month=${encodeURIComponent(month)}`);
export const fetchDueReminders = () => request<PlannerEntry[]>("?due=1");
export const createPlannerEntry = (input: PlannerInput) => request<PlannerEntry>("", { method: "POST", body: JSON.stringify(input) });
export const updatePlannerEntry = (id: number, input: PlannerInput) => request<PlannerEntry>(`/${id}`, { method: "PUT", body: JSON.stringify(input) });
export const deletePlannerEntry = (id: number) => request<{ ok: boolean }>(`/${id}`, { method: "DELETE" });
export const dismissPlannerReminder = (id: number) => request<PlannerEntry>(`/${id}/dismiss`, { method: "PUT" });
