import { Client, type Result, type RequestError } from "@replit/object-storage";
import { PassThrough } from "node:stream";
import { localStorage } from "./local-storage";
import path from "node:path";
import { homedir } from "node:os";

function backend(): "local" | "replit" {
  const value = process.env.STORAGE_BACKEND || (process.env.SERVE_STATIC === "1" ? "local" : "replit");
  if (value !== "local" && value !== "replit") throw new Error("STORAGE_BACKEND must be local or replit.");
  return value;
}

// Cleanup must never switch buckets/directories when a server's configuration changes.
export function storageScope(): string {
  return backend() === "local"
    ? `local:${path.resolve(process.env.UPLOAD_STORAGE_DIR || path.join(homedir(), ".local/share/photo-desktop/uploads"))}`
    : "replit";
}

let ready: Promise<Client> | undefined;

function getClient(): Promise<Client> {
  if (!ready) {
    ready = (async () => {
      const client = new Client();
      // Immediately await initialization so a missing bucket cannot produce
      // an unhandled rejection in the SDK's constructor.
      const result = await client.list({ maxResults: 1 });
      if (!result.ok) throw new Error(result.error.message);
      return client;
    })().catch((error) => {
      ready = undefined;
      throw error;
    });
  }
  return ready;
}

function unavailable(error: unknown): Result<null, RequestError> {
  return {
    ok: false,
    error: {
      message: error instanceof Error ? error.message : "App Storage is unavailable.",
      statusCode: 503,
    },
  };
}

export const appStorage = {
  async uploadFromBytes(...args: Parameters<Client["uploadFromBytes"]>) {
    try {
      if (backend() === "local") return await localStorage.uploadFromBytes(...args);
      return await (await getClient()).uploadFromBytes(...args);
    } catch (error) {
      return unavailable(error);
    }
  },
  async delete(...args: Parameters<Client["delete"]>) {
    try {
      if (backend() === "local") return await localStorage.delete(...args);
      return await (await getClient()).delete(...args);
    } catch (error) {
      return unavailable(error);
    }
  },
  downloadAsStream(objectKey: string) {
    const output = new PassThrough();
    void Promise.resolve().then(async () => backend() === "local" ? localStorage : await getClient()).then((client) => {
      const source = client.downloadAsStream(objectKey);
      source.on("error", (error) => output.destroy(error));
      output.on("close", () => source.destroy());
      source.pipe(output);
    }).catch((error) => output.destroy(error));
    return output;
  },
};
