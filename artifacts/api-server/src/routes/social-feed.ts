import { Router, type IRouter } from "express";
import { randomUUID } from "node:crypto";
import { and, desc, eq, gte, inArray, sql } from "drizzle-orm";
import {
  db,
  socialFollowsTable,
  socialPostLikesTable,
  socialPostCommentsTable,
  socialCommentLikesTable,
  socialCommentRepostsTable,
  socialPostRepostsTable,
  socialNotificationsTable,
  siteSettingsTable,
  networkNewsTable,
  socialPostsTable,
  userPagesTable,
  usersTable,
} from "@workspace/db";
import { requireAuth, requireAdmin } from "../lib/auth";
import { appStorage } from "../lib/app-storage";
import { cleanupAfterMutation } from "../lib/storage-mutations";
import { logger } from "../lib/logger";
import { findBlockedPhrase, getBlockedPhrases } from "../lib/content-filter";
import { audit, isBanned } from "./social";

const router: IRouter = Router();
const MAX_MEDIA_BYTES = 6 * 1024 * 1024;
const ALLOWED_MEDIA = new Set(["image/jpeg", "image/png", "image/gif", "image/webp", "video/mp4", "video/webm"]);
const postCooldowns = new Map<string, number>();

router.get("/social/network-news", async (_req, res) => {
  const rows = await db.select().from(networkNewsTable).orderBy(desc(networkNewsTable.createdAt)).limit(10);
  res.json(rows);
});

router.post("/social/network-news", requireAdmin, async (req, res) => {
  const title = typeof req.body?.title === "string" ? req.body.title.trim() : "";
  const body = typeof req.body?.body === "string" ? req.body.body.trim() : "";
  if (!title || title.length > 100 || !body || body.length > 1000) {
    res.status(400).json({ error: "Add a title (up to 100 characters) and message (up to 1,000 characters)." });
    return;
  }
  const [row] = await db.insert(networkNewsTable).values({ author: req.session.username!, title, body }).returning();
  res.status(201).json(row);
});

router.delete("/social/network-news/:id", requireAdmin, async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) { res.status(400).json({ error: "Invalid Network News item." }); return; }
  await db.delete(networkNewsTable).where(eq(networkNewsTable.id, id));
  res.json({ ok: true });
});

router.post("/social/bot/test-post", requireAdmin, async (req, res) => {
  try {
    const imageUrl = await pickRandomSladenatorImage();
    const [post] = await db.insert(socialPostsTable).values({
      author: "SladenatorEatsOfficial",
      body: "#sladenator #ai #slop",
      externalMediaUrl: imageUrl,
      mediaType: "image",
    }).returning();
    res.status(201).json(await presentPost(post, req.session.username));
  } catch (error) {
    logger.warn({ err: error }, "Sladenator bot test post could not be created");
    res.status(502).json({ error: error instanceof Error ? error.message : "Could not find an image on sladenator.org." });
  }
});

function parseMedia(value: unknown): { type: string; bytes: Buffer } | null {
  if (typeof value !== "string" || value.length > Math.ceil(MAX_MEDIA_BYTES / 3) * 4 + 100) return null;
  const match = /^data:([a-z0-9/+.-]+);base64,([A-Za-z0-9+/]*={0,2})$/i.exec(value);
  if (!match || !ALLOWED_MEDIA.has(match[1].toLowerCase())) return null;
  const bytes = Buffer.from(match[2], "base64");
  return bytes.length > 0 && bytes.length <= MAX_MEDIA_BYTES ? { type: match[1].toLowerCase(), bytes } : null;
}

async function pickRandomSladenatorImage(): Promise<string> {
  const response = await fetch("https://sladenator.org/api/photos", {
    headers: { Accept: "application/json", "User-Agent": "Portfolio98-NetworkBot/1.0" },
    signal: AbortSignal.timeout(10_000),
    redirect: "error",
  });
  if (!response.ok) throw new Error(`sladenator.org photo collection returned HTTP ${response.status}.`);
  if (!(response.headers.get("content-type") || "").includes("application/json")) {
    throw new Error("sladenator.org photo collection did not return JSON.");
  }
  const payload = await response.text();
  if (payload.length > 2_000_000) throw new Error("sladenator.org photo collection response is unexpectedly large.");
  const photos: unknown = JSON.parse(payload);
  if (!Array.isArray(photos)) throw new Error("sladenator.org returned an invalid photo collection.");
  const candidates = new Set<string>();
  for (const photo of photos) {
    if (!photo || typeof photo !== "object" || !("url" in photo) || typeof photo.url !== "string") continue;
    try {
      const url = new URL(photo.url, "https://sladenator.org");
      if (url.protocol !== "https:"
        || (url.hostname !== "sladenator.org" && !url.hostname.endsWith(".sladenator.org"))
        || !url.pathname.startsWith("/photos/")
        || !/\.(?:jpe?g|png|gif|webp|avif)$/i.test(url.pathname)) continue;
      candidates.add(url.toString());
    } catch { /* Ignore malformed photo entries. */ }
  }
  const pool = [...candidates];
  if (!pool.length) throw new Error("No usable photos were found in sladenator.org's photo collection.");
  return pool[Math.floor(Math.random() * pool.length)]!;
}

async function presentPost(row: typeof socialPostsTable.$inferSelect, username?: string, repostedBy?: string) {
  const [likes, mine, comments, reposts, myRepost, authorFollowed] = await Promise.all([
    db.select({ count: sql<number>`count(*)::int` }).from(socialPostLikesTable).where(eq(socialPostLikesTable.postId, row.id)),
    username
      ? db.select({ id: socialPostLikesTable.id }).from(socialPostLikesTable)
        .where(and(eq(socialPostLikesTable.postId, row.id), eq(socialPostLikesTable.username, username))).limit(1)
      : Promise.resolve([]),
    db.select({ count: sql<number>`count(*)::int` }).from(socialPostCommentsTable).where(eq(socialPostCommentsTable.postId, row.id)),
    db.select({ count: sql<number>`count(*)::int` }).from(socialPostRepostsTable).where(eq(socialPostRepostsTable.postId, row.id)),
    username ? db.select({ id: socialPostRepostsTable.id }).from(socialPostRepostsTable)
      .where(and(eq(socialPostRepostsTable.postId, row.id), eq(socialPostRepostsTable.username, username))).limit(1) : Promise.resolve([]),
    username ? db.select({ id: socialFollowsTable.id }).from(socialFollowsTable)
      .where(and(eq(socialFollowsTable.follower, username), eq(socialFollowsTable.following, row.author))).limit(1) : Promise.resolve([]),
  ]);
  return {
    id: row.id, author: row.author, body: row.body,
    mediaUrl: row.externalMediaUrl || (row.mediaObjectKey ? `/api/social/media/${row.id}` : null),
    mediaType: row.mediaType, createdAt: row.createdAt,
    likes: Number(likes[0]?.count || 0), myLike: mine.length > 0,
    comments: Number(comments[0]?.count || 0), reposts: Number(reposts[0]?.count || 0), myRepost: myRepost.length > 0,
    authorFollowed: authorFollowed.length > 0,
    repostedBy: repostedBy || null,
  };
}

router.get("/social/search", async (req, res) => {
  const q = String(req.query.q || "").trim().slice(0, 80);
  if (!q) { res.json([]); return; }
  const authorQuery = q.startsWith("@") ? q.slice(1) : q;
  const rows = await db.select().from(socialPostsTable).where(sql`
    ${socialPostsTable.body} ILIKE ${`%${q}%`}
    OR ${socialPostsTable.author} ILIKE ${`%${authorQuery}%`}
  `)
    .orderBy(desc(socialPostsTable.createdAt)).limit(40);
  res.json(await Promise.all(rows.map(row => presentPost(row, req.session.username))));
});

router.get("/social/hashtag/:tag", async (req, res) => {
  const tag = String(req.params.tag || "");
  if (!/^[\p{L}\p{N}_]{2,40}$/u.test(tag)) {
    res.status(400).json({ error: "Invalid hashtag." });
    return;
  }
  const rows = await db.select().from(socialPostsTable)
    .orderBy(desc(socialPostsTable.createdAt)).limit(2000);
  const exactTag = new RegExp(`(^|[^\\p{L}\\p{N}_])#${tag}(?![\\p{L}\\p{N}_])`, "iu");
  const matches = rows.filter((row) => exactTag.test(row.body)).slice(0, 40);
  res.json(await Promise.all(matches.map((row) => presentPost(row, req.session.username))));
});

router.get("/social/liked", requireAuth, async (req, res) => {
  const likes = await db.select({ postId: socialPostLikesTable.postId }).from(socialPostLikesTable)
    .where(eq(socialPostLikesTable.username, req.session.username!)).orderBy(desc(socialPostLikesTable.createdAt)).limit(60);
  const ids = likes.map(row => row.postId);
  const rows = ids.length ? await db.select().from(socialPostsTable).where(inArray(socialPostsTable.id, ids)) : [];
  const byId = new Map(rows.map(row => [row.id, row]));
  res.json(await Promise.all(ids.flatMap(id => byId.has(id) ? [presentPost(byId.get(id)!, req.session.username)] : [])));
});

router.get("/social/trending", async (_req, res) => {
  const since = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
  const rows = await db.select({ body: socialPostsTable.body }).from(socialPostsTable)
    .where(gte(socialPostsTable.createdAt, since)).orderBy(desc(socialPostsTable.createdAt)).limit(2000);
  const counts = new Map<string, number>();
  for (const row of rows) for (const tag of new Set(row.body.match(/#[\p{L}\p{N}_]{2,40}/gu) || [])) {
    const normalized = tag.toLowerCase();
    counts.set(normalized, (counts.get(normalized) || 0) + 1);
  }
  res.json([...counts].filter(([, count]) => count > 3).sort((a, b) => b[1] - a[1]).slice(0, 10).map(([tag, count]) => ({ tag, count })));
});

router.get("/social/notifications", requireAuth, async (req, res) => {
  const username = req.session.username!;
  const rows = await db.select().from(socialNotificationsTable).where(eq(socialNotificationsTable.username, username))
    .orderBy(desc(socialNotificationsTable.createdAt)).limit(50);
  await db.update(socialNotificationsTable).set({ readAt: new Date() }).where(and(eq(socialNotificationsTable.username, username), sql`${socialNotificationsTable.readAt} IS NULL`));
  res.json(rows);
});

router.get("/social/posts/:id/comments", async (req, res) => {
  const postId = Number(req.params.id);
  if (!Number.isInteger(postId)) { res.status(400).json({ error: "Invalid post." }); return; }
  const newestFirst = await db.select().from(socialPostCommentsTable).where(eq(socialPostCommentsTable.postId, postId))
    .orderBy(desc(socialPostCommentsTable.createdAt), desc(socialPostCommentsTable.id)).limit(200);
  const rows = newestFirst.reverse();
  const ids = rows.map((row) => row.id);
  if (!ids.length) { res.json([]); return; }
  const [likes, reposts, mineLikes, mineReposts] = await Promise.all([
    db.select({ commentId: socialCommentLikesTable.commentId, count: sql<number>`count(*)::int` })
      .from(socialCommentLikesTable).where(inArray(socialCommentLikesTable.commentId, ids)).groupBy(socialCommentLikesTable.commentId),
    db.select({ commentId: socialCommentRepostsTable.commentId, count: sql<number>`count(*)::int` })
      .from(socialCommentRepostsTable).where(inArray(socialCommentRepostsTable.commentId, ids)).groupBy(socialCommentRepostsTable.commentId),
    req.session.username ? db.select({ commentId: socialCommentLikesTable.commentId }).from(socialCommentLikesTable)
      .where(and(inArray(socialCommentLikesTable.commentId, ids), eq(socialCommentLikesTable.username, req.session.username))) : Promise.resolve([]),
    req.session.username ? db.select({ commentId: socialCommentRepostsTable.commentId }).from(socialCommentRepostsTable)
      .where(and(inArray(socialCommentRepostsTable.commentId, ids), eq(socialCommentRepostsTable.username, req.session.username))) : Promise.resolve([]),
  ]);
  const likeCounts = new Map(likes.map((row) => [row.commentId, Number(row.count)]));
  const repostCounts = new Map(reposts.map((row) => [row.commentId, Number(row.count)]));
  const liked = new Set(mineLikes.map((row) => row.commentId));
  const reposted = new Set(mineReposts.map((row) => row.commentId));
  res.json(rows.map((row) => ({
    ...row,
    likes: likeCounts.get(row.id) || 0,
    myLike: liked.has(row.id),
    reposts: repostCounts.get(row.id) || 0,
    myRepost: reposted.has(row.id),
  })));
});

router.post("/social/posts/:id/comments", requireAuth, async (req, res) => {
  const postId = Number(req.params.id);
  const body = typeof req.body?.body === "string" ? req.body.body.trim().slice(0, 500) : "";
  const parentCommentId = req.body?.parentCommentId == null ? null : Number(req.body.parentCommentId);
  if (!Number.isInteger(postId) || !body) { res.status(400).json({ error: "Write a comment first." }); return; }
  if (parentCommentId !== null && !Number.isInteger(parentCommentId)) { res.status(400).json({ error: "Invalid reply target." }); return; }
  const author = req.session.username!;
  if (await isBanned(author)) { res.status(403).json({ error: "Your account cannot comment." }); return; }
  if (findBlockedPhrase(body, await getBlockedPhrases("chat"))) { res.status(400).json({ error: "Your comment contains a blocked word or phrase." }); return; }
  const [post] = await db.select({ author: socialPostsTable.author }).from(socialPostsTable).where(eq(socialPostsTable.id, postId)).limit(1);
  if (!post) { res.status(404).json({ error: "Post not found." }); return; }
  let parentAuthor: string | null = null;
  if (parentCommentId !== null) {
    const [parent] = await db.select({ id: socialPostCommentsTable.id, author: socialPostCommentsTable.author })
      .from(socialPostCommentsTable)
      .where(and(eq(socialPostCommentsTable.id, parentCommentId), eq(socialPostCommentsTable.postId, postId))).limit(1);
    if (!parent) { res.status(404).json({ error: "Reply target not found." }); return; }
    parentAuthor = parent.author;
  }
  const [comment] = await db.insert(socialPostCommentsTable).values({ postId, parentCommentId, author, body }).returning();
  if (post.author !== author) await db.insert(socialNotificationsTable).values({ username: post.author, actor: author, postId, kind: "comment" });
  if (parentAuthor && parentAuthor !== author && parentAuthor !== post.author) {
    await db.insert(socialNotificationsTable).values({ username: parentAuthor, actor: author, postId, kind: "comment" });
  }
  res.status(201).json({ ...comment, likes: 0, myLike: false, reposts: 0, myRepost: false });
});

router.post("/social/comments/:id/like", requireAuth, async (req, res) => {
  const commentId = Number(req.params.id);
  const username = req.session.username!;
  if (!Number.isInteger(commentId)) { res.status(400).json({ error: "Invalid comment." }); return; }
  if (await isBanned(username)) { res.status(403).json({ error: "Your account cannot like comments." }); return; }
  const [comment] = await db.select({ id: socialPostCommentsTable.id }).from(socialPostCommentsTable)
    .where(eq(socialPostCommentsTable.id, commentId)).limit(1);
  if (!comment) { res.status(404).json({ error: "Comment not found." }); return; }
  const [existing] = await db.select({ id: socialCommentLikesTable.id }).from(socialCommentLikesTable)
    .where(and(eq(socialCommentLikesTable.commentId, commentId), eq(socialCommentLikesTable.username, username))).limit(1);
  if (existing) await db.delete(socialCommentLikesTable).where(eq(socialCommentLikesTable.id, existing.id));
  else await db.insert(socialCommentLikesTable).values({ commentId, username }).onConflictDoNothing();
  res.json({ liked: !existing });
});

router.post("/social/comments/:id/repost", requireAuth, async (req, res) => {
  const commentId = Number(req.params.id);
  const username = req.session.username!;
  if (!Number.isInteger(commentId)) { res.status(400).json({ error: "Invalid comment." }); return; }
  if (await isBanned(username)) { res.status(403).json({ error: "Your account cannot repost comments." }); return; }
  const [comment] = await db.select({ id: socialPostCommentsTable.id }).from(socialPostCommentsTable)
    .where(eq(socialPostCommentsTable.id, commentId)).limit(1);
  if (!comment) { res.status(404).json({ error: "Comment not found." }); return; }
  const [existing] = await db.select({ id: socialCommentRepostsTable.id }).from(socialCommentRepostsTable)
    .where(and(eq(socialCommentRepostsTable.commentId, commentId), eq(socialCommentRepostsTable.username, username))).limit(1);
  if (existing) await db.delete(socialCommentRepostsTable).where(eq(socialCommentRepostsTable.id, existing.id));
  else await db.insert(socialCommentRepostsTable).values({ commentId, username }).onConflictDoNothing();
  res.json({ reposted: !existing });
});

router.post("/social/posts/:id/repost", requireAuth, async (req, res) => {
  const postId = Number(req.params.id);
  const username = req.session.username!;
  const [post] = await db.select({ author: socialPostsTable.author }).from(socialPostsTable).where(eq(socialPostsTable.id, postId)).limit(1);
  if (!post) { res.status(404).json({ error: "Post not found." }); return; }
  const [existing] = await db.select({ id: socialPostRepostsTable.id }).from(socialPostRepostsTable)
    .where(and(eq(socialPostRepostsTable.postId, postId), eq(socialPostRepostsTable.username, username))).limit(1);
  if (existing) await db.delete(socialPostRepostsTable).where(eq(socialPostRepostsTable.id, existing.id));
  else {
    await db.insert(socialPostRepostsTable).values({ postId, username }).onConflictDoNothing();
    if (post.author !== username) await db.insert(socialNotificationsTable).values({ username: post.author, actor: username, postId, kind: "repost" });
  }
  res.json({ reposted: !existing });
});

router.get("/social/feed", async (req, res) => {
  const mode = req.query.mode === "following" ? "following" : "for-you";
  const username = req.session.username;
  let rows = await db.select().from(socialPostsTable).orderBy(desc(socialPostsTable.createdAt)).limit(100);
  const repostedBy = new Map<number, string>();
  if (mode === "following") {
    if (!username) { res.status(401).json({ error: "Sign in to see your following feed." }); return; }
    const follows = await db.select({ following: socialFollowsTable.following }).from(socialFollowsTable)
      .where(eq(socialFollowsTable.follower, username));
    const authors = follows.map(row => row.following);
    if (authors.length) {
      const reposts = await db.select().from(socialPostRepostsTable).where(inArray(socialPostRepostsTable.username, authors))
        .orderBy(desc(socialPostRepostsTable.createdAt)).limit(40);
      const sharedIds = [...new Set(reposts.map(item => item.postId))];
      const shared = sharedIds.length ? await db.select().from(socialPostsTable).where(inArray(socialPostsTable.id, sharedIds)) : [];
      for (const item of reposts) if (!repostedBy.has(item.postId)) repostedBy.set(item.postId, item.username);
      const authored = await db.select().from(socialPostsTable).where(inArray(socialPostsTable.author, authors))
        .orderBy(desc(socialPostsTable.createdAt)).limit(40);
      rows = [...new Map([...authored, ...shared].map(row => [row.id, row])).values()]
        .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime()).slice(0, 40);
    } else rows = [];
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
    const candidates = [...new Map([...rows, ...followedPosts].map(row => [row.id, row])).values()];
    const counts = candidates.length ? await db.select({
      postId: socialPostLikesTable.postId,
      count: sql<number>`count(*)::int`,
    }).from(socialPostLikesTable).where(inArray(socialPostLikesTable.postId, candidates.map(row => row.id)))
      .groupBy(socialPostLikesTable.postId) : [];
    const scoreByPost = new Map(counts.map(row => [row.postId, Number(row.count)]));
    const followedSet = new Set(followedAuthors);
    const score = (post: typeof candidates[number]) => {
      const ageHours = Math.max(0, (Date.now() - post.createdAt.getTime()) / 3_600_000);
      const recency = 40 * Math.exp(-ageHours / 72);
      const popularity = Math.log2(1 + (scoreByPost.get(post.id) || 0)) * 12;
      const followedBoost = followedSet.has(post.author) ? 4 : 0;
      return recency + popularity + followedBoost;
    };
    rows = candidates.sort((a, b) => score(b) - score(a) || b.createdAt.getTime() - a.createdAt.getTime()).slice(0, 40);
  }
  res.json(await Promise.all(rows.map(row => presentPost(row, username, repostedBy.get(row.id)))));
});

router.get("/social/profile/:username", async (req, res) => {
  const username = String(req.params.username || "").slice(0, 40);
  if (username === "SladenatorEatsOfficial") {
    const [settings] = await db.select({
      bio: siteSettingsTable.networkBotBio,
      avatarUrl: siteSettingsTable.networkBotAvatarDataUrl,
    }).from(siteSettingsTable).limit(1);
    const [authored, followers, following, relation] = await Promise.all([
      db.select().from(socialPostsTable).where(eq(socialPostsTable.author, username))
        .orderBy(desc(socialPostsTable.createdAt)).limit(60),
      db.select({ count: sql<number>`count(*)::int` }).from(socialFollowsTable).where(eq(socialFollowsTable.following, username)),
      db.select({ count: sql<number>`count(*)::int` }).from(socialFollowsTable).where(eq(socialFollowsTable.follower, username)),
      req.session.username ? db.select({ id: socialFollowsTable.id }).from(socialFollowsTable)
        .where(and(eq(socialFollowsTable.follower, req.session.username), eq(socialFollowsTable.following, username))).limit(1) : Promise.resolve([]),
    ]);
    res.json({
      username, avatarUrl: settings?.avatarUrl || null, rank: "Bot", bio: settings?.bio || "",
      followers: Number(followers[0]?.count || 0), following: Number(following[0]?.count || 0),
      isFollowing: relation.length > 0, posts: await Promise.all(authored.map((row) => presentPost(row, req.session.username))),
    });
    return;
  }
  const [user] = await db.select({
    username: usersTable.username, avatarUrl: usersTable.avatarUrl, rank: usersTable.rank, bio: usersTable.bio,
  }).from(usersTable).where(eq(usersTable.username, username)).limit(1);
  if (!user) { res.status(404).json({ error: "User not found." }); return; }
  const [authored, reposts, followers, following, relation] = await Promise.all([
    db.select().from(socialPostsTable).where(eq(socialPostsTable.author, username)).orderBy(desc(socialPostsTable.createdAt)).limit(60),
    db.select({ postId: socialPostRepostsTable.postId, createdAt: socialPostRepostsTable.createdAt })
      .from(socialPostRepostsTable).where(eq(socialPostRepostsTable.username, username))
      .orderBy(desc(socialPostRepostsTable.createdAt)).limit(60),
    db.select({ count: sql<number>`count(*)::int` }).from(socialFollowsTable).where(eq(socialFollowsTable.following, username)),
    db.select({ count: sql<number>`count(*)::int` }).from(socialFollowsTable).where(eq(socialFollowsTable.follower, username)),
    req.session.username ? db.select({ id: socialFollowsTable.id }).from(socialFollowsTable)
      .where(and(eq(socialFollowsTable.follower, req.session.username), eq(socialFollowsTable.following, username))).limit(1) : Promise.resolve([]),
  ]);
  const repostIds = [...new Set(reposts.map((item) => item.postId))];
  const shared = repostIds.length
    ? await db.select().from(socialPostsTable).where(inArray(socialPostsTable.id, repostIds))
    : [];
  const repostTimes = new Map(reposts.map((item) => [item.postId, item.createdAt.getTime()]));
  const posts = [...new Map([...authored, ...shared].map((post) => [post.id, post])).values()]
    .sort((a, b) => Math.max(b.createdAt.getTime(), repostTimes.get(b.id) || 0) - Math.max(a.createdAt.getTime(), repostTimes.get(a.id) || 0))
    .slice(0, 60);
  res.json({
    ...user, followers: Number(followers[0]?.count || 0), following: Number(following[0]?.count || 0),
    isFollowing: relation.length > 0, posts: await Promise.all(posts.map(row => presentPost(row, req.session.username, repostTimes.has(row.id) ? username : undefined))),
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
  const commentRows = await db.select({ id: socialPostCommentsTable.id }).from(socialPostCommentsTable)
    .where(eq(socialPostCommentsTable.postId, id));
  const commentIds = commentRows.map((comment) => comment.id);
  await db.delete(socialPostsTable).where(eq(socialPostsTable.id, id));
  await db.delete(socialPostLikesTable).where(eq(socialPostLikesTable.postId, id));
  if (commentIds.length) {
    await db.delete(socialCommentLikesTable).where(inArray(socialCommentLikesTable.commentId, commentIds));
    await db.delete(socialCommentRepostsTable).where(inArray(socialCommentRepostsTable.commentId, commentIds));
  }
  await db.delete(socialPostCommentsTable).where(eq(socialPostCommentsTable.postId, id));
  await db.delete(socialPostRepostsTable).where(eq(socialPostRepostsTable.postId, id));
  await db.delete(socialNotificationsTable).where(eq(socialNotificationsTable.postId, id));
  if (post.mediaObjectKey) await cleanupAfterMutation([post.mediaObjectKey]);
  res.json({ ok: true });
});

router.post("/social/posts/:id/like", requireAuth, async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) { res.status(400).json({ error: "Invalid post." }); return; }
  const [post] = await db.select({ id: socialPostsTable.id, author: socialPostsTable.author }).from(socialPostsTable).where(eq(socialPostsTable.id, id)).limit(1);
  if (!post) { res.status(404).json({ error: "Post not found." }); return; }
  const [existing] = await db.select({ id: socialPostLikesTable.id }).from(socialPostLikesTable)
    .where(and(eq(socialPostLikesTable.postId, id), eq(socialPostLikesTable.username, req.session.username!))).limit(1);
  if (existing) await db.delete(socialPostLikesTable).where(eq(socialPostLikesTable.id, existing.id));
  else {
    await db.insert(socialPostLikesTable).values({ postId: id, username: req.session.username! }).onConflictDoNothing();
    if (post.author !== req.session.username) await db.insert(socialNotificationsTable).values({ username: post.author, actor: req.session.username!, postId: id, kind: "like" });
  }
  res.json({ ok: true, liked: !existing });
});

router.post("/social/follow/:username", requireAuth, async (req, res) => {
  const target = String(req.params.username || "").slice(0, 40);
  if (target === req.session.username) { res.status(400).json({ error: "You cannot follow yourself." }); return; }
  if (target !== "SladenatorEatsOfficial") {
    const [user] = await db.select({ username: usersTable.username }).from(usersTable).where(eq(usersTable.username, target)).limit(1);
    if (!user) { res.status(404).json({ error: "User not found." }); return; }
  }
  const [created] = await db.insert(socialFollowsTable).values({ follower: req.session.username!, following: target }).onConflictDoNothing().returning({ id: socialFollowsTable.id });
  if (created && target !== "SladenatorEatsOfficial") await db.insert(socialNotificationsTable).values({ username: target, actor: req.session.username!, kind: "follow" });
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
