import { Router, type IRouter } from "express";
import { db, forumThreadsTable, forumPostsTable } from "@workspace/db";
import { desc, eq, sql } from "drizzle-orm";
import { requireAuth, requireAdmin, hashPassword, verifyPassword } from "../lib/auth";
import { isBanned, audit, requireDeleteMessages } from "./social";
import { findBlockedPhrase, getBlockedPhrases } from "../lib/content-filter";

const router: IRouter = Router();

router.get("/forum/threads", async (_req, res) => {
  const rows = await db
    .select({
      id: forumThreadsTable.id,
      title: forumThreadsTable.title,
      author: forumThreadsTable.author,
      pinned: forumThreadsTable.pinned,
      lastActivityAt: forumThreadsTable.lastActivityAt,
      createdAt: forumThreadsTable.createdAt,
      hasPassword: sql<boolean>`${forumThreadsTable.passwordHash} is not null`,
    })
    .from(forumThreadsTable)
    .orderBy(desc(forumThreadsTable.pinned), desc(forumThreadsTable.lastActivityAt), desc(forumThreadsTable.createdAt))
    .limit(200);

  // Count posts independently and join the result in memory. This avoids
  // relying on a correlated SQL expression whose outer-table reference can be
  // miscompiled by different Drizzle/Postgres versions.
  const counts = await db
    .select({
      threadId: forumPostsTable.threadId,
      postCount: sql<number>`count(*)`,
    })
    .from(forumPostsTable)
    .groupBy(forumPostsTable.threadId);
  const countByThread = new Map(counts.map((row) => [row.threadId, Number(row.postCount)]));

  res.json(rows.map((row) => ({ ...row, postCount: countByThread.get(row.id) ?? 0 })));
});

router.post("/forum/threads", requireAuth, async (req, res) => {
  const { title, body, password } = req.body ?? {};
  if (typeof title !== "string" || !title.trim()) { res.status(400).json({ error: "title required" }); return; }
  if (typeof body !== "string" || !body.trim()) { res.status(400).json({ error: "body required" }); return; }
  if (title.length > 120) { res.status(413).json({ error: "Title too long" }); return; }
  if (body.length > 2000) { res.status(413).json({ error: "Body too long" }); return; }
  const author = req.session.username!;
  const forumBlocked = await getBlockedPhrases("forum");
  if (findBlockedPhrase(title, forumBlocked) || findBlockedPhrase(body, forumBlocked)) {
    await audit("forum", "blocked-word", author, author, title.trim().slice(0, 200));
    res.status(400).json({ error: "Your thread contains a blocked word or phrase." });
    return;
  }
  if (await isBanned(author)) {
    await audit("forum", "blocked", author, author, title.trim().slice(0, 200));
    res.status(403).json({ error: "You are banned." });
    return;
  }
  const passwordHash = (typeof password === "string" && password.length >= 1) ? await hashPassword(password) : null;
  const [thread] = await db.insert(forumThreadsTable).values({ title: title.trim().slice(0, 120), author, passwordHash }).returning();
  await db.insert(forumPostsTable).values({ threadId: thread.id, author, body: body.trim() });
  await db.update(forumThreadsTable).set({ lastActivityAt: new Date() }).where(eq(forumThreadsTable.id, thread.id));
  await audit("forum", "thread", author, "", title.trim().slice(0, 120));
  res.json({ ...thread, passwordHash: undefined, hasPassword: !!passwordHash });
});

router.patch("/forum/threads/:id/pin", requireAdmin, async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) { res.status(400).json({ error: "bad id" }); return; }
  const [existing] = await db.select().from(forumThreadsTable).where(eq(forumThreadsTable.id, id)).limit(1);
  if (!existing) { res.status(404).json({ error: "not found" }); return; }
  const pinned = req.body?.pinned === true;
  const [updated] = await db.update(forumThreadsTable).set({ pinned }).where(eq(forumThreadsTable.id, id)).returning();
  await audit("forum", pinned ? "pin-thread" : "unpin-thread", req.session.username || "admin", existing.author, existing.title);
  res.json({ ...updated, passwordHash: undefined, hasPassword: !!updated.passwordHash });
});

router.post("/forum/threads/:id/unlock", async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isFinite(id)) { res.status(400).json({ error: "bad id" }); return; }
  const [thread] = await db.select().from(forumThreadsTable).where(eq(forumThreadsTable.id, id)).limit(1);
  if (!thread) { res.status(404).json({ error: "not found" }); return; }
  if (!thread.passwordHash) { res.json({ ok: true }); return; }
  const ok = typeof req.body?.password === "string" && await verifyPassword(req.body.password, thread.passwordHash);
  if (!ok) { res.status(401).json({ error: "Wrong password" }); return; }
  (req.session as any).forumUnlocked = { ...((req.session as any).forumUnlocked || {}), [id]: true };
  res.json({ ok: true });
});

router.get("/forum/threads/:id", async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isFinite(id)) { res.status(400).json({ error: "bad id" }); return; }
  const [thread] = await db.select().from(forumThreadsTable).where(eq(forumThreadsTable.id, id)).limit(1);
  if (!thread) { res.status(404).json({ error: "not found" }); return; }
  const sessUnlocked = (req.session as any).forumUnlocked || {};
  const isOwner = req.session.username && req.session.username === thread.author;
  if (thread.passwordHash && !sessUnlocked[id] && !isOwner && !req.session.isAdmin) {
    res.status(403).json({ error: "password required", needsPassword: true, thread: { id: thread.id, title: thread.title, author: thread.author, hasPassword: true, createdAt: thread.createdAt } });
    return;
  }
  const posts = await db.select().from(forumPostsTable).where(eq(forumPostsTable.threadId, id)).orderBy(forumPostsTable.createdAt, forumPostsTable.id);
  res.json({ thread: { ...thread, passwordHash: undefined, hasPassword: !!thread.passwordHash }, posts });
});

router.post("/forum/threads/:id/posts", requireAuth, async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isFinite(id)) { res.status(400).json({ error: "bad id" }); return; }
  const { body, imageUrl } = req.body ?? {};
  const trimmed = typeof body === "string" ? body.trim() : "";
  if (!trimmed && !imageUrl) { res.status(400).json({ error: "body or image required" }); return; }
  if (trimmed.length > 2000) { res.status(413).json({ error: "Body too long" }); return; }
  if (imageUrl !== undefined && imageUrl !== null) {
    if (typeof imageUrl !== "string" || !imageUrl.startsWith("data:image/") || imageUrl.length > 3_000_000) {
      res.status(400).json({ error: "bad imageUrl" }); return;
    }
  }
  const author = req.session.username!;
  if (findBlockedPhrase(trimmed, await getBlockedPhrases("forum"))) {
    await audit("forum", "blocked-word", author, author, trimmed.slice(0, 200));
    res.status(400).json({ error: "Your post contains a blocked word or phrase." });
    return;
  }
  if (await isBanned(author)) {
    await audit("forum", "blocked", author, author, trimmed.slice(0, 200));
    res.status(403).json({ error: "You are banned." });
    return;
  }
  const [post] = await db.insert(forumPostsTable).values({ threadId: id, author, body: trimmed, imageUrl: imageUrl || null }).returning();
  await db.update(forumThreadsTable).set({ lastActivityAt: new Date() }).where(eq(forumThreadsTable.id, id));
  await audit("forum", "post", author, "", trimmed + (imageUrl ? " [image]" : ""));
  res.json(post);
});

router.delete("/forum/posts/:id", requireDeleteMessages, async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isFinite(id)) { res.status(400).json({ error: "bad id" }); return; }
  const [existing] = await db.select().from(forumPostsTable).where(eq(forumPostsTable.id, id)).limit(1);
  if (!existing) { res.status(404).json({ error: "not found" }); return; }
  await db.delete(forumPostsTable).where(eq(forumPostsTable.id, id));
  await audit("forum", "delete", req.session.username || "admin", existing.author, existing.body);
  res.json({ ok: true });
});

router.delete("/forum/threads/:id", requireDeleteMessages, async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isFinite(id)) { res.status(400).json({ error: "bad id" }); return; }
  const [existing] = await db.select().from(forumThreadsTable).where(eq(forumThreadsTable.id, id)).limit(1);
  if (!existing) { res.status(404).json({ error: "not found" }); return; }
  await db.delete(forumPostsTable).where(eq(forumPostsTable.threadId, id));
  await db.delete(forumThreadsTable).where(eq(forumThreadsTable.id, id));
  await audit("forum", "delete-thread", req.session.username || "admin", existing.author, existing.title);
  res.json({ ok: true });
});

export default router;
