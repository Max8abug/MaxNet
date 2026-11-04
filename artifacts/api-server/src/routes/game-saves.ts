import { randomUUID } from "node:crypto";
import { createReadStream, createWriteStream } from "node:fs";
import { lstat, mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { Router, type RequestHandler } from "express";
import { Transform } from "node:stream";
import { pipeline } from "node:stream/promises";

const saveRoot = path.resolve(
  process.env["GAME_SAVE_DATA_DIR"] ||
    path.join(process.cwd(), "selfhost", "data", process.env["SERVE_STATIC"] === "1" ? "game-saves" : "game-saves-dev"),
);
const MAX_SAVE_BYTES = 128 * 1024;

function saveFile(userId: number, gameId: string) {
  if (!/^[a-z0-9-]{1,64}$/.test(gameId)) return null;
  return path.join(saveRoot, String(userId), `${gameId}.json`);
}

function saveBlobFile(userId: number, gameId: string, name: string) {
  if (!/^[a-z0-9-]{1,64}$/.test(gameId) || !["Saves.tar", "DevicePreferences.tar"].includes(name)) return null;
  return path.join(saveRoot, String(userId), gameId, "files", name);
}

function cleanStorage(value: unknown): Record<string, string> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const entries = Object.entries(value);
  if (entries.length > 512 || entries.some(([key, item]) =>
    key.length > 256 || typeof item !== "string" || item.length > MAX_SAVE_BYTES
  )) return null;
  const result = Object.fromEntries(entries) as Record<string, string>;
  return Buffer.byteLength(JSON.stringify(result)) <= MAX_SAVE_BYTES ? result : null;
}

export function createGameSavesRouter(requireAuth: RequestHandler) {
  const router = Router();
  router.get("/game-saves/:gameId/files/:name", requireAuth, async (req, res) => {
    const file = saveBlobFile(req.session.userId!, String(req.params.gameId), String(req.params.name));
    if (!file) return res.status(400).json({ error: "Invalid save file." });
    try {
      const info = await lstat(file);
      if (!info.isFile() || info.isSymbolicLink()) return res.status(404).end();
      res.status(200).set({
        "Content-Type": "application/octet-stream",
        "Content-Length": String(info.size),
        "Cache-Control": "no-store",
        "X-Content-Type-Options": "nosniff",
      });
      await pipeline(createReadStream(file), res);
      return;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return res.status(404).end();
      if (res.headersSent) return res.destroy(error as Error);
      throw error;
    }
  });
  router.put("/game-saves/:gameId/files/:name", requireAuth, async (req, res) => {
    const file = saveBlobFile(req.session.userId!, String(req.params.gameId), String(req.params.name));
    if (!file || !req.is("application/octet-stream")) return res.status(400).json({ error: "Invalid save file upload." });
    const expectedBytes = Number(req.get("x-save-file-size") ?? req.get("content-length") ?? 0);
    const maxBytes = 64 * 1024 * 1024;
    if (!Number.isFinite(expectedBytes) || expectedBytes < 0 || expectedBytes > maxBytes) {
      return res.status(413).json({ error: "Save files must be between 0 and 64 MiB." });
    }
    const temporary = `${file}.${randomUUID()}.tmp`;
    let bytes = 0;
    const sizeLimit = new Transform({
      transform(chunk: Buffer, _encoding, callback) {
        bytes += chunk.length;
        callback(bytes > maxBytes ? new Error("Save file exceeds 64 MiB.") : null, chunk);
      },
    });
    try {
      await mkdir(path.dirname(file), { recursive: true, mode: 0o700 });
      await pipeline(req, sizeLimit, createWriteStream(temporary, { flags: "wx", mode: 0o600 }));
      if (bytes !== expectedBytes) throw new Error("Upload ended before the complete save arrived.");
      await rename(temporary, file);
      return res.set("Cache-Control", "no-store").json({ ok: true, bytes });
    } catch (error) {
      await rm(temporary, { force: true }).catch(() => {});
      if (!res.headersSent) return res.status(400).json({ error: error instanceof Error ? error.message : "Save upload failed." });
      throw error;
    }
  });

  router.get("/game-saves/:gameId", requireAuth, async (req, res) => {
  const file = saveFile(req.session.userId!, String(req.params.gameId));
  if (!file) return res.status(400).json({ error: "Invalid game ID." });
  try {
    const storage = cleanStorage(JSON.parse(await readFile(file, "utf8")));
    return res.set("Cache-Control", "no-store").json({ storage: storage ?? {} });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return res.set("Cache-Control", "no-store").json({ storage: {} });
    }
    throw error;
  }
  });

  router.put("/game-saves/:gameId", requireAuth, async (req, res) => {
  const file = saveFile(req.session.userId!, String(req.params.gameId));
  const storage = cleanStorage(req.body?.storage);
  if (!file || !storage) return res.status(400).json({ error: "Invalid or oversized game save." });
  await mkdir(path.dirname(file), { recursive: true, mode: 0o700 });
  const temporary = `${file}.${randomUUID()}.tmp`;
  try {
    await writeFile(temporary, JSON.stringify(storage), { mode: 0o600, flag: "wx" });
    await rename(temporary, file);
    return res.set("Cache-Control", "no-store").json({ ok: true });
  } catch (error) {
    await rm(temporary, { force: true }).catch(() => {});
    throw error;
  }
  });

  return router;
}
