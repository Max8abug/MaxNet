import { randomUUID } from "node:crypto";
import { Router, type IRouter, type Request } from "express";
import { db, youtubeSyncTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { requireAuth } from "../lib/auth";
import { isBanned, audit } from "./social";
import { getUserPermissions } from "./ranks";

const router: IRouter = Router();

type QueueItem = {
  id: string;
  videoId: string;
  addedBy: string;
  addedAt: string;
};
type Vote = "skip" | "keep";
const MIN_SKIP_VOTES = 3;

function cleanVideoId(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const id = value.trim();
  return /^[A-Za-z0-9_-]{11}$/.test(id) ? id : null;
}

function cleanQueue(value: unknown): QueueItem[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is QueueItem => (
    !!item &&
    typeof item === "object" &&
    typeof (item as QueueItem).id === "string" &&
    typeof (item as QueueItem).videoId === "string" &&
    !!cleanVideoId((item as QueueItem).videoId) &&
    typeof (item as QueueItem).addedBy === "string" &&
    typeof (item as QueueItem).addedAt === "string"
  ));
}

function cleanVotes(value: unknown): Record<string, Vote> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const result: Record<string, Vote> = {};
  for (const [username, vote] of Object.entries(value)) {
    if (vote === "skip" || vote === "keep") result[username] = vote;
  }
  return result;
}

async function canManagePlayback(req: Request): Promise<boolean> {
  if (!req.session.userId) return false;
  if (req.session.isAdmin) return true;
  const permissions = await getUserPermissions(req.session.username);
  return permissions.includes("youtubeMaster");
}

async function ensureRow() {
  const [row] = await db.select().from(youtubeSyncTable).limit(1);
  if (row) return row;
  const [created] = await db
    .insert(youtubeSyncTable)
    .values({ videoId: "", setBy: "", queue: [], skipVotes: {} })
    .returning();
  return created;
}

async function responseFor(req: Request, row: typeof youtubeSyncTable.$inferSelect) {
  const queue = cleanQueue(row.queue);
  const votes = cleanVotes(row.skipVotes);
  const voteValues = Object.values(votes);
  return {
    videoId: row.videoId,
    startedAt: row.startedAt,
    setBy: row.setBy,
    serverNow: new Date().toISOString(),
    queue,
    skipCount: voteValues.filter((vote) => vote === "skip").length,
    totalVotes: voteValues.length,
    myVote: req.session.username ? (votes[req.session.username] || null) : null,
    canManage: await canManagePlayback(req),
  };
}

router.get("/youtube/sync", async (req, res) => {
  const row = await ensureRow();
  res.json(await responseFor(req, row));
});

router.post("/youtube/sync", requireAuth, async (req, res) => {
  if (!(await canManagePlayback(req))) {
    res.status(403).json({ error: "You need the YouTube Master permission to play a video for everyone." });
    return;
  }
  const videoId = cleanVideoId(req.body?.videoId);
  if (!videoId) {
    res.status(400).json({ error: "A valid YouTube video ID is required" });
    return;
  }
  const author = req.session.username!;
  if (await isBanned(author)) {
    res.status(403).json({ error: "You are banned." });
    return;
  }
  const row = await ensureRow();
  const [updated] = await db
    .update(youtubeSyncTable)
    .set({ videoId, startedAt: new Date(), setBy: author, skipVotes: {} })
    .where(eq(youtubeSyncTable.id, row.id))
    .returning();
  await audit("youtube", "set", author, "", videoId);
  res.json(await responseFor(req, updated));
});

router.post("/youtube/queue", requireAuth, async (req, res) => {
  const videoId = cleanVideoId(req.body?.videoId);
  if (!videoId) {
    res.status(400).json({ error: "A valid YouTube video ID is required" });
    return;
  }
  const author = req.session.username!;
  if (await isBanned(author)) {
    res.status(403).json({ error: "You are banned." });
    return;
  }
  const row = await ensureRow();
  const queue = cleanQueue(row.queue);

  // If the player is empty, the first queued video becomes the current video
  // so a new site does not require two separate actions to start playback.
  if (!row.videoId) {
    const [updated] = await db.update(youtubeSyncTable)
      .set({ videoId, startedAt: new Date(), setBy: author, skipVotes: {} })
      .where(eq(youtubeSyncTable.id, row.id))
      .returning();
    await audit("youtube", "queue-start", author, "", videoId);
    res.json(await responseFor(req, updated));
    return;
  }

  const item: QueueItem = {
    id: randomUUID(),
    videoId,
    addedBy: author,
    addedAt: new Date().toISOString(),
  };
  const [updated] = await db.update(youtubeSyncTable)
    .set({ queue: [...queue, item] })
    .where(eq(youtubeSyncTable.id, row.id))
    .returning();
  await audit("youtube", "queue-add", author, "", videoId);
  res.json(await responseFor(req, updated));
});

router.patch("/youtube/queue", requireAuth, async (req, res) => {
  if (!(await canManagePlayback(req))) {
    res.status(403).json({ error: "You need the YouTube Master permission to manage the queue." });
    return;
  }
  const requestedIds = req.body?.queue;
  if (!Array.isArray(requestedIds) || requestedIds.some((id) => typeof id !== "string")) {
    res.status(400).json({ error: "queue must be an array of item IDs" });
    return;
  }
  const row = await ensureRow();
  const queue = cleanQueue(row.queue);
  const byId = new Map(queue.map((item) => [item.id, item]));
  const ids = requestedIds as string[];
  if (
    ids.length !== queue.length ||
    new Set(ids).size !== ids.length ||
    ids.some((id) => !byId.has(id))
  ) {
    res.status(400).json({ error: "Queue must contain the same items in a new order" });
    return;
  }
  const [updated] = await db.update(youtubeSyncTable)
    .set({ queue: ids.map((id) => byId.get(id)!) })
    .where(eq(youtubeSyncTable.id, row.id))
    .returning();
  await audit("youtube", "queue-reorder", req.session.username!, "", JSON.stringify(ids));
  res.json(await responseFor(req, updated));
});

router.delete("/youtube/queue/:itemId", requireAuth, async (req, res) => {
  if (!(await canManagePlayback(req))) {
    res.status(403).json({ error: "You need the YouTube Master permission to manage the queue." });
    return;
  }
  const row = await ensureRow();
  const itemId = String(req.params.itemId || "");
  const queue = cleanQueue(row.queue);
  if (!queue.some((item) => item.id === itemId)) {
    res.status(404).json({ error: "Queue item not found" });
    return;
  }
  const [updated] = await db.update(youtubeSyncTable)
    .set({ queue: queue.filter((item) => item.id !== itemId) })
    .where(eq(youtubeSyncTable.id, row.id))
    .returning();
  await audit("youtube", "queue-remove", req.session.username!, itemId, "");
  res.json(await responseFor(req, updated));
});

router.post("/youtube/skip-vote", requireAuth, async (req, res) => {
  const vote = req.body?.vote;
  if (vote !== "skip" && vote !== "keep") {
    res.status(400).json({ error: "Vote must be skip or keep" });
    return;
  }
  const author = req.session.username!;
  if (await isBanned(author)) {
    res.status(403).json({ error: "You are banned." });
    return;
  }
  const row = await ensureRow();
  if (!row.videoId) {
    res.status(400).json({ error: "There is no video playing" });
    return;
  }
  const votes = cleanVotes(row.skipVotes);
  votes[author] = vote;
  const skipCount = Object.values(votes).filter((value) => value === "skip").length;
  const totalVotes = Object.keys(votes).length;
  // A single voter should never be able to blank the shared player. The
  // ratio is still strictly greater than 2/3, but playback changes only after
  // at least three people have voted on this video.
  const hasSkipMajority = totalVotes >= MIN_SKIP_VOTES && skipCount * 3 > totalVotes * 2;
  const queue = cleanQueue(row.queue);

  if (hasSkipMajority) {
    const next = queue[0];
    const [updated] = await db.update(youtubeSyncTable)
      .set({
        videoId: next?.videoId || "",
        startedAt: new Date(),
        setBy: next ? next.addedBy : "",
        queue: next ? queue.slice(1) : [],
        skipVotes: {},
      })
      .where(eq(youtubeSyncTable.id, row.id))
      .returning();
    await audit("youtube", "skip-majority", author, "", `${row.videoId} (${skipCount}/${totalVotes})`);
    res.json(await responseFor(req, updated));
    return;
  }

  const [updated] = await db.update(youtubeSyncTable)
    .set({ skipVotes: votes })
    .where(eq(youtubeSyncTable.id, row.id))
    .returning();
  await audit("youtube", "skip-vote", author, "", `${vote} (${skipCount}/${totalVotes})`);
  res.json(await responseFor(req, updated));
});

export default router;