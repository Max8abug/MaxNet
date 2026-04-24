import { Router, type IRouter } from "express";
import { db, siteSettingsTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { requireAdmin } from "../lib/auth";

const router: IRouter = Router();

async function ensureRow() {
  const [row] = await db.select().from(siteSettingsTable).limit(1);
  if (row) return row;
  await db.insert(siteSettingsTable).values({ logoDataUrl: "", siteName: "Portfolio 98" });
  const [created] = await db.select().from(siteSettingsTable).limit(1);
  return created!;
}

router.get("/site-settings", async (_req, res) => {
  const row = await ensureRow();
  res.json({ logoDataUrl: row.logoDataUrl || "", siteName: row.siteName || "Portfolio 98" });
});

router.put("/site-settings", requireAdmin, async (req, res) => {
  const row = await ensureRow();
  const update: Record<string, any> = {};
  if (typeof req.body?.logoDataUrl === "string") {
    // Cap at ~512KB so we don't blow up the response payload everywhere this is fetched.
    if (req.body.logoDataUrl.length > 600_000) {
      res.status(400).json({ error: "Logo image is too large (max ~400KB). Please pick a smaller image." });
      return;
    }
    update.logoDataUrl = req.body.logoDataUrl;
  }
  if (typeof req.body?.siteName === "string") {
    const name = req.body.siteName.trim().slice(0, 60);
    if (name.length > 0) update.siteName = name;
  }
  if (Object.keys(update).length === 0) {
    res.json({ ok: true, logoDataUrl: row.logoDataUrl, siteName: row.siteName });
    return;
  }
  update.updatedAt = new Date();
  await db.update(siteSettingsTable).set(update).where(eq(siteSettingsTable.id, row.id));
  const [fresh] = await db.select().from(siteSettingsTable).where(eq(siteSettingsTable.id, row.id));
  res.json({ ok: true, logoDataUrl: fresh!.logoDataUrl, siteName: fresh!.siteName });
});

export default router;
