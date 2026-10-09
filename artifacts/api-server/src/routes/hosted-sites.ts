import { Router, type IRouter, type Request, type Response } from "express";
import { randomUUID } from "node:crypto";
import path from "node:path";
import { appStorage as storage } from "../lib/app-storage";
import { asc, and, eq, sql } from "drizzle-orm";
import { db, hostedSiteFilesTable, hostedSitesTable } from "@workspace/db";
import { logger } from "../lib/logger";
import { requireAuth } from "../lib/auth";
import { getUserPermissions, getUserSiteStorageLimitBytes } from "./ranks";
import { lockStorage, trackUpload, queueCleanup, cleanupAfterMutation } from "../lib/storage-mutations";

const router: IRouter = Router();
const MAX_FILE_BYTES = 6 * 1024 * 1024;

const CONTENT_TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".htm": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".mjs": "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".txt": "text/plain; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".ico": "image/x-icon",
  ".mp4": "video/mp4",
  ".webm": "video/webm",
  ".mp3": "audio/mpeg",
  ".ogg": "audio/ogg",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".ttf": "font/ttf",
  ".otf": "font/otf",
};

class SiteQuotaError extends Error {}
class SiteStorageError extends Error {}

function cleanSitePath(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const value = raw.trim();
  if (
    !value
    || value.length > 180
    || value.startsWith("/")
    || value.includes("\\")
    || value.includes("%")
    || value.split("/").some((part) => !part || part === "." || part === ".." || !/^[a-zA-Z0-9._-]+$/.test(part))
  ) return null;
  return value;
}

function canManage(req: Request, username: string): boolean {
  return req.session.username === username || !!req.session.isAdmin;
}

async function capabilities(username: string) {
  const permissions = await getUserPermissions(username);
  return {
    canCreate: permissions.includes("createHtmlPage"),
    canRunJs: permissions.includes("createHtmlPage") && permissions.includes("runHtmlPageJs"),
    quotaBytes: await getUserSiteStorageLimitBytes(username),
  };
}

async function loadSiteSummary(username: string) {
  const [site] = await db.select().from(hostedSitesTable).where(eq(hostedSitesTable.username, username)).limit(1);
  const files = await db.select({
    path: hostedSiteFilesTable.path,
    contentType: hostedSiteFilesTable.contentType,
    size: hostedSiteFilesTable.size,
    updatedAt: hostedSiteFilesTable.updatedAt,
  }).from(hostedSiteFilesTable)
    .where(eq(hostedSiteFilesTable.username, username))
    .orderBy(asc(hostedSiteFilesTable.path));
  return { site, files, totalBytes: files.reduce((sum, file) => sum + file.size, 0) };
}

async function uploadObject(key: string, bytes: Buffer): Promise<void> {
  const result = await storage.uploadFromBytes(key, bytes, { compress: false });
  if (!result.ok) {
    logger.error({ error: result.error }, "Hosted site upload failed");
    throw new SiteStorageError("App Storage is unavailable.");
  }
}

async function pipeObject(objectKey: string, res: Response) {
  const stream = storage.downloadAsStream(objectKey);
  stream.on("error", (error) => {
    logger.warn({ err: error }, "Hosted site file download failed");
    if (!res.headersSent) res.status(502).end();
    else res.destroy();
  });
  stream.pipe(res);
}

router.get("/custom-sites/:username", async (req, res) => {
  const username = String(req.params.username || "");
  const owner = canManage(req, username);
  const [site] = await db.select().from(hostedSitesTable).where(eq(hostedSitesTable.username, username)).limit(1);
  if (!site) {
    if (!owner) {
      res.json({ exists: false, active: false });
      return;
    }
    const access = await capabilities(username);
    res.json({ exists: false, active: false, files: [], totalBytes: 0, ...access });
    return;
  }
  if (!owner) {
    res.json({ exists: true, active: site.active, entryPath: site.entryPath, updatedAt: site.updatedAt });
    return;
  }
  const summary = await loadSiteSummary(username);
  const access = await capabilities(username);
  res.json({
    exists: true,
    active: site.active,
    entryPath: site.entryPath,
    updatedAt: site.updatedAt,
    files: summary.files,
    totalBytes: summary.totalBytes,
    ...access,
  });
});

router.post("/custom-sites/:username", requireAuth, async (req, res) => {
  const username = String(req.params.username || "");
  if (!canManage(req, username)) {
    res.status(403).json({ error: "You can only manage your own site." });
    return;
  }
  const access = await capabilities(username);
  if (!access.canCreate) {
    res.status(403).json({ error: "Your rank does not have permission to create an HTML page." });
    return;
  }
  await db.transaction(async tx => {
    await lockStorage(tx, username);
    await tx.insert(hostedSitesTable).values({ username, active: false, entryPath: "index.html" }).onConflictDoNothing();
  });
  const summary = await loadSiteSummary(username);
  res.status(201).json({
    exists: true,
    active: summary.site?.active ?? false,
    entryPath: summary.site?.entryPath ?? "index.html",
    updatedAt: summary.site?.updatedAt ?? new Date(),
    files: summary.files,
    totalBytes: summary.totalBytes,
    ...access,
  });
});

router.patch("/custom-sites/:username", requireAuth, async (req, res) => {
  const username = String(req.params.username || "");
  if (!canManage(req, username)) {
    res.status(403).json({ error: "You can only manage your own site." });
    return;
  }
  const access = await capabilities(username);
  const updated = await db.transaction(async tx => {
    await lockStorage(tx, username);
    const [site] = await tx.select().from(hostedSitesTable).where(eq(hostedSitesTable.username, username)).limit(1);
    if (!site) {
      res.status(404).json({ error: "Create your site before changing its settings." });
      return;
    }
    const active = typeof req.body?.active === "boolean" ? req.body.active : site.active;
    const entryPath = req.body?.entryPath === undefined ? site.entryPath : cleanSitePath(req.body.entryPath);
    if (!entryPath) {
      res.status(400).json({ error: "The entry file path is invalid." });
      return;
    }
    if (active && !access.canCreate) {
      res.status(403).json({ error: "Your rank no longer has permission to publish an HTML page." });
      return;
    }
    if (active) {
      const [entry] = await tx.select({ id: hostedSiteFilesTable.id })
        .from(hostedSiteFilesTable)
        .where(and(
          eq(hostedSiteFilesTable.username, username),
          eq(hostedSiteFilesTable.path, entryPath),
          eq(hostedSiteFilesTable.contentType, "text/html; charset=utf-8"),
        ))
        .limit(1);
      if (!entry) {
        res.status(400).json({ error: "Upload the selected HTML entry file before publishing." });
        return;
      }
    }
    const [updated] = await tx.update(hostedSitesTable)
      .set({ active, entryPath, updatedAt: new Date() })
      .where(eq(hostedSitesTable.username, username))
      .returning();
    return updated;
  });
  if (updated) res.json({ exists: true, active: updated.active, entryPath: updated.entryPath, updatedAt: updated.updatedAt });
});

router.put("/custom-sites/:username/file", requireAuth, async (req, res) => {
  const username = String(req.params.username || "");
  if (!canManage(req, username)) {
    res.status(403).json({ error: "You can only manage your own site." });
    return;
  }
  const access = await capabilities(username);
  if (!access.canCreate) {
    res.status(403).json({ error: "Your rank does not have permission to create an HTML page." });
    return;
  }
  if (access.quotaBytes <= 0) {
    res.status(403).json({ error: "Your rank does not have storage available for a hosted site." });
    return;
  }
  const filePath = cleanSitePath(req.body?.path);
  if (!filePath) {
    res.status(400).json({ error: "Use a relative file path containing only letters, numbers, dots, dashes, and underscores." });
    return;
  }
  const extension = path.extname(filePath).toLowerCase();
  const contentType = CONTENT_TYPES[extension];
  if (!contentType) {
    res.status(415).json({ error: "Unsupported file type. Upload HTML, CSS, JavaScript, media, fonts, JSON, or text files." });
    return;
  }
  if ((extension === ".js" || extension === ".mjs") && !access.canRunJs) {
    res.status(403).json({ error: "Your rank does not have permission to upload JavaScript." });
    return;
  }
  const encoded = req.body?.dataBase64;
  // Bound before decoding, and avoid repeated regex capture groups: on
  // multi-megabyte uploads V8 can overflow its regex backtracking stack.
  if (typeof encoded === "string" && encoded.length > Math.ceil(MAX_FILE_BYTES / 3) * 4) {
    res.status(413).json({ error: "Each file must be between 1 byte and 6 MB." });
    return;
  }
  if (typeof encoded !== "string" || encoded.length % 4 !== 0 || !/^[A-Za-z0-9+/]*={0,2}$/.test(encoded)) {
    res.status(400).json({ error: "A base64 file body is required." });
    return;
  }
  const bytes = Buffer.from(encoded, "base64");
  if (bytes.length === 0 || bytes.length > MAX_FILE_BYTES) {
    res.status(413).json({ error: "Each file must be between 1 byte and 6 MB." });
    return;
  }

  // URL encoding leaves punctuation (and dot-only names) unchanged. Use a
  // path-safe, reversible namespace for every username. Existing file keys
  // remain valid because reads/deletes use the key saved in the database.
  const ownerKey = Buffer.from(username, "utf8").toString("base64url");
  const objectKey = `user-sites/${ownerKey}/${randomUUID()}`;
  let oldKey: string | null = null;
  try {
    await db.transaction(async (tx) => {
      await lockStorage(tx, username);
      await tx.insert(hostedSitesTable).values({ username, active: false, entryPath: "index.html" }).onConflictDoNothing();
      const [site] = await tx.select().from(hostedSitesTable)
        .where(eq(hostedSitesTable.username, username))
        .for("update")
        .limit(1);
      if (!site) throw new Error("Hosted site could not be initialized.");
      const [previous] = await tx.select().from(hostedSiteFilesTable).where(and(
        eq(hostedSiteFilesTable.username, username),
        eq(hostedSiteFilesTable.path, filePath),
      )).limit(1);
      const [usage] = await tx.select({
        bytes: sql<number>`coalesce(sum(${hostedSiteFilesTable.size}), 0)`,
      }).from(hostedSiteFilesTable).where(eq(hostedSiteFilesTable.username, username));
      const usedBytes = Number(usage?.bytes ?? 0) - (previous?.size ?? 0);
      if (usedBytes + bytes.length > access.quotaBytes) throw new SiteQuotaError("Rank storage limit exceeded.");

      await trackUpload(username, objectKey);
      await uploadObject(objectKey, bytes);
      oldKey = previous?.objectKey ?? null;
      await tx.insert(hostedSiteFilesTable).values({
        username,
        path: filePath,
        objectKey,
        contentType,
        size: bytes.length,
        updatedAt: new Date(),
      }).onConflictDoUpdate({
        target: [hostedSiteFilesTable.username, hostedSiteFilesTable.path],
        set: { objectKey, contentType, size: bytes.length, updatedAt: new Date() },
      });
      await tx.update(hostedSitesTable).set({ updatedAt: new Date() })
        .where(eq(hostedSitesTable.username, username));
      if (oldKey) await queueCleanup(tx, username, oldKey);
    });
  } catch (error) {
    await cleanupAfterMutation([objectKey]);
    if (error instanceof SiteQuotaError) {
      res.status(413).json({ error: "This upload would exceed your rank's hosted-site storage limit." });
      return;
    }
    if (error instanceof SiteStorageError) {
      res.status(503).json({ error: "File storage is unavailable. Check the server's upload directory or App Storage setup and retry." });
      return;
    }
    throw error;
  }
  await cleanupAfterMutation([objectKey, ...(oldKey ? [oldKey] : [])]);
  res.json({ ok: true, path: filePath, contentType, size: bytes.length });
});

router.delete("/custom-sites/:username/file", requireAuth, async (req, res) => {
  const username = String(req.params.username || "");
  if (!canManage(req, username)) {
    res.status(403).json({ error: "You can only manage your own site." });
    return;
  }
  const filePath = cleanSitePath(req.body?.path);
  if (!filePath) {
    res.status(400).json({ error: "Invalid file path." });
    return;
  }
  let objectKey: string | undefined;
  await db.transaction(async (tx) => {
    await lockStorage(tx, username);
    const [file] = await tx.select().from(hostedSiteFilesTable).where(and(
      eq(hostedSiteFilesTable.username, username),
      eq(hostedSiteFilesTable.path, filePath),
    )).limit(1);
    if (!file) {
      res.status(404).json({ error: "File not found." });
      return;
    }
    objectKey = file.objectKey;
    await queueCleanup(tx, username, file.objectKey);
    await tx.delete(hostedSiteFilesTable).where(eq(hostedSiteFilesTable.id, file.id));
    await tx.update(hostedSitesTable).set({
      active: false,
      updatedAt: new Date(),
    }).where(and(
      eq(hostedSitesTable.username, username),
      eq(hostedSitesTable.entryPath, filePath),
    ));
  });
  if (!objectKey) return;
  await cleanupAfterMutation([objectKey]);
  res.json({ ok: true });
});

router.delete("/custom-sites/:username", requireAuth, async (req, res) => {
  const username = String(req.params.username || "");
  if (!canManage(req, username)) {
    res.status(403).json({ error: "You can only manage your own site." });
    return;
  }
  const keys: string[] = [];
  await db.transaction(async tx => {
    await lockStorage(tx, username);
    const files = await tx.select().from(hostedSiteFilesTable).where(eq(hostedSiteFilesTable.username, username));
    for (const file of files) {
      await queueCleanup(tx, username, file.objectKey);
      keys.push(file.objectKey);
    }
    await tx.delete(hostedSiteFilesTable).where(eq(hostedSiteFilesTable.username, username));
    await tx.delete(hostedSitesTable).where(eq(hostedSitesTable.username, username));
  });
  await cleanupAfterMutation(keys);
  res.json({ ok: true });
});

router.get("/custom-sites/:username/*sitePath", async (req, res) => {
  const username = String(req.params.username || "");
  const rawPath = req.params.sitePath;
  const filePath = cleanSitePath(Array.isArray(rawPath) ? rawPath.join("/") : rawPath);
  if (!filePath) {
    res.status(400).end();
    return;
  }
  const [site] = await db.select().from(hostedSitesTable).where(eq(hostedSitesTable.username, username)).limit(1);
  if (!site?.active) {
    res.status(404).end();
    return;
  }
  const [file] = await db.select().from(hostedSiteFilesTable).where(and(
    eq(hostedSiteFilesTable.username, username),
    eq(hostedSiteFilesTable.path, filePath),
  )).limit(1);
  if (!file) {
    res.status(404).end();
    return;
  }
  const permissions = await getUserPermissions(username);
  if (!permissions.includes("createHtmlPage")) {
    res.status(404).end();
    return;
  }
  const scriptsAllowed = permissions.includes("createHtmlPage") && permissions.includes("runHtmlPageJs");
  const isHtml = file.contentType.startsWith("text/html");
  res.setHeader("Content-Type", file.contentType);
  res.setHeader("Content-Length", String(file.size));
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Cross-Origin-Resource-Policy", "cross-origin");
  res.setHeader("Referrer-Policy", "no-referrer");
  res.setHeader("Cache-Control", "private, max-age=0, no-cache");
  if (isHtml) {
    res.setHeader(
      "Content-Security-Policy",
      [
        "sandbox allow-scripts",
        "default-src 'none'",
        `script-src ${scriptsAllowed ? "'self' 'unsafe-inline'" : "'none'"}`,
        "style-src 'self' 'unsafe-inline' https:",
        "img-src 'self' data: blob: https:",
        "media-src 'self' data: blob: https:",
        "font-src 'self' data: https:",
        "connect-src 'none'",
        "form-action 'none'",
        "frame-src 'none'",
        "object-src 'none'",
        "base-uri 'self'",
        "frame-ancestors 'self'",
      ].join("; "),
    );
  }
  await pipeObject(file.objectKey, res);
});

export default router;
