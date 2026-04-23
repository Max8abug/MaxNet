import { Router, type IRouter } from "express";
import { db, forumThreadsTable, forumPostsTable } from "@workspace/db";
import { desc, eq, sql } from "drizzle-orm";
import { requireAuth, requireAdmin } from "../lib/auth";
import { isBanned, audit } from "./social";

const router: IRouter = Router();

router.get("/forum/threads", async (_req, res) => {
  const rows = await db
    .select({
      id: forumThreadsTable.id,
      title: forumThreadsTable.title,
      author: forumThreadsTable.author,
      createdAt: forumThreadsTable.createdAt,
      postCount: sql<number>`(select count(*) from ${forumPostsTable} where ${forumPostsTable.threadId} = ${forumThreadsTable.id})`,
    })
    .from(forumThreadsTable)
    .orderBy(desc(forumThreadsTable.createdAt))
    .limit(200);
  res.json(rows);
});

router.post("/forum/threads", requireAuth, async (req, res) => {
  const { title, body } = req.body ?? {};
  if (typeof title !== "string" || !title.trim()) { res.status(400).json({ error: "title required" }); return; }
  if (typeof body !== "string" || !body.trim()) { res.status(400).json({ error: "body required" }); return; }
  if (title.length > 120) { res.status(413).json({ error: "Title too long" }); return; }
  if (body.length > 2000) { res.status(413).json({ error: "Body too long" }); return; }
  const author = req.session.username!;
  if (await isBanned(author)) {
    await audit("forum", "blocked", author, author, title.trim().slice(0, 200));
    res.status(403).json({ error: "You are banned." });
    return;
  }
  const [thread] = await db.insert(forumThreadsTable).values({ title: title.trim().slice(0, 120), author }).returning();
  await db.insert(forumPostsTable).values({ threadId: thread.id, author, body: body.trim() });
  await audit("forum", "thread", author, "", title.trim().slice(0, 120));
  res.json(thread);
});

router.get("/forum/threads/:id", async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isFinite(id)) { res.status(400).json({ error: "bad id" }); return; }
  const [thread] = await db.select().from(forumThreadsTable).where(eq(forumThreadsTable.id, id)).limit(1);
  if (!thread) { res.status(404).json({ error: "not found" }); return; }
  const posts = await db.select().from(forumPostsTable).where(eq(forumPostsTable.threadId, id)).orderBy(forumPostsTable.createdAt);
  res.json({ thread, posts });
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
  if (await isBanned(author)) {
    await audit("forum", "blocked", author, author, trimmed.slice(0, 200));
    res.status(403).json({ error: "You are banned." });
    return;
  }
  const [post] = await db.insert(forumPostsTable).values({ threadId: id, author, body: trimmed, imageUrl: imageUrl || null }).returning();
  await audit("forum", "post", author, "", trimmed + (imageUrl ? " [image]" : ""));
  res.json(post);
});

router.delete("/forum/posts/:id", requireAdmin, async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isFinite(id)) { res.status(400).json({ error: "bad id" }); return; }
  const [existing] = await db.select().from(forumPostsTable).where(eq(forumPostsTable.id, id)).limit(1);
  if (!existing) { res.status(404).json({ error: "not found" }); return; }
  await db.delete(forumPostsTable).where(eq(forumPostsTable.id, id));
  await audit("forum", "delete", req.session.username || "admin", existing.author, existing.body);
  res.json({ ok: true });
});

router.delete("/forum/threads/:id", requireAdmin, async (req, res) => {
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
