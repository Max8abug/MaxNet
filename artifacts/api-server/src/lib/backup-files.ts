import { createHash, randomUUID } from "node:crypto";
import { appendFile, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { tmpdir } from "node:os";
import { appStorage, storageScope } from "./app-storage";

export type FileManifest = { objectKey: string; size: number; sha256: string };
export const MAX_BACKUP_FILE_BYTES = 6 * 1024 * 1024;
export const digest = (bytes: Buffer) =>
  createHash("sha256").update(bytes).digest("hex");

export async function readBackupFile(objectKey: string, expectedSize: number) {
  const stream = appStorage.downloadAsStream(objectKey);
  const parts: Buffer[] = [];
  let size = 0;
  try {
    for await (const part of stream) {
      const bytes = Buffer.from(part);
      size += bytes.length;
      if (size > MAX_BACKUP_FILE_BYTES)
        throw new Error(`File ${objectKey} exceeds the backup file limit.`);
      parts.push(bytes);
    }
  } finally {
    stream.destroy();
  }
  if (size !== expectedSize)
    throw new Error(
      `File ${objectKey}: expected ${expectedSize} bytes, read ${size}.`,
    );
  const bytes = Buffer.concat(parts);
  return {
    objectKey,
    size,
    sha256: digest(bytes),
    dataBase64: bytes.toString("base64"),
  };
}

type StagedFile = FileManifest & { filename: string; received: number };
type FileSession = {
  username: string;
  scope: string;
  touched: number;
  files: Map<string, StagedFile>;
  directory: string;
  consumed: boolean;
};
const stages = new Map<string, FileSession>();
const sweep = setInterval(() => {
  for (const [id, stage] of stages) {
    if (!stage.consumed && Date.now() - stage.touched > 30 * 60_000) {
      stages.delete(id);
      void rm(stage.directory, { recursive: true, force: true });
    }
  }
}, 60_000);
sweep.unref();

export async function prepareFiles(
  username: string,
  manifest: unknown,
): Promise<string> {
  for (const [id, stage] of stages) {
    if (Date.now() - stage.touched > 30 * 60_000) {
      stages.delete(id);
      await rm(stage.directory, { recursive: true, force: true });
    }
  }
  // Only one staging directory per administrator; old preparations can
  // be discarded safely because no destination bytes have been written yet.
  for (const [id, stage] of stages)
    if (stage.username === username && !stage.consumed) {
      stages.delete(id);
      await rm(stage.directory, { recursive: true, force: true });
    }
  if (!Array.isArray(manifest)) throw new Error("Missing file manifest.");
  const files = new Map<string, StagedFile>();
  for (const file of manifest) {
    if (
      !file ||
      typeof file.objectKey !== "string" ||
      !file.objectKey ||
      !Number.isSafeInteger(file.size) ||
      file.size < 0 ||
      file.size > MAX_BACKUP_FILE_BYTES ||
      typeof file.sha256 !== "string" ||
      !/^[a-f0-9]{64}$/.test(file.sha256) ||
      files.has(file.objectKey)
    )
      throw new Error("Invalid or duplicate file manifest entry.");
    files.set(file.objectKey, { ...file, filename: randomUUID(), received: 0 });
  }
  const id = randomUUID();
  const directory = await mkdtemp(path.join(tmpdir(), "site-backup-files-"));
  stages.set(id, {
    username,
    scope: storageScope(),
    touched: Date.now(),
    files,
    directory,
    consumed: false,
  });
  return id;
}

function getStage(id: string, username: string) {
  const stage = stages.get(id);
  if (
    !stage ||
    stage.username !== username ||
    stage.consumed ||
    Date.now() - stage.touched > 30 * 60_000
  ) {
    throw new Error(
      "File preparation expired or unavailable; prepare the backup again.",
    );
  }
  if (stage.scope !== storageScope())
    throw new Error("Storage configuration changed during restore.");
  stage.touched = Date.now();
  return stage;
}

export async function acceptFileChunk(
  id: string,
  username: string,
  key: string,
  offset: number,
  encoded: string,
) {
  const stage = getStage(id, username);
  const file = stage.files.get(key);
  if (
    !file ||
    offset !== file.received ||
    typeof encoded !== "string" ||
    encoded.length > 1400000 ||
    encoded.length % 4 !== 0 ||
    !/^[A-Za-z0-9+/]*={0,2}$/.test(encoded)
  ) {
    throw new Error("Invalid file chunk or offset.");
  }
  const bytes = Buffer.from(encoded, "base64");
  if (bytes.toString("base64") !== encoded)
    throw new Error("Non-canonical base64 file chunk.");
  if (file.received + bytes.length > file.size)
    throw new Error("File exceeds its declared size.");
  await appendFile(path.join(stage.directory, file.filename), bytes);
  file.received += bytes.length;
  return file.received;
}

export async function materializeFiles(id: string, username: string) {
  const stage = getStage(id, username);
  // Prevent concurrent begin requests from materializing one preparation twice.
  stage.consumed = true;
  stages.delete(id);
  try {
    // Validate ALL bytes before writing anything or allowing database replacement.
    for (const file of stage.files.values()) {
      if (file.size === 0)
        await writeFile(
          path.join(stage.directory, file.filename),
          Buffer.alloc(0),
        );
      if (
        file.received !== file.size ||
        digest(await readFile(path.join(stage.directory, file.filename))) !==
          file.sha256
      ) {
        throw new Error(
          `Missing or corrupt file: ${file.objectKey}. Database not changed.`,
        );
      }
    }
    const mapping = new Map<string, string>();
    const sizes = new Map<string, number>();
    for (const file of stage.files.values()) {
      const key = `restores/${id}/${randomUUID()}`;
      const result = await appStorage.createFromBytes(
        key,
        await readFile(path.join(stage.directory, file.filename)),
      );
      if (!result.ok)
        throw new Error(
          `Could not restore file ${file.objectKey}: ${result.error.message}. Database not changed.`,
        );
      // Verify destination readback before accepting metadata pointing to it.
      const restored = await readBackupFile(key, file.size);
      if (restored.sha256 !== file.sha256)
        throw new Error(
          "Restored file checksum mismatch. Database not changed.",
        );
      mapping.set(file.objectKey, key);
      sizes.set(file.objectKey, file.size);
    }
    return { mapping, sizes };
  } finally {
    await rm(stage.directory, { recursive: true, force: true });
  }
}
