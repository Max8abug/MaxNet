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

/**
 * Serialise an error including its `cause` chain. Drizzle wraps Postgres
 * errors so the outer message is just "Failed query: ..." while the actual
 * "column does not exist" / "violates not-null" / etc. lives on
 * `error.cause`. Without unwrapping we lose the only useful piece of
 * information.
 */
export function describeError(err: unknown): { message: string; stack: string | null } {
  const messages: string[] = [];
  const stacks: string[] = [];
  let cur: unknown = err;
  let depth = 0;
  // Cap depth so a self-referential cause can't loop forever.
  while (cur != null && depth < 5) {
    if (cur instanceof Error) {
      messages.push(cur.message);
      if (cur.stack) stacks.push(cur.stack);
      cur = (cur as { cause?: unknown }).cause;
    } else {
      messages.push(String(cur));
      cur = null;
    }
    depth++;
  }
  // Also pull a few common Postgres error fields if present on the root
  // error or any cause — `code`, `detail`, `hint`, `constraint`, `column`,
  // `table` are extremely useful for diagnosing schema mismatches.
  const pgFields: string[] = [];
  cur = err;
  depth = 0;
  while (cur != null && depth < 5) {
    if (typeof cur === "object") {
      const o = cur as Record<string, unknown>;
      for (const f of ["code", "detail", "hint", "constraint", "column", "table", "schema", "routine"]) {
        const v = o[f];
        if (v != null && v !== "") pgFields.push(`${f}=${String(v)}`);
      }
      cur = (o as { cause?: unknown }).cause;
    } else {
      cur = null;
    }
    depth++;
  }
  let message = messages.join(" | caused by: ");
  if (pgFields.length) message += `\n[pg: ${Array.from(new Set(pgFields)).join(", ")}]`;
  return {
    message: message || "Unknown error",
    stack: stacks.length ? stacks.join("\n--- caused by ---\n") : null,
  };
}
