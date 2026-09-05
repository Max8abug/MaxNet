import { Router, type IRouter } from "express";
import { db, siteSettingsTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { requireAdmin } from "../lib/auth";

const router: IRouter = Router();

type CustomButton = { label: string; url: string };

function cleanCustomButtons(value: unknown): CustomButton[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((button): button is Record<string, unknown> => !!button && typeof button === "object" && !Array.isArray(button))
    .map((button) => ({
      label: typeof button.label === "string" ? button.label.trim().slice(0, 32) : "",
      url: typeof button.url === "string" ? button.url.trim().slice(0, 500) : "",
    }))
    .filter((button) => (
      button.label.length > 0 &&
      /^https?:\/\/[^\s]+$/i.test(button.url)
    ))
    .slice(0, 8);
}

async function ensureRow() {
  const [row] = await db.select().from(siteSettingsTable).limit(1);
  if (row) return row;
  await db.insert(siteSettingsTable).values({
    logoDataUrl: "",
    darkLogoDataUrl: "",
    backgroundDataUrl: "",
    darkBackgroundDataUrl: "",
    mobileBackgroundDataUrl: "",
    mobileDarkBackgroundDataUrl: "",
    chatCooldownEnabled: true,
    siteName: "Portfolio 98",
    customButtons: [],
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
    mobileBackgroundDataUrl: row.mobileBackgroundDataUrl || "",
    mobileDarkBackgroundDataUrl: row.mobileDarkBackgroundDataUrl || "",
    chatCooldownEnabled: row.chatCooldownEnabled !== false,
    siteName: row.siteName || "Portfolio 98",
    customButtons: cleanCustomButtons(row.customButtons),
  });
});

router.put("/site-settings", requireAdmin, async (req, res) => {
  const row = await ensureRow();
  const update: Record<string, any> = {};
  for (const key of [
    "logoDataUrl",
    "darkLogoDataUrl",
    "backgroundDataUrl",
    "darkBackgroundDataUrl",
    "mobileBackgroundDataUrl",
    "mobileDarkBackgroundDataUrl",
  ] as const) {
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
  if (typeof req.body?.chatCooldownEnabled === "boolean") {
    update.chatCooldownEnabled = req.body.chatCooldownEnabled;
  }
  if (typeof req.body?.siteName === "string") {
    const name = req.body.siteName.trim().slice(0, 60);
    if (name.length > 0) update.siteName = name;
  }
  if (req.body && Object.prototype.hasOwnProperty.call(req.body, "customButtons")) {
    const buttons = cleanCustomButtons(req.body.customButtons);
    if (Array.isArray(req.body.customButtons) && buttons.length !== req.body.customButtons.length) {
      res.status(400).json({ error: "Each custom button needs a label and a valid http(s) URL." });
      return;
    }
    update.customButtons = buttons;
  }
  if (Object.keys(update).length === 0) {
    res.json({
      ok: true,
      logoDataUrl: row.logoDataUrl,
      darkLogoDataUrl: row.darkLogoDataUrl,
      backgroundDataUrl: row.backgroundDataUrl,
      darkBackgroundDataUrl: row.darkBackgroundDataUrl,
      mobileBackgroundDataUrl: row.mobileBackgroundDataUrl,
      mobileDarkBackgroundDataUrl: row.mobileDarkBackgroundDataUrl,
      chatCooldownEnabled: row.chatCooldownEnabled !== false,
      siteName: row.siteName,
       customButtons: cleanCustomButtons(row.customButtons),
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
    mobileBackgroundDataUrl: fresh!.mobileBackgroundDataUrl,
    mobileDarkBackgroundDataUrl: fresh!.mobileDarkBackgroundDataUrl,
    chatCooldownEnabled: fresh!.chatCooldownEnabled !== false,
    siteName: fresh!.siteName,
     customButtons: cleanCustomButtons(fresh!.customButtons),
  });
});

export default router;
