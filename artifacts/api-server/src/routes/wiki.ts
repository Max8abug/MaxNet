import { Router, type IRouter, type RequestHandler } from "express";
import { randomUUID } from "node:crypto";
import path from "node:path";
import { appStorage as storage } from "../lib/app-storage";
import { asc, eq } from "drizzle-orm";
import { db, wikiAssetsTable, wikiPagesTable } from "@workspace/db";
import { logger } from "../lib/logger";
import { requireAuth } from "../lib/auth";
import { getUserPermissions } from "./ranks";

const router: IRouter = Router();
const MAX_WIKI_MEDIA_BYTES = 6 * 1024 * 1024;
const MEDIA_TYPES = new Set([
  "image/png", "image/jpeg", "image/gif", "image/webp",
  "video/mp4", "video/webm",
]);

const requireWikiEditor: RequestHandler = async (req, res, next) => {
  const permissions = await getUserPermissions(req.session.username);
  if (!permissions.includes("editWiki")) {
    res.status(403).json({ error: "Your rank does not have permission to edit the wiki." });
    return;
  }
  next();
};

function makeSlug(value: string): string {
  return value
    .normalize("NFKD")
    .toLowerCase()
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
}

function cleanFileName(value: unknown): string {
  const raw = typeof value === "string" ? path.basename(value) : "attachment";
  return raw.replace(/[^a-zA-Z0-9._-]/g, "-").slice(0, 100) || "attachment";
}

function parseMediaDataUrl(value: unknown): { contentType: string; bytes: Buffer } | null {
  if (typeof value !== "string") return null;
  const match = /^data:([a-z0-9/+.-]+);base64,([A-Za-z0-9+/]*={0,2})$/i.exec(value);
  if (!match || !MEDIA_TYPES.has(match[1].toLowerCase())) return null;
  const bytes = Buffer.from(match[2], "base64");
  if (bytes.length === 0 || bytes.length > MAX_WIKI_MEDIA_BYTES) return null;
  return { contentType: match[1].toLowerCase(), bytes };
}

router.get("/wiki/pages", async (_req, res) => {
  const pages = await db.select({
    slug: wikiPagesTable.slug,
    title: wikiPagesTable.title,
    updatedBy: wikiPagesTable.updatedBy,
    updatedAt: wikiPagesTable.updatedAt,
    content: wikiPagesTable.content,
  }).from(wikiPagesTable).orderBy(asc(wikiPagesTable.title));
  res.json(pages.map(({ content, ...page }) => ({
    ...page,
    excerpt: content.replace(/[#*_`>\[\]()!-]/g, "").replace(/\s+/g, " ").trim().slice(0, 180),
  })));
});

router.get("/wiki/pages/:slug", async (req, res) => {
  const slug = String(req.params.slug || "");
  const [page] = await db.select().from(wikiPagesTable).where(eq(wikiPagesTable.slug, slug)).limit(1);
  if (!page) {
    res.status(404).json({ error: "Wiki page not found" });
    return;
  }
  const assets = await db.select({
    id: wikiAssetsTable.id,
    fileName: wikiAssetsTable.fileName,
    contentType: wikiAssetsTable.contentType,
    size: wikiAssetsTable.size,
    uploadedBy: wikiAssetsTable.uploadedBy,
    createdAt: wikiAssetsTable.createdAt,
  }).from(wikiAssetsTable).where(eq(wikiAssetsTable.pageSlug, slug));
  res.json({ page, assets: assets.map((asset) => ({
    ...asset,
    url: `/api/wiki/assets/${asset.id}`,
  })) });
});

router.post("/wiki/pages", requireAuth, requireWikiEditor, async (req, res) => {
  const title = typeof req.body?.title === "string" ? req.body.title.trim().slice(0, 100) : "";
  const content = typeof req.body?.content === "string" ? req.body.content : "";
  const slug = makeSlug(typeof req.body?.slug === "string" ? req.body.slug : title);
  if (!title || !slug) {
    res.status(400).json({ error: "A page title is required." });
    return;
  }
  if (content.length > 100_000) {
    res.status(413).json({ error: "Wiki page content is too large." });
    return;
  }
  try {
    const [page] = await db.insert(wikiPagesTable).values({
      slug,
      title,
      content,
      createdBy: req.session.username!,
      updatedBy: req.session.username!,
    }).returning();
    res.status(201).json({ page, assets: [] });
  } catch {
    res.status(409).json({ error: "A page with this title already exists." });
  }
});

router.patch("/wiki/pages/:slug", requireAuth, requireWikiEditor, async (req, res) => {
  const slug = String(req.params.slug || "");
  const title = typeof req.body?.title === "string" ? req.body.title.trim().slice(0, 100) : "";
  const content = typeof req.body?.content === "string" ? req.body.content : null;
  if (!title || content === null) {
    res.status(400).json({ error: "Title and page content are required." });
    return;
  }
  if (content.length > 100_000) {
    res.status(413).json({ error: "Wiki page content is too large." });
    return;
  }
  const [page] = await db.update(wikiPagesTable)
    .set({ title, content, updatedBy: req.session.username!, updatedAt: new Date() })
    .where(eq(wikiPagesTable.slug, slug))
    .returning();
  if (!page) {
    res.status(404).json({ error: "Wiki page not found." });
    return;
  }
  const assets = await db.select({
    id: wikiAssetsTable.id,
    fileName: wikiAssetsTable.fileName,
    contentType: wikiAssetsTable.contentType,
    size: wikiAssetsTable.size,
    uploadedBy: wikiAssetsTable.uploadedBy,
    createdAt: wikiAssetsTable.createdAt,
  }).from(wikiAssetsTable).where(eq(wikiAssetsTable.pageSlug, slug));
  res.json({ page, assets: assets.map((asset) => ({ ...asset, url: `/api/wiki/assets/${asset.id}` })) });
});

router.delete("/wiki/pages/:slug", requireAuth, requireWikiEditor, async (req, res) => {
  const slug = String(req.params.slug || "");
  const assets = await db.select().from(wikiAssetsTable).where(eq(wikiAssetsTable.pageSlug, slug));
  for (const asset of assets) {
    const deleted = await storage.delete(asset.objectKey, { ignoreNotFound: true });
    if (!deleted.ok) {
      logger.error({ error: deleted.error, assetId: asset.id }, "Failed to remove wiki media");
      res.status(503).json({ error: "File storage is unavailable; the wiki page was not deleted." });
      return;
    }
  }
  await db.delete(wikiAssetsTable).where(eq(wikiAssetsTable.pageSlug, slug));
  await db.delete(wikiPagesTable).where(eq(wikiPagesTable.slug, slug));
  res.json({ ok: true });
});

router.post("/wiki/pages/:slug/assets", requireAuth, requireWikiEditor, async (req, res) => {
  const slug = String(req.params.slug || "");
  const [page] = await db.select({ slug: wikiPagesTable.slug }).from(wikiPagesTable).where(eq(wikiPagesTable.slug, slug)).limit(1);
  if (!page) {
    res.status(404).json({ error: "Wiki page not found." });
    return;
  }
  const media = parseMediaDataUrl(req.body?.dataUrl);
  if (!media) {
    res.status(400).json({ error: "Upload a PNG, JPEG, GIF, WebP, MP4, or WebM file up to 6 MB." });
    return;
  }
  const fileName = cleanFileName(req.body?.fileName);
  const extension = path.extname(fileName).toLowerCase() || (media.contentType === "video/mp4" ? ".mp4" : "");
  const objectKey = `wiki/${slug}/${randomUUID()}${extension}`;
  try {
    const result = await storage.uploadFromBytes(objectKey, media.bytes, { compress: false });
    if (!result.ok) {
      logger.error({ error: result.error }, "Wiki media upload failed");
      res.status(503).json({ error: "App Storage is unavailable. Set up an App Storage bucket and retry." });
      return;
    }
    const [asset] = await db.insert(wikiAssetsTable).values({
      pageSlug: slug,
      objectKey,
      fileName,
      contentType: media.contentType,
      size: media.bytes.length,
      uploadedBy: req.session.username!,
    }).returning();
    res.status(201).json({ ...asset, url: `/api/wiki/assets/${asset.id}` });
  } catch (error) {
    logger.error({ err: error }, "Wiki media upload failed");
    res.status(503).json({ error: "App Storage is unavailable. Set up an App Storage bucket and retry." });
  }
});

router.delete("/wiki/assets/:id", requireAuth, requireWikiEditor, async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) {
    res.status(400).json({ error: "Invalid media ID." });
    return;
  }
  const [asset] = await db.select().from(wikiAssetsTable).where(eq(wikiAssetsTable.id, id)).limit(1);
  if (!asset) {
    res.status(404).json({ error: "Wiki media not found." });
    return;
  }
  const deleted = await storage.delete(asset.objectKey, { ignoreNotFound: true });
  if (!deleted.ok) {
    res.status(503).json({ error: "File storage is unavailable; media was not removed." });
    return;
  }
  await db.delete(wikiAssetsTable).where(eq(wikiAssetsTable.id, id));
  res.json({ ok: true });
});

router.get("/wiki/assets/:id", async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) {
    res.status(400).end();
    return;
  }
  const [asset] = await db.select().from(wikiAssetsTable).where(eq(wikiAssetsTable.id, id)).limit(1);
  if (!asset) {
    res.status(404).end();
    return;
  }
  res.setHeader("Content-Type", asset.contentType);
  res.setHeader("Content-Length", String(asset.size));
  res.setHeader("Content-Disposition", `inline; filename*=UTF-8''${encodeURIComponent(asset.fileName)}`);
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Cache-Control", "public, max-age=86400");
  const stream = storage.downloadAsStream(asset.objectKey);
  stream.on("error", (error) => {
    logger.warn({ err: error, assetId: id }, "Wiki media download failed");
    if (!res.headersSent) res.status(502).end();
    else res.destroy();
  });
  stream.pipe(res);
});

export default router;
