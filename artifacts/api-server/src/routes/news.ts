import { Router, type IRouter } from "express";
import type { RequestHandler } from "express";
import { db, newsPostsTable, newsCommentsTable } from "@workspace/db";
import { desc, eq } from "drizzle-orm";
import { requireAuth } from "../lib/auth";
import { getUserPermissions } from "./ranks";
import { isBanned, audit } from "./social";
import { sendPushToAll } from "../lib/push";

const router: IRouter = Router();

// Moderators-and-above can post site news. Admins are always allowed.
const requireNewsPost: RequestHandler = async (req, res, next) => {
  if (!req.session.userId) { res.status(401).json({ error: "Login required" }); return; }
  if (req.session.isAdmin) { next(); return; }
  const perms = await getUserPermissions(req.session.username!);
  if (!perms.includes("postNews")) {
    res.status(403).json({ error: "Need postNews permission to post site news" });
    return;
  }
  next();
};

// Cap total images-payload size on a single post so we don't blow up the
// /news response. Each image data URL also has its own per-image cap.
const MAX_IMAGES_PER_POST = 8;
const MAX_IMAGE_BYTES = 800_000;       // ~600KB image after base64 overhead
const MAX_TITLE_LEN = 200;
const MAX_BODY_LEN = 20_000;

function sanitizeImages(input: unknown): string[] {
  if (!Array.isArray(input)) return [];
  const imgs = input
    .filter((x): x is string => typeof x === "string" && x.startsWith("data:image/"))
    .slice(0, MAX_IMAGES_PER_POST)
    .filter((x) => x.length <= MAX_IMAGE_BYTES);
  return imgs;
}

router.get("/news", async (_req, res) => {
  const rows = await db.select().from(newsPostsTable).orderBy(desc(newsPostsTable.createdAt)).limit(100);
  res.json(rows);
});

router.get("/news/:id/comments", async (req, res) => {
  const postId = Number(req.params.id);
  if (!Number.isInteger(postId)) { res.status(400).json({ error: "bad id" }); return; }
  const comments = await db
    .select()
    .from(newsCommentsTable)
    .where(eq(newsCommentsTable.newsPostId, postId))
    .orderBy(newsCommentsTable.createdAt);
  res.json(comments);
});

router.post("/news/:id/comments", requireAuth, async (req, res) => {
  const postId = Number(req.params.id);
  if (!Number.isInteger(postId)) { res.status(400).json({ error: "bad id" }); return; }
  const [post] = await db.select({ id: newsPostsTable.id }).from(newsPostsTable).where(eq(newsPostsTable.id, postId)).limit(1);
  if (!post) { res.status(404).json({ error: "News post not found" }); return; }
  const body = typeof req.body?.body === "string" ? req.body.body.trim().slice(0, 2000) : "";
  if (!body) { res.status(400).json({ error: "Comment cannot be empty" }); return; }
  const author = req.session.username!;
  if (await isBanned(author)) {
    await audit("news", "blocked-comment", author, String(postId), body.slice(0, 200));
    res.status(403).json({ error: "You are banned." });
    return;
  }
  const [comment] = await db.insert(newsCommentsTable).values({ newsPostId: postId, author, body }).returning();
  res.json(comment);
});

router.delete("/news/comments/:id", requireAuth, async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) { res.status(400).json({ error: "bad id" }); return; }
  const [comment] = await db.select().from(newsCommentsTable).where(eq(newsCommentsTable.id, id)).limit(1);
  if (!comment) { res.status(404).json({ error: "Comment not found" }); return; }
  if (comment.author !== req.session.username && !req.session.isAdmin) {
    res.status(403).json({ error: "Only the author or an admin can delete this comment" });
    return;
  }
  await db.delete(newsCommentsTable).where(eq(newsCommentsTable.id, id));
  res.json({ ok: true });
});

router.post("/news", requireNewsPost, async (req, res) => {
  const author = req.session.username!;
  const title = String(req.body?.title || "").trim().slice(0, MAX_TITLE_LEN);
  const body = String(req.body?.body || "").slice(0, MAX_BODY_LEN);
  const images = sanitizeImages(req.body?.images);
  if (!title && !body && images.length === 0) {
    res.status(400).json({ error: "News post needs a title, body, or at least one image." });
    return;
  }
  const [row] = await db.insert(newsPostsTable).values({ author, title, body, images }).returning();
  void sendPushToAll({
    title: "New site news",
    body: title || body.slice(0, 160) || "A new announcement was posted.",
    tag: `site-news:${row.id}`,
    kind: "site-news",
    url: "/",
    excludeUsername: author,
  });
  res.json(row);
});

router.patch("/news/:id", requireAuth, async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) { res.status(400).json({ error: "bad id" }); return; }
  const [existing] = await db.select().from(newsPostsTable).where(eq(newsPostsTable.id, id)).limit(1);
  if (!existing) { res.status(404).json({ error: "Not found" }); return; }

  // Only the original author or an admin can edit a post. Moderator perms
  // alone don't let you rewrite someone else's announcement.
  if (existing.author !== req.session.username && !req.session.isAdmin) {
    res.status(403).json({ error: "Only the author or an admin can edit this post" });
    return;
  }

  const update: Record<string, any> = { updatedAt: new Date() };
  if (typeof req.body?.title === "string") update.title = req.body.title.trim().slice(0, MAX_TITLE_LEN);
  if (typeof req.body?.body === "string") update.body = req.body.body.slice(0, MAX_BODY_LEN);
  if (Array.isArray(req.body?.images)) update.images = sanitizeImages(req.body.images);

  await db.update(newsPostsTable).set(update).where(eq(newsPostsTable.id, id));
  const [fresh] = await db.select().from(newsPostsTable).where(eq(newsPostsTable.id, id));
  res.json(fresh);
});

router.delete("/news/:id", requireAuth, async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) { res.status(400).json({ error: "bad id" }); return; }
  const [existing] = await db.select().from(newsPostsTable).where(eq(newsPostsTable.id, id)).limit(1);
  if (!existing) { res.status(404).json({ error: "Not found" }); return; }
  if (existing.author !== req.session.username && !req.session.isAdmin) {
    res.status(403).json({ error: "Only the author or an admin can delete this post" });
    return;
  }
  await db.delete(newsPostsTable).where(eq(newsPostsTable.id, id));
  res.json({ ok: true });
});

export default router;
