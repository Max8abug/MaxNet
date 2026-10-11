import { Router, type IRouter } from "express";
import { createHash, randomUUID } from "node:crypto";
import { db, siteSettingsTable } from "@workspace/db";
import { eq, sql } from "drizzle-orm";
import { requireAdmin } from "../lib/auth";
import { appStorage } from "../lib/app-storage";
import { normalizeBlockedPhrases } from "../lib/content-filter";
import { cleanArchivedFeatures, isArchivableFeatureId } from "@workspace/feature-registry";
import { cleanupAfterMutation, lockStorage, queueCleanup, trackUpload } from "../lib/storage-mutations";
import { logger } from "../lib/logger";

const router: IRouter = Router();

type CustomButton = { label: string; url: string };
const REVIEWABLE_GAME_PORT_IDS = new Set([
  "amongus", "acgamecube", "classof09", "cuphead", "deltatraveler", "deltarune",
  "gangbeasts", "hillclimb", "untitledgoose", "oneshot",
  "minesweeperplus", "nightinthewoods", "tattletail", "tabs", "daddygame",
    "webbalatro", "chocolatedoom", "ducklifeadventure", "duke3d", "dumbways",
    "qwasm", "qwasm2", "quake3", "hitandrun", "wolf4sdl",
]);

function cleanGamePortApprovals(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.filter(
    (id): id is string => typeof id === "string" && REVIEWABLE_GAME_PORT_IDS.has(id),
  ))];
}

router.get("/site-settings/game-ports", async (_req, res) => {
  const [row] = await db.select({
    gamePortApprovals: siteSettingsTable.gamePortApprovals,
  }).from(siteSettingsTable).limit(1);
  res.set("Cache-Control", "no-store").json({
    approvedGamePorts: cleanGamePortApprovals(row?.gamePortApprovals),
  });
});

router.put("/site-settings/game-ports/:gameId", requireAdmin, async (req, res) => {
  const gameId = String(req.params.gameId);
  if (!REVIEWABLE_GAME_PORT_IDS.has(gameId) || typeof req.body?.approved !== "boolean") {
    res.status(400).json({ error: "Choose a pending game port and a boolean approved setting." });
    return;
  }
  const row = await ensureRow();
  const current = siteSettingsTable.gamePortApprovals;
  const [updated] = await db.update(siteSettingsTable).set({
    gamePortApprovals: req.body.approved
      ? sql`CASE WHEN ${current} @> ${JSON.stringify([gameId])}::jsonb THEN ${current} ELSE ${current} || ${JSON.stringify([gameId])}::jsonb END`
      : sql`${current} - ${gameId}`,
    updatedAt: new Date(),
  }).where(eq(siteSettingsTable.id, row.id)).returning({ gamePortApprovals: current });
  res.set("Cache-Control", "no-store").json({
    approvedGamePorts: cleanGamePortApprovals(updated?.gamePortApprovals),
  });
});

function cleanGamePortIcons(value: unknown): Record<string, string> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return Object.fromEntries(Object.entries(value).filter(([key, url]) => {
    if (!/^[a-z0-9-]{1,64}$/.test(key) || typeof url !== "string" || url.length > 2048) return false;
    const uploaded = parseStoredGameIcon(url, key);
    if (uploaded) return true;
    try { return new URL(url).protocol === "https:"; } catch { return false; }
  }).map(([key, value]) => {
    const objectKey = parseStoredGameIcon(value as string, key);
    return [key, objectKey
      ? `/api/site-settings/game-icons/${key}/image?v=${encodeURIComponent(objectKey.split("/").at(-1) ?? "")}`
      : value];
  }));
}

function parseStoredGameIcon(value: string, gameId: string): string | null {
  const prefix = `storage:game-icons/${gameId}/`;
  if (!value.startsWith(prefix)) return null;
  const objectKey = value.slice("storage:".length);
  return /^game-icons\/[a-z0-9-]{1,64}\/[0-9a-f-]{36}\.png$/.test(objectKey) ? objectKey : null;
}

function parseGameIconPng(value: unknown): Buffer | null {
  if (typeof value !== "string" || value.length > 1_400_000) return null;
  const match = /^data:image\/png;base64,([A-Za-z0-9+/]*={0,2})$/i.exec(value);
  if (!match) return null;
  const bytes = Buffer.from(match[1], "base64");
  if (bytes.length < 24 || bytes.length > 1_000_000 ||
      !bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])) ||
      bytes.toString("ascii", 12, 16) !== "IHDR") return null;
  const width = bytes.readUInt32BE(16);
  const height = bytes.readUInt32BE(20);
  return width > 0 && height > 0 && width <= 2048 && height <= 2048 ? bytes : null;
}

router.get("/site-settings/game-icons", async (_req, res) => {
  const [row] = await db.select({ gamePortIcons: siteSettingsTable.gamePortIcons })
    .from(siteSettingsTable).limit(1);
  res.set("Cache-Control", "no-store").json({ gameIcons: cleanGamePortIcons(row?.gamePortIcons) });
});

router.get("/site-settings/game-icons/:gameId/image", async (req, res) => {
  const gameId = String(req.params.gameId);
  if (!/^[a-z0-9-]{1,64}$/.test(gameId)) { res.status(404).end(); return; }
  const [row] = await db.select({ gamePortIcons: siteSettingsTable.gamePortIcons })
    .from(siteSettingsTable).limit(1);
  const stored = row?.gamePortIcons && typeof row.gamePortIcons === "object"
    ? (row.gamePortIcons as Record<string, unknown>)[gameId]
    : null;
  const objectKey = typeof stored === "string" ? parseStoredGameIcon(stored, gameId) : null;
  if (!objectKey) { res.status(404).end(); return; }
  res.set({
    "Content-Type": "image/png",
    "X-Content-Type-Options": "nosniff",
    "Cache-Control": "no-store",
  });
  const stream = appStorage.downloadAsStream(objectKey);
  stream.on("error", error => {
    logger.warn({ err: error, gameId }, "Game icon download failed");
    if (!res.headersSent) res.status(404).end();
    else res.destroy();
  });
  stream.pipe(res);
});

router.post("/site-settings/game-icons/:gameId/upload", requireAdmin, async (req, res) => {
  const gameId = String(req.params.gameId);
  const bytes = parseGameIconPng(req.body?.dataUrl);
  if (!/^[a-z0-9-]{1,64}$/.test(gameId) || !bytes) {
    res.status(400).json({ error: "Choose a PNG icon up to 1 MB and 2048 × 2048 pixels." });
    return;
  }
  const row = await ensureRow();
  const lockKey = `game-icon:${gameId}`;
  const objectKey = `game-icons/${gameId}/${randomUUID()}.png`;
  let oldObjectKey: string | null = null;
  try {
    const updated = await db.transaction(async tx => {
      await lockStorage(tx, lockKey);
      const [currentRow] = await tx.select({ gamePortIcons: siteSettingsTable.gamePortIcons })
        .from(siteSettingsTable).where(eq(siteSettingsTable.id, row.id)).limit(1);
      const existing = currentRow?.gamePortIcons && typeof currentRow.gamePortIcons === "object"
        ? (currentRow.gamePortIcons as Record<string, unknown>)[gameId]
        : null;
      oldObjectKey = typeof existing === "string" ? parseStoredGameIcon(existing, gameId) : null;
      await trackUpload(lockKey, objectKey);
      const stored = await appStorage.uploadFromBytes(objectKey, bytes, { compress: false });
      if (!stored.ok) throw new Error(stored.error.message);
      const [saved] = await tx.update(siteSettingsTable).set({
        gamePortIcons: sql`jsonb_set(COALESCE(${siteSettingsTable.gamePortIcons}, '{}'::jsonb), ARRAY[${gameId}], to_jsonb(${"storage:" + objectKey}::text), true)`,
        updatedAt: new Date(),
      }).where(eq(siteSettingsTable.id, row.id)).returning({ gamePortIcons: siteSettingsTable.gamePortIcons });
      if (oldObjectKey) await queueCleanup(tx, lockKey, oldObjectKey);
      return saved?.gamePortIcons;
    });
    await cleanupAfterMutation([objectKey, ...(oldObjectKey ? [oldObjectKey] : [])]);
    res.status(201).set("Cache-Control", "no-store").json({ gameIcons: cleanGamePortIcons(updated) });
  } catch (error) {
    await cleanupAfterMutation([objectKey]);
    logger.error({ err: error, gameId }, "Game icon upload failed");
    res.status(503).json({ error: "Icon storage is unavailable; the current icon was left unchanged." });
  }
});

router.put("/site-settings/game-icons", requireAdmin, async (req, res) => {
  if (!req.body?.gameId || typeof req.body.gameId !== "string" ||
      !/^[a-z0-9-]{1,64}$/.test(req.body.gameId) ||
      (req.body.iconUrl !== null && typeof req.body.iconUrl !== "string")) {
    res.status(400).json({ error: "Provide a valid game ID and HTTPS icon URL, or null to reset it." });
    return;
  }
  const gameId = req.body.gameId as string;
  const iconUrl = req.body.iconUrl as string | null;
  if (iconUrl !== null && (iconUrl.length > 2048 || (() => {
    try { return new URL(iconUrl).protocol !== "https:"; } catch { return true; }
  })())) {
    res.status(400).json({ error: "Game icons must use a valid HTTPS image URL." });
    return;
  }
  const row = await ensureRow();
  const lockKey = `game-icon:${gameId}`;
  let oldObjectKey: string | null = null;
  const updated = await db.transaction(async tx => {
    await lockStorage(tx, lockKey);
    const [currentRow] = await tx.select({ gamePortIcons: siteSettingsTable.gamePortIcons })
      .from(siteSettingsTable).where(eq(siteSettingsTable.id, row.id)).limit(1);
    const existing = currentRow?.gamePortIcons && typeof currentRow.gamePortIcons === "object"
      ? (currentRow.gamePortIcons as Record<string, unknown>)[gameId]
      : null;
    oldObjectKey = typeof existing === "string" ? parseStoredGameIcon(existing, gameId) : null;
    const current = siteSettingsTable.gamePortIcons;
    const [saved] = await tx.update(siteSettingsTable).set({
      gamePortIcons: iconUrl
        ? sql`jsonb_set(COALESCE(${current}, '{}'::jsonb), ARRAY[${gameId}], to_jsonb(${iconUrl}::text), true)`
        : sql`${current} - ${gameId}`,
      updatedAt: new Date(),
    }).where(eq(siteSettingsTable.id, row.id)).returning({ gamePortIcons: current });
    if (oldObjectKey) await queueCleanup(tx, lockKey, oldObjectKey);
    return saved?.gamePortIcons;
  });
  if (oldObjectKey) await cleanupAfterMutation([oldObjectKey]);
  res.set("Cache-Control", "no-store").json({ gameIcons: cleanGamePortIcons(updated) });
});

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
