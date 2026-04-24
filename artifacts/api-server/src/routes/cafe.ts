import { Router, type IRouter } from "express";
import { db, cafePresenceTable, cafeChatTable, cafeSettingsTable, cafeRoomsTable } from "@workspace/db";
import { desc, eq, sql } from "drizzle-orm";
import { requireAuth, isAdminUsername } from "../lib/auth";
import { isBanned, audit } from "./social";
import { getUserPermissions } from "./ranks";

const router: IRouter = Router();

// Themes hard-coded in the client. Custom rooms uploaded by admins are stored
// in cafe_rooms and looked up at theme-set time so we don't reject their slugs.
const BUILTIN_THEMES = ["cafe", "library", "holiday", "park", "city"];

async function ensureSettings() {
  const [s] = await db.select().from(cafeSettingsTable).limit(1);
  if (!s) await db.insert(cafeSettingsTable).values({ theme: "cafe" });
}

router.get("/cafe/state", async (_req, res) => {
  await ensureSettings();
  const cutoff = new Date(Date.now() - 30_000);
  const presence = await db.select().from(cafePresenceTable).where(sql`${cafePresenceTable.lastSeen} > ${cutoff}`);
  const chat = await db.select().from(cafeChatTable).orderBy(desc(cafeChatTable.createdAt)).limit(40);
  const [settings] = await db.select().from(cafeSettingsTable).limit(1);
  res.json({ presence, chat: chat.reverse(), theme: settings?.theme || "cafe" });
});

router.post("/cafe/move", requireAuth, async (req, res) => {
  const { x, y, avatar } = req.body ?? {};
  const me = req.session.username!;
  if (await isBanned(me)) { res.status(403).json({ error: "Banned" }); return; }
  const cleanX = Math.max(0, Math.min(800, Number(x) || 0));
  const cleanY = Math.max(0, Math.min(500, Number(y) || 0));
  const cleanAvatar = (avatar && typeof avatar === "object") ? avatar : {};
  if (typeof cleanAvatar.accessory === "string" && cleanAvatar.accessory.length > 200_000) {
    cleanAvatar.accessory = cleanAvatar.accessory.slice(0, 200_000);
  }
  const [existing] = await db.select().from(cafePresenceTable).where(eq(cafePresenceTable.username, me)).limit(1);
  if (existing) {
    await db.update(cafePresenceTable).set({ x: cleanX, y: cleanY, avatar: cleanAvatar, lastSeen: new Date() }).where(eq(cafePresenceTable.username, me));
  } else {
    await db.insert(cafePresenceTable).values({ username: me, x: cleanX, y: cleanY, avatar: cleanAvatar });
  }
  res.json({ ok: true });
});

router.post("/cafe/say", requireAuth, async (req, res) => {
  const me = req.session.username!;
  const { body } = req.body ?? {};
  if (typeof body !== "string" || !body.trim()) { res.status(400).json({ error: "body required" }); return; }
  if (await isBanned(me)) { res.status(403).json({ error: "Banned" }); return; }
  await db.insert(cafeChatTable).values({ author: me, body: body.trim().slice(0, 200) });
  res.json({ ok: true });
});

router.post("/cafe/theme", requireAuth, async (req, res) => {
  const me = req.session.username!;
  const perms = await getUserPermissions(me);
  if (!isAdminUsername(me) && !perms.includes("cafeTheme")) { res.status(403).json({ error: "Not allowed" }); return; }
  const { theme } = req.body ?? {};
  if (typeof theme !== "string" || !theme) { res.status(400).json({ error: "Invalid theme" }); return; }

  // Either a built-in theme or a custom-room slug that actually exists.
  if (!BUILTIN_THEMES.includes(theme)) {
    const [room] = await db.select().from(cafeRoomsTable).where(eq(cafeRoomsTable.slug, theme)).limit(1);
    if (!room) { res.status(400).json({ error: "Unknown theme or room" }); return; }
  }

  await ensureSettings();
  await db.update(cafeSettingsTable).set({ theme });
  await audit("cafe", "theme", me, "", theme);
  res.json({ ok: true });
});

router.post("/cafe/leave", requireAuth, async (req, res) => {
  await db.delete(cafePresenceTable).where(eq(cafePresenceTable.username, req.session.username!));
  res.json({ ok: true });
});

export default router;
