import { Router, type IRouter } from "express";
import { db, cafePresenceTable, cafeChatTable, cafeSettingsTable, cafeRoomsTable, usersTable } from "@workspace/db";
import { desc, eq, sql } from "drizzle-orm";
import { requireAuth, isAdminUsername } from "../lib/auth";
import { isBanned, audit } from "./social";
import { getUserPermissions } from "./ranks";

const router: IRouter = Router();

// Themes hard-coded in the client. Custom rooms uploaded by admins are stored
// in cafe_rooms and looked up at theme-set time so we don't reject their slugs.
const BUILTIN_THEMES = ["cafe", "library", "holiday", "park", "city"];

// Quick-emoji reactions are deliberately ephemeral and high-volume, so they
// live in process memory rather than the database. They expire after a few
// seconds and are pruned on every poll. The set of allowed emojis is fixed on
// the server so a malicious client cannot blast unicode through the channel.
type CafeReaction = { from: string; to: string; emoji: string; expiresAt: number };
const REACTIONS: CafeReaction[] = [];
const REACTION_TTL_MS = 4000;
const REACTION_RATE_LIMIT_MS = 600;
const REACTION_LAST: Map<string, number> = new Map();
const ALLOWED_EMOJIS = new Set(["👋", "❤️", "😂", "😢", "👍", "😮"]);
function pruneReactions(now: number) {
  for (let i = REACTIONS.length - 1; i >= 0; i--) {
    if (REACTIONS[i].expiresAt <= now) REACTIONS.splice(i, 1);
  }
}

async function ensureSettings() {
  const [s] = await db.select().from(cafeSettingsTable).limit(1);
  if (!s) await db.insert(cafeSettingsTable).values({ theme: "cafe" });
}

router.get("/cafe/state", async (_req, res) => {
  await ensureSettings();
  const now = Date.now();
  const cutoff = new Date(now - 30_000);
  const presence = await db.select().from(cafePresenceTable).where(sql`${cafePresenceTable.lastSeen} > ${cutoff}`);
  const chat = await db.select().from(cafeChatTable).orderBy(desc(cafeChatTable.createdAt)).limit(40);
  const [settings] = await db.select().from(cafeSettingsTable).limit(1);
  pruneReactions(now);
  res.json({ presence, chat: chat.reverse(), theme: settings?.theme || "cafe", reactions: REACTIONS });
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

router.post("/cafe/react", requireAuth, async (req, res) => {
  const me = req.session.username!;
  const { target, emoji } = req.body ?? {};
  if (typeof target !== "string" || !target) { res.status(400).json({ error: "target required" }); return; }
  if (typeof emoji !== "string" || !ALLOWED_EMOJIS.has(emoji)) { res.status(400).json({ error: "Invalid emoji" }); return; }
  if (await isBanned(me)) { res.status(403).json({ error: "Banned" }); return; }
  const now = Date.now();
  // Cheap per-user rate limit so a button-mashing client can't flood the
  // shared in-memory queue. We don't need to be exact — a few hundred ms
  // is plenty to keep the channel calm.
  const last = REACTION_LAST.get(me) || 0;
  if (now - last < REACTION_RATE_LIMIT_MS) { res.status(429).json({ error: "Slow down" }); return; }
  // Target must currently be in the cafe (active in the last 30s) — there's
  // no point queueing a wave for someone who isn't here to see it.
  const cutoff = new Date(now - 30_000);
  const [t] = await db.select().from(cafePresenceTable).where(eq(cafePresenceTable.username, target)).limit(1);
  if (!t || new Date(t.lastSeen).getTime() < cutoff.getTime()) {
    res.status(404).json({ error: "Target not in cafe" }); return;
  }
  REACTION_LAST.set(me, now);
  pruneReactions(now);
  REACTIONS.push({ from: me, to: target, emoji, expiresAt: now + REACTION_TTL_MS });
  res.json({ ok: true });
});

router.post("/cafe/leave", requireAuth, async (req, res) => {
  await db.delete(cafePresenceTable).where(eq(cafePresenceTable.username, req.session.username!));
  res.json({ ok: true });
});

// Persistent per-user character. Stored on the users row so it survives leaving
// the cafe, logging out, etc. The in-cafe presence avatar is derived from this
// every time the user joins a session and rewritten here whenever the editor
// saves a new look.
router.get("/cafe/avatar", requireAuth, async (req, res) => {
  const userId = req.session.userId!;
  const [u] = await db.select({ cafeAvatar: usersTable.cafeAvatar }).from(usersTable).where(eq(usersTable.id, userId)).limit(1);
  res.json({ avatar: (u?.cafeAvatar as any) || {} });
});

router.put("/cafe/avatar", requireAuth, async (req, res) => {
  const userId = req.session.userId!;
  const { avatar } = req.body ?? {};
  if (!avatar || typeof avatar !== "object") { res.status(400).json({ error: "avatar required" }); return; }
  const a = avatar as { color?: unknown; hat?: unknown; accessory?: unknown };
  const cleaned = {
    color: typeof a.color === "string" ? a.color.slice(0, 32) : "#ffd699",
    hat: typeof a.hat === "string" ? a.hat.slice(0, 32) : "none",
    accessory:
      typeof a.accessory === "string" && a.accessory.startsWith("data:image/")
        ? a.accessory.slice(0, 250_000)
        : null,
  };
  await db.update(usersTable).set({ cafeAvatar: cleaned }).where(eq(usersTable.id, userId));
  res.json({ ok: true, avatar: cleaned });
});

export default router;
