import { Router, type IRouter } from "express";
import { db, userPagesTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { requireAuth } from "../lib/auth";

const router: IRouter = Router();

router.get("/userpages/:username", async (req, res) => {
  const u = String(req.params.username);
  const [row] = await db.select().from(userPagesTable).where(eq(userPagesTable.username, u)).limit(1);
  res.json({ page: row || null });
});

router.put("/userpages", requireAuth, async (req, res) => {
  const { dataUrl } = req.body ?? {};
  if (typeof dataUrl !== "string" || !dataUrl.startsWith("data:image/")) { res.status(400).json({ error: "data:image/* required" }); return; }
  if (dataUrl.length > 1_500_000) { res.status(413).json({ error: "Too large" }); return; }
  const me = req.session.username!;
  const [existing] = await db.select().from(userPagesTable).where(eq(userPagesTable.username, me)).limit(1);
  if (existing) {
    await db.update(userPagesTable).set({ dataUrl, updatedAt: new Date() }).where(eq(userPagesTable.username, me));
  } else {
    await db.insert(userPagesTable).values({ username: me, dataUrl });
  }
  res.json({ ok: true });
});

export default router;
