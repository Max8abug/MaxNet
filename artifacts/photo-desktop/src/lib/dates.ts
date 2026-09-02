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

export function formatLocalDate(value: string | number | Date, options?: Intl.DateTimeFormatOptions): string {
  const date = parseServerDate(value);
  return Number.isNaN(date.getTime()) ? String(value) : date.toLocaleString(undefined, options);
}

export function formatLocalTime(value: string | number | Date): string {
  return formatLocalDate(value, { hour: "2-digit", minute: "2-digit" });
}

export function siteDateKey(value: string | number | Date): string {
  const date = parseServerDate(value);
  if (Number.isNaN(date.getTime())) return "";
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}