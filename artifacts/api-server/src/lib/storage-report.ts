import type { StoredObject } from "./storage-inventory";

export const MIN_REPORT_AGE_HOURS = 24;
export const MAX_REPORT_OBJECTS = 100_000;

export interface StorageReference {
  object_key: string;
  source: "wiki" | "hosted-site" | "cleanup";
  scope: string | null;
}

export async function classifyStorageInventory(
  objects: AsyncIterable<StoredObject>,
  references: StorageReference[],
  options: { scope: string; startedAt: Date; minAgeHours: number; maxObjects: number; signal?: AbortSignal },
) {
  if (!Number.isSafeInteger(options.minAgeHours) || options.minAgeHours < MIN_REPORT_AGE_HOURS ||
      !Number.isSafeInteger(options.maxObjects) || options.maxObjects < 1 || options.maxObjects > 1_000_000) {
    throw new Error("Invalid report limits.");
  }
  const live = new Set(references.filter(row => row.source !== "cleanup").map(row => row.object_key));
  // Even an intent for another storage scope is ambiguous; retain its object.
  const intents = new Set(references.filter(row => row.source === "cleanup").map(row => row.object_key));
  const candidates: StoredObject[] = [];
  const needsReview: (StoredObject & { reason: string })[] = [];
  const excluded = { referenced: 0, cleanupIntent: 0, recent: 0, temporaryOrUnsafe: 0 };
  let scanned = 0;
  const cutoff = options.startedAt.getTime() - options.minAgeHours * 3_600_000;
  for await (const object of objects) {
    options.signal?.throwIfAborted();
    if (++scanned > options.maxObjects) throw new Error("Inventory limit exceeded; no complete report produced.");
    const parts = object.key.split("/");
    if (object.unsafe || !["wiki", "user-sites"].includes(parts[0]) || parts.length < 3 ||
        parts.some(part => !part || part.startsWith(".") || part.endsWith(".tmp") ||
          !/^[a-zA-Z0-9._%+-]+$/.test(part))) {
      excluded.temporaryOrUnsafe++;
    } else if (live.has(object.key)) {
      excluded.referenced++;
    } else if (intents.has(object.key)) {
      excluded.cleanupIntent++;
    } else if (!object.changedAt || !Number.isFinite(object.changedAt.getTime())) {
      needsReview.push({ ...object, reason: "Object age is unavailable; cannot exclude recent unjournaled writes." });
    } else if (object.changedAt.getTime() > cutoff) {
      excluded.recent++;
    } else {
      candidates.push(object);
    }
  }
  return {
    readOnly: true,
    complete: true,
    scope: options.scope,
    startedAt: options.startedAt.toISOString(),
    minimumAgeHours: options.minAgeHours,
    scanned,
    databaseReferences: live.size,
    cleanupIntents: {
      currentScope: references.filter(row => row.source === "cleanup" && row.scope === options.scope).length,
      otherScopes: references.filter(row => row.source === "cleanup" && row.scope !== options.scope).length,
    },
    excluded,
    candidates,
    needsReview,
    warnings: [
      "Candidates are possible legacy leftovers, not proof that an object is safe to delete.",
      "No files, database records, or cleanup intents were changed. No deletion is offered.",
      "References cover wiki assets and hosted-site files, not external copies or other applications.",
      "Only wiki/ and user-sites/ namespaces are inventoried. Restore namespaces and unrelated files are outside this report.",
      "Current journaled writers are excluded. Older servers and external filesystem writers must be stopped before relying on this report.",
    ],
  };
}
