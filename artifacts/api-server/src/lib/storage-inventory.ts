import { lstat, readdir } from "node:fs/promises";
import path from "node:path";

export const INVENTORY_PREFIXES = ["wiki/", "user-sites/"] as const;

export interface StoredObject {
  key: string;
  sizeBytes?: number;
  changedAt?: Date;
  unsafe?: boolean;
}

// Do not follow symlinks, inspect file contents, create directories, or clean
// staging files. A missing configured root is an error, not an empty inventory.
export async function* listLocalObjects(root: string): AsyncGenerator<StoredObject> {
  const rootInfo = await lstat(root);
  if (!rootInfo.isDirectory() || rootInfo.isSymbolicLink()) {
    throw new Error("Storage inventory requires a real directory, not a symlink.");
  }
  async function* walk(key: string): AsyncGenerator<StoredObject> {
    const location = path.join(root, key);
    let info;
    try {
      info = await lstat(location);
    } catch (error) {
      // A cleanup may have finished just before the report acquired its lock.
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return;
      throw error;
    }
    if (info.isSymbolicLink()) {
      yield { key, unsafe: true };
    } else if (info.isDirectory()) {
      for (const entry of await readdir(location)) {
        yield* walk(`${key}/${entry}`);
      }
    } else if (info.isFile()) {
      yield {
        key, sizeBytes: info.size,
        changedAt: new Date(Math.max(info.mtimeMs, info.ctimeMs, info.birthtimeMs)),
      };
    } else {
      yield { key, unsafe: true };
    }
  }
  for (const prefix of INVENTORY_PREFIXES) yield* walk(prefix.slice(0, -1));
}

type ObjectLister = (options: { prefix: string; startOffset?: string; maxResults: number }) =>
  Promise<{ ok: true; value: { name: string }[] } | { ok: false; error: { message: string } }>;

export async function* listBucketObjects(list: ObjectLister): AsyncGenerator<StoredObject> {
  for (const prefix of INVENTORY_PREFIXES) {
    let startOffset: string | undefined;
    while (true) {
      const page = await list({ prefix, startOffset, maxResults: 1000 });
      if (!page.ok) throw new Error(`Storage inventory failed: ${page.error.message}`);
      if (!page.value.length) break;
      let last = startOffset;
      for (const object of page.value) {
        if (!object.name.startsWith(prefix) || (last !== undefined && object.name < last)) {
          throw new Error("Storage inventory returned an invalid or unordered page.");
        }
        // startOffset is inclusive. Never count its boundary twice.
        if (object.name === startOffset) continue;
        last = object.name;
        yield { key: object.name };
      }
      if (last === startOffset) break;
      startOffset = last;
    }
  }
}
