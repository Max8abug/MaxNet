import { Router, type IRouter } from "express";
import { db, youtubeSyncTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { requireAuth } from "../lib/auth";
import { isBanned, audit } from "./social";

const router: IRouter = Router();

async function ensureRow() {
  const [row] = await db.select().from(youtubeSyncTable).limit(1);
  if (row) return row;
  const [created] = await db
    .insert(youtubeSyncTable)
    .values({ videoId: "", setBy: "" })
    .returning();
  return created;
}

router.get("/youtube/sync", async (_req, res) => {
  const row = await ensureRow();
  res.json({
    videoId: row.videoId,
    startedAt: row.startedAt,
    setBy: row.setBy,
    serverNow: new Date().toISOString(),
  });
});

router.post("/youtube/sync", requireAuth, async (req, res) => {
  const { videoId } = req.body ?? {};
  if (typeof videoId !== "string" || videoId.length > 32) {
    res.status(400).json({ error: "videoId required" });
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
    .set({ videoId, startedAt: new Date(), setBy: author })
    .where(eq(youtubeSyncTable.id, row.id))
    .returning();
  await audit("youtube", "set", author, "", videoId);
  res.json({ videoId: updated.videoId, startedAt: updated.startedAt, setBy: updated.setBy });
});

export default router;
