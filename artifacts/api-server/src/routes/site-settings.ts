import { Router, type IRouter } from "express";
import { db, siteSettingsTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { requireAdmin } from "../lib/auth";

const router: IRouter = Router();

async function ensureRow() {
  const [row] = await db.select().from(siteSettingsTable).limit(1);
  if (row) return row;
  await db.insert(siteSettingsTable).values({
    logoDataUrl: "",
    darkLogoDataUrl: "",
    backgroundDataUrl: "",
    darkBackgroundDataUrl: "",
    siteName: "Portfolio 98",
  });
  const [created] = await db.select().from(siteSettingsTable).limit(1);
  return created!;
}

router.get("/site-settings", async (_req, res) => {
  const row = await ensureRow();
  res.json({
    logoDataUrl: row.logoDataUrl || "",
    darkLogoDataUrl: row.darkLogoDataUrl || "",
    backgroundDataUrl: row.backgroundDataUrl || "",
    darkBackgroundDataUrl: row.darkBackgroundDataUrl || "",
    siteName: row.siteName || "Portfolio 98",
  });
});

router.put("/site-settings", requireAdmin, async (req, res) => {
  const row = await ensureRow();
  const update: Record<string, any> = {};
  for (const key of ["logoDataUrl", "darkLogoDataUrl", "backgroundDataUrl", "darkBackgroundDataUrl"] as const) {
    if (typeof req.body?.[key] === "string") {
      const maxSize = key.includes("Background") ? 4_000_000 : 600_000;
      if (req.body[key].length > maxSize) {
        res.status(400).json({
          error: key.includes("Background")
            ? "Background image is too large (max 4MB). Please pick a smaller image."
            : "Logo image is too large (max ~400KB). Please pick a smaller image.",
        });
        return;
      }
      update[key] = req.body[key];
    }
  }
  if (typeof req.body?.siteName === "string") {
    const name = req.body.siteName.trim().slice(0, 60);
    if (name.length > 0) update.siteName = name;
  }
  if (Object.keys(update).length === 0) {
    res.json({
      ok: true,
      logoDataUrl: row.logoDataUrl,
      darkLogoDataUrl: row.darkLogoDataUrl,
      backgroundDataUrl: row.backgroundDataUrl,
      darkBackgroundDataUrl: row.darkBackgroundDataUrl,
      siteName: row.siteName,
    });
    return;
  }
  update.updatedAt = new Date();
  await db.update(siteSettingsTable).set(update).where(eq(siteSettingsTable.id, row.id));
  const [fresh] = await db.select().from(siteSettingsTable).where(eq(siteSettingsTable.id, row.id));
  res.json({
    ok: true,
    logoDataUrl: fresh!.logoDataUrl,
    darkLogoDataUrl: fresh!.darkLogoDataUrl,
    backgroundDataUrl: fresh!.backgroundDataUrl,
    darkBackgroundDataUrl: fresh!.darkBackgroundDataUrl,
    siteName: fresh!.siteName,
  });
});

export default router;
