import { Router, type IRouter } from "express";
import { randomUUID } from "node:crypto";
import { and, desc, eq, inArray, sql } from "drizzle-orm";
import {
  db,
  socialFollowsTable,
  socialPostLikesTable,
  socialPostsTable,
  userPagesTable,
  usersTable,
} from "@workspace/db";
import { requireAuth } from "../lib/auth";
import { appStorage } from "../lib/app-storage";
import { cleanupAfterMutation } from "../lib/storage-mutations";
import { logger } from "../lib/logger";
import { findBlockedPhrase, getBlockedPhrases } from "../lib/content-filter";
import { audit, isBanned } from "./social";

const router: IRouter = Router();
const MAX_MEDIA_BYTES = 6 * 1024 * 1024;
const ALLOWED_MEDIA = new Set(["image/jpeg", "image/png", "image/gif", "image/webp", "video/mp4", "video/webm"]);
const postCooldowns = new Map<string, number>();

function parseMedia(value: unknown): { type: string; bytes: Buffer } | null {
  if (typeof value !== "string" || value.length > Math.ceil(MAX_MEDIA_BYTES / 3) * 4 + 100) return null;
  const match = /^data:([a-z0-9/+.-]+);base64,([A-Za-z0-9+/]*={0,2})$/i.exec(value);
  if (!match || !ALLOWED_MEDIA.has(match[1].toLowerCase())) return null;
  const bytes = Buffer.from(match[2], "base64");
  return bytes.length > 0 && bytes.length <= MAX_MEDIA_BYTES ? { type: match[1].toLowerCase(), bytes } : null;
}

async function presentPost(row: typeof socialPostsTable.$inferSelect, username?: string) {
  const [likes, mine] = await Promise.all([
    db.select({ count: sql<number>`count(*)::int` }).from(socialPostLikesTable).where(eq(socialPostLikesTable.postId, row.id)),
    username
      ? db.select({ id: socialPostLikesTable.id }).from(socialPostLikesTable)
        .where(and(eq(socialPostLikesTable.postId, row.id), eq(socialPostLikesTable.username, username))).limit(1)
      : Promise.resolve([]),
  ]);
  return {
    id: row.id, author: row.author, body: row.body,
    mediaUrl: row.mediaObjectKey ? `/api/social/media/${row.id}` : null,
    mediaType: row.mediaType, createdAt: row.createdAt,
    likes: Number(likes[0]?.count || 0), myLike: mine.length > 0,
  };
}

router.get("/social/feed", async (req, res) => {
  const mode = req.query.mode === "following" ? "following" : "for-you";
  const username = req.session.username;
  let rows = await db.select().from(socialPostsTable).orderBy(desc(socialPostsTable.createdAt)).limit(100);
  if (mode === "following") {
    if (!username) { res.status(401).json({ error: "Sign in to see your following feed." }); return; }
    const follows = await db.select({ following: socialFollowsTable.following }).from(socialFollowsTable)
      .where(eq(socialFollowsTable.follower, username));
    const authors = follows.map(row => row.following);
    rows = authors.length
      ? await db.select().from(socialPostsTable).where(inArray(socialPostsTable.author, authors))
        .orderBy(desc(socialPostsTable.createdAt)).limit(40)
      : [];
  } else {
    const follows = username
      ? await db.select({ following: socialFollowsTable.following }).from(socialFollowsTable)
        .where(eq(socialFollowsTable.follower, username))
      : [];
    const followedAuthors = follows.map(row => row.following);
    const followedPosts = followedAuthors.length
      ? await db.select().from(socialPostsTable).where(inArray(socialPostsTable.author, followedAuthors))
        .orderBy(desc(socialPostsTable.createdAt)).limit(20)
      : [];
    const counts = rows.length ? await db.select({
      postId: socialPostLikesTable.postId,
      count: sql<number>`count(*)::int`,
    }).from(socialPostLikesTable).where(inArray(socialPostLikesTable.postId, rows.map(row => row.id)))
      .groupBy(socialPostLikesTable.postId) : [];
    const scoreByPost = new Map(counts.map(row => [row.postId, Number(row.count)]));
    const popular = [...rows].sort((a, b) => (scoreByPost.get(b.id) || 0) - (scoreByPost.get(a.id) || 0)).slice(0, 30);
    const recent = [...rows].slice(0, 30);
    rows = [...new Map([...followedPosts, ...popular, ...recent].map(row => [row.id, row])).values()]
      .sort(() => Math.random() - 0.5).slice(0, 40);
  }
  res.json(await Promise.all(rows.map(row => presentPost(row, username))));
});

router.get("/social/profile/:username", async (req, res) => {
  const username = String(req.params.username || "").slice(0, 40);
  const [user] = await db.select({
    username: usersTable.username, avatarUrl: usersTable.avatarUrl, rank: usersTable.rank,
  }).from(usersTable).where(eq(usersTable.username, username)).limit(1);
  if (!user) { res.status(404).json({ error: "User not found." }); return; }
  const [posts, followers, following, relation] = await Promise.all([
    db.select().from(socialPostsTable).where(eq(socialPostsTable.author, username)).orderBy(desc(socialPostsTable.createdAt)).limit(60),
    db.select({ count: sql<number>`count(*)::int` }).from(socialFollowsTable).where(eq(socialFollowsTable.following, username)),
    db.select({ count: sql<number>`count(*)::int` }).from(socialFollowsTable).where(eq(socialFollowsTable.follower, username)),
    req.session.username ? db.select({ id: socialFollowsTable.id }).from(socialFollowsTable)
      .where(and(eq(socialFollowsTable.follower, req.session.username), eq(socialFollowsTable.following, username))).limit(1) : Promise.resolve([]),
  ]);
  res.json({
    ...user, followers: Number(followers[0]?.count || 0), following: Number(following[0]?.count || 0),
    isFollowing: relation.length > 0, posts: await Promise.all(posts.map(row => presentPost(row, req.session.username))),
  });
});

router.post("/social/posts", requireAuth, async (req, res) => {
  const body = typeof req.body?.body === "string" ? req.body.body.trim() : "";
  const media = req.body?.mediaDataUrl == null ? null : parseMedia(req.body.mediaDataUrl);
  if (body.length > 500) { res.status(400).json({ error: "Posts can be up to 500 characters." }); return; }
  if (req.body?.mediaDataUrl != null && !media) {
    res.status(400).json({ error: "Attach a supported image or MP4/WebM video up to 6 MiB." }); return;
  }
  if (!body && !media) { res.status(400).json({ error: "Write a post or attach media." }); return; }
  const author = req.session.username!;
  if (await isBanned(author)) {
    await audit("social", "blocked", author, author, body.slice(0, 500));
    res.status(403).json({ error: "Your account cannot publish posts." });
    return;
  }
  const blockedPhrases = await getBlockedPhrases("chat");
  if (findBlockedPhrase(body, blockedPhrases)) {
    res.status(400).json({ error: "Your post contains a blocked word or phrase." });
    return;
  }
  const previousPost = postCooldowns.get(author) || 0;
  if (Date.now() - previousPost < 5_000) {
    res.status(429).json({ error: "Please wait a few seconds before posting again." });
    return;
  }
  let objectKey: string | null = null;
  try {
    if (media) {
      objectKey = `social/${req.session.username}/${randomUUID()}`;
      const uploaded = await appStorage.uploadFromBytes(objectKey, media.bytes, { compress: false });
      if (!uploaded.ok) throw new Error("Media storage is unavailable.");
    }
    const [post] = await db.insert(socialPostsTable).values({
      author, body, mediaObjectKey: objectKey, mediaType: media?.type || null,
    }).returning();
    postCooldowns.set(author, Date.now());
    await cleanupAfterMutation(objectKey ? [objectKey] : []);
    res.status(201).json(await presentPost(post, req.session.username));
  } catch (error) {
    if (objectKey) await cleanupAfterMutation([objectKey]);
    logger.error({ err: error }, "Social post creation failed");
    res.status(503).json({ error: "The post could not be saved. Please try again." });
  }
});

router.delete("/social/posts/:id", requireAuth, async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) { res.status(400).json({ error: "Invalid post." }); return; }
  const [post] = await db.select().from(socialPostsTable).where(eq(socialPostsTable.id, id)).limit(1);
  if (!post) { res.status(404).json({ error: "Post not found." }); return; }
  if (post.author !== req.session.username && !req.session.isAdmin) { res.status(403).json({ error: "You cannot delete this post." }); return; }
  await db.delete(socialPostsTable).where(eq(socialPostsTable.id, id));
  await db.delete(socialPostLikesTable).where(eq(socialPostLikesTable.postId, id));
  if (post.mediaObjectKey) await cleanupAfterMutation([post.mediaObjectKey]);
  res.json({ ok: true });
});

router.post("/social/posts/:id/like", requireAuth, async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) { res.status(400).json({ error: "Invalid post." }); return; }
  const [post] = await db.select({ id: socialPostsTable.id }).from(socialPostsTable).where(eq(socialPostsTable.id, id)).limit(1);
  if (!post) { res.status(404).json({ error: "Post not found." }); return; }
  const [existing] = await db.select({ id: socialPostLikesTable.id }).from(socialPostLikesTable)
    .where(and(eq(socialPostLikesTable.postId, id), eq(socialPostLikesTable.username, req.session.username!))).limit(1);
  if (existing) await db.delete(socialPostLikesTable).where(eq(socialPostLikesTable.id, existing.id));
  else await db.insert(socialPostLikesTable).values({ postId: id, username: req.session.username! }).onConflictDoNothing();
  res.json({ ok: true, liked: !existing });
});

router.post("/social/follow/:username", requireAuth, async (req, res) => {
  const target = String(req.params.username || "").slice(0, 40);
  if (target === req.session.username) { res.status(400).json({ error: "You cannot follow yourself." }); return; }
  const [user] = await db.select({ username: usersTable.username }).from(usersTable).where(eq(usersTable.username, target)).limit(1);
  if (!user) { res.status(404).json({ error: "User not found." }); return; }
  await db.insert(socialFollowsTable).values({ follower: req.session.username!, following: target }).onConflictDoNothing();
  res.json({ ok: true, following: true });
});

router.delete("/social/follow/:username", requireAuth, async (req, res) => {
  await db.delete(socialFollowsTable).where(and(
    eq(socialFollowsTable.follower, req.session.username!),
    eq(socialFollowsTable.following, String(req.params.username || "")),
  ));
  res.json({ ok: true, following: false });
});

router.post("/social/migrate-page", requireAuth, async (req, res) => {
  const username = req.session.username!;
  const [existing] = await db.select({ id: socialPostsTable.id }).from(socialPostsTable)
    .where(eq(socialPostsTable.sourcePageUsername, username)).limit(1);
  if (existing) { res.json({ migrated: false }); return; }
  const [page] = await db.select().from(userPagesTable).where(eq(userPagesTable.username, username)).limit(1);
  if (!page) { res.json({ migrated: false }); return; }
  const media = parseMedia(page.dataUrl);
  if (!media) { res.status(422).json({ error: "Your old page image could not be converted." }); return; }
  const objectKey = `social/${username}/legacy-${randomUUID()}`;
  const uploaded = await appStorage.uploadFromBytes(objectKey, media.bytes, { compress: false });
  if (!uploaded.ok) { res.status(503).json({ error: "Your old page could not be moved yet." }); return; }
  try {
    const [post] = await db.insert(socialPostsTable).values({
      author: username, body: "", mediaObjectKey: objectKey, mediaType: media.type,
      sourcePageUsername: username, createdAt: page.updatedAt,
    }).onConflictDoNothing().returning();
    if (!post) await cleanupAfterMutation([objectKey]);
    res.json({ migrated: !!post });
  } catch (error) {
    await cleanupAfterMutation([objectKey]);
    logger.error({ err: error, username }, "Legacy My Page migration failed");
    res.status(503).json({ error: "Your old page could not be moved yet." });
  }
});

router.get("/social/media/:id", async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) { res.status(400).end(); return; }
  const [post] = await db.select().from(socialPostsTable).where(eq(socialPostsTable.id, id)).limit(1);
  if (!post?.mediaObjectKey || !post.mediaType) { res.status(404).end(); return; }
  res.setHeader("Content-Type", post.mediaType);
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Cache-Control", "public, max-age=86400");
  const stream = appStorage.downloadAsStream(post.mediaObjectKey);
  stream.on("error", error => {
    logger.warn({ err: error, postId: id }, "Social media download failed");
    if (!res.headersSent) res.status(502).end(); else res.destroy();
  });
  stream.pipe(res);
});

export default router;
