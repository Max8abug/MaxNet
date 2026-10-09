import type { Client, RequestError, Result } from "@replit/object-storage";
import { createReadStream } from "node:fs";
import { mkdir, rename, rm, unlink, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";

// Independent of the launch directory and Git checkout. Back this directory
// up alongside the database; database exports contain metadata, not file bytes.
function objectPath(key: string): string {
  const root = path.resolve(process.env.UPLOAD_STORAGE_DIR || path.join(homedir(), ".local/share/photo-desktop/uploads"));
  if (!key || key.includes("\\") || key.split("/").some((part) =>
    !part || part === "." || part === ".." || !/^[a-zA-Z0-9._%+-]+$/.test(part))) {
    throw new Error("Invalid storage object key.");
  }
  return path.join(root, key);
}

function failed(error: unknown): Result<null, RequestError> {
  return { ok: false, error: {
    message: error instanceof Error ? error.message : "Local file storage is unavailable.",
    statusCode: 503,
  } };
}

export const localStorage = {
  async uploadFromBytes(...[key, bytes]: Parameters<Client["uploadFromBytes"]>): Promise<Result<null, RequestError>> {
    let temporary: string | undefined;
    try {
      const destination = objectPath(key);
      await mkdir(path.dirname(destination), { recursive: true, mode: 0o700 });
      temporary = `${destination}.${randomUUID()}.tmp`;
      await writeFile(temporary, bytes, { flag: "wx", mode: 0o600 });
      await rename(temporary, destination);
      return { ok: true, value: null };
    } catch (error) {
      return failed(error);
    } finally {
      if (temporary) await rm(temporary, { force: true }).catch(() => {});
    }
  },
  async delete(...[key, options]: Parameters<Client["delete"]>): Promise<Result<null, RequestError>> {
    try {
      await unlink(objectPath(key));
      return { ok: true, value: null };
    } catch (error) {
      if (options?.ignoreNotFound && (error as NodeJS.ErrnoException).code === "ENOENT") {
        return { ok: true, value: null };
      }
      return failed(error);
    }
  },
  downloadAsStream(key: string) {
    return createReadStream(objectPath(key));
  },
};
