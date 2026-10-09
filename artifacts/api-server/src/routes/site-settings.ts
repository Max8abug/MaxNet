import { Router, type IRouter } from "express";
import { createHash } from "node:crypto";
import { db, siteSettingsTable } from "@workspace/db";
import { eq, sql } from "drizzle-orm";
import { requireAdmin } from "../lib/auth";
import { normalizeBlockedPhrases } from "../lib/content-filter";
import { cleanArchivedFeatures, isArchivableFeatureId } from "@workspace/feature-registry";

const router: IRouter = Router();

type CustomButton = { label: string; url: string };

// This public polling route deliberately does not use ensureRow(): it must
// neither load uploaded images nor create settings while serving a read.
router.get("/site-settings/feature-archives", async (req, res) => {
  const [row] = await db.select({
    archivedFeatures: siteSettingsTable.archivedFeatures,
  }).from(siteSettingsTable).limit(1);
  const archivedFeatures = cleanArchivedFeatures(row?.archivedFeatures).sort();
  const body = JSON.stringify({ archivedFeatures });
  const etag = `"archives-${createHash("sha256").update(body).digest("hex")}"`;
  res.set({ "Cache-Control": "public, no-cache", ETag: etag });
  const validators = req.get("If-None-Match")?.split(",") ?? [];
  if (validators.some((value) => value.trim() === "*" || value.trim().replace(/^W\//, "") === etag)) {
    res.status(304).end();
    return;
  }
  res.type("json").send(body);
});

router.put("/site-settings/features/:featureId", requireAdmin, async (req, res) => {
  const featureId = String(req.params.featureId);
  if (!isArchivableFeatureId(featureId) || typeof req.body?.archived !== "boolean") {
    res.status(400).json({ error: "Choose an archivable feature and a boolean archived setting. Administration and settings cannot be archived." });
    return;
  }
  const row = await ensureRow();
  // Change one entry atomically: two administrators archiving different
  // features must not overwrite each other's changes with a stale full list.
  const current = siteSettingsTable.archivedFeatures;
  const [updated] = await db.update(siteSettingsTable).set({
    archivedFeatures: req.body.archived
      ? sql`CASE WHEN ${current} @> ${JSON.stringify([featureId])}::jsonb THEN ${current} ELSE ${current} || ${JSON.stringify([featureId])}::jsonb END`
      : sql`${current} - ${featureId}`,
    updatedAt: new Date(),
  }).where(eq(siteSettingsTable.id, row.id)).returning({ archivedFeatures: current });
  res.set("Cache-Control", "no-store").json({ archivedFeatures: cleanArchivedFeatures(updated!.archivedFeatures) });
});

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
    usernameBlockedPhrases: [],
    chatBlockedPhrases: [],
    forumBlockedPhrases: [],
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
    archivedFeatures: cleanArchivedFeatures(row.archivedFeatures),
    usernameBlockedPhrases: normalizeBlockedPhrases(row.usernameBlockedPhrases),
    chatBlockedPhrases: normalizeBlockedPhrases(row.chatBlockedPhrases),
    forumBlockedPhrases: normalizeBlockedPhrases(row.forumBlockedPhrases),
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
  for (const key of ["usernameBlockedPhrases", "chatBlockedPhrases", "forumBlockedPhrases"] as const) {
    if (!Object.prototype.hasOwnProperty.call(req.body || {}, key)) continue;
    if (!Array.isArray(req.body[key])) {
      res.status(400).json({ error: `${key} must be an array of words or phrases.` });
      return;
    }
    update[key] = normalizeBlockedPhrases(req.body[key]);
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
       archivedFeatures: cleanArchivedFeatures(row.archivedFeatures),
       usernameBlockedPhrases: normalizeBlockedPhrases(row.usernameBlockedPhrases),
       chatBlockedPhrases: normalizeBlockedPhrases(row.chatBlockedPhrases),
       forumBlockedPhrases: normalizeBlockedPhrases(row.forumBlockedPhrases),
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
     archivedFeatures: cleanArchivedFeatures(fresh!.archivedFeatures),
     usernameBlockedPhrases: normalizeBlockedPhrases(fresh!.usernameBlockedPhrases),
     chatBlockedPhrases: normalizeBlockedPhrases(fresh!.chatBlockedPhrases),
     forumBlockedPhrases: normalizeBlockedPhrases(fresh!.forumBlockedPhrases),
  });
});

export default router;
