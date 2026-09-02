import { useSyncExternalStore } from "react";

const STORAGE_KEY = "portfolio98-time-zone";
const listeners = new Set<() => void>();
export const SITE_DEFAULT_TIME_ZONE = "America/New_York";

function browserTimeZone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  } catch {
    return "UTC";
  }
}

export function isValidTimeZone(value: string): boolean {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: value }).format();
    return true;
  } catch {
    return false;
  }
}

function readStoredTimeZone(): string {
  if (typeof window === "undefined") return SITE_DEFAULT_TIME_ZONE;
  const stored = window.localStorage.getItem(STORAGE_KEY);
  return stored && isValidTimeZone(stored) ? stored : SITE_DEFAULT_TIME_ZONE;
}

let activeTimeZone = readStoredTimeZone();

export const TIME_ZONE_OPTIONS = [
  { value: "", label: "Site default (Eastern Time)" },
  { value: "UTC", label: "UTC" },
  { value: "America/New_York", label: "Eastern Time (New York)" },
  { value: "America/Chicago", label: "Central Time (Chicago)" },
  { value: "America/Denver", label: "Mountain Time (Denver)" },
  { value: "America/Los_Angeles", label: "Pacific Time (Los Angeles)" },
  { value: "Europe/London", label: "United Kingdom (London)" },
  { value: "Europe/Berlin", label: "Central Europe (Berlin)" },
  { value: "Asia/Kolkata", label: "India (Kolkata)" },
  { value: "Asia/Tokyo", label: "Japan (Tokyo)" },
  { value: "Australia/Sydney", label: "Australia (Sydney)" },
] as const;

export function getTimeZone(): string {
  return activeTimeZone;
}

export function setTimeZone(value: string | null | undefined): void {
  const next = value && isValidTimeZone(value) ? value : SITE_DEFAULT_TIME_ZONE;
  if (next === activeTimeZone) return;
  activeTimeZone = next;
  if (typeof window !== "undefined") {
    if (value && isValidTimeZone(value)) window.localStorage.setItem(STORAGE_KEY, next);
    else window.localStorage.removeItem(STORAGE_KEY);
  }
  listeners.forEach((listener) => listener());
}

export function subscribeTimeZone(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function useTimeZone(): string {
  return useSyncExternalStore(subscribeTimeZone, getTimeZone, () => SITE_DEFAULT_TIME_ZONE);
}