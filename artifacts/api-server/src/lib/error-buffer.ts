/**
 * In-memory ring buffer of the most recent unhandled errors that hit the
 * central error handler in `app.ts`. Used to power the admin-only
 * diagnostics window so the site owner can see what's failing on the live
 * server without having to read raw container logs (which are not always
 * available, e.g. when the production host is outside Replit).
 *
 * Intentionally in-memory only:
 *   - Avoids adding yet another DB table that could itself fail and
 *     trigger a recursive error.
 *   - Errors are typically transient; a fresh deploy clears them.
 *   - Capped at MAX_ENTRIES so a high-volume failure cannot exhaust
 *     memory.
 */

export interface ErrorEntry {
  id: number;
  timestamp: string; // ISO
  method: string;
  url: string;
  message: string;
  stack: string | null;
  /** Username of the requester if signed in, otherwise null. */
  user: string | null;
}

const MAX_ENTRIES = 100;

let nextId = 1;
const buffer: ErrorEntry[] = [];

export function recordError(entry: Omit<ErrorEntry, "id" | "timestamp">): void {
  buffer.unshift({
    id: nextId++,
    timestamp: new Date().toISOString(),
    ...entry,
  });
  if (buffer.length > MAX_ENTRIES) buffer.length = MAX_ENTRIES;
}

export function listErrors(): ErrorEntry[] {
  // Return a shallow copy so callers can't mutate the internal array.
  return buffer.slice();
}

export function clearErrors(): void {
  buffer.length = 0;
}
