import { Router, type IRouter } from "express";
import { db, flappyPlayersTable, flappyScoresTable } from "@workspace/db";
import { desc, eq, gt, sql } from "drizzle-orm";
import { requireAuth } from "../lib/auth";

const router: IRouter = Router();

router.get("/flappy/state", async (_req, res) => {
  const cutoff = new Date(Date.now() - 5000); // active in last 5s
  const players = await db
    .select()
    .from(flappyPlayersTable)
    .where(gt(flappyPlayersTable.updatedAt, cutoff));
  const top = await db
    .select()
    .from(flappyScoresTable)
    .orderBy(desc(flappyScoresTable.score))
    .limit(10);
  res.json({ players, top });
});

router.post("/flappy/tick", requireAuth, async (req, res) => {
  const username = req.session.username!;
  const { y, score, alive } = req.body ?? {};
  const ny = Number(y);
  const ns = Number(score);
  const na = !!alive;
  if (!Number.isFinite(ny) || !Number.isFinite(ns)) {
    res.status(400).json({ error: "y/score required" });
    return;
  }
  // Upsert
  const [existing] = await db.select().from(flappyPlayersTable).where(eq(flappyPlayersTable.username, username)).limit(1);
  if (existing) {
    await db
      .update(flappyPlayersTable)
      .set({ y: Math.round(ny), score: Math.round(ns), alive: na, updatedAt: new Date() })
      .where(eq(flappyPlayersTable.username, username));
  } else {
    await db.insert(flappyPlayersTable).values({ username, y: Math.round(ny), score: Math.round(ns), alive: na });
  }
  res.json({ ok: true });
});

router.post("/flappy/score", requireAuth, async (req, res) => {
  const username = req.session.username!;
  const { score } = req.body ?? {};
  const s = Number(score);
  if (!Number.isFinite(s) || s < 0 || s > 100000) {
    res.status(400).json({ error: "bad score" });
    return;
  }
  await db.insert(flappyScoresTable).values({ username, score: Math.round(s) });
  res.json({ ok: true });
});

export default router;
