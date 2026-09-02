export function parseServerDate(value: string | number | Date): Date {
  if (value instanceof Date) return value;
  if (typeof value === "number") return new Date(value);
  const text = String(value);
  // PostgreSQL timestamp columns are stored as UTC but older API responses
  // may omit the timezone suffix. Treat those as UTC instead of letting the
  // browser reinterpret them as local time.
  if (/^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}:\d{2}(?:\.\d+)?$/.test(text)) {
    return new Date(`${text.replace(" ", "T")}Z`);
  }
  return new Date(text);
}

// Keep site timestamps consistent with the site's primary audience instead of
// depending on the timezone of the Replit preview/browser process. Intl applies
// daylight-saving changes for this IANA zone automatically.
const SITE_TIME_ZONE = "America/New_York";

export function formatLocalDate(value: string | number | Date, options?: Intl.DateTimeFormatOptions): string {
  const date = parseServerDate(value);
  return Number.isNaN(date.getTime())
    ? String(value)
    : date.toLocaleString(undefined, { timeZone: SITE_TIME_ZONE, ...options });
}

export function formatLocalTime(value: string | number | Date): string {
  return formatLocalDate(value, { hour: "2-digit", minute: "2-digit" });
}

export function siteDateKey(value: string | number | Date): string {
  const date = parseServerDate(value);
  if (Number.isNaN(date.getTime())) return "";
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: SITE_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
}