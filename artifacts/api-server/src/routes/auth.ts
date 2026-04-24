import { Router, type IRouter } from "express";
import { db, usersTable, bannedUsersTable, userPagesTable, chatAuditTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { hashPassword, verifyPassword, isAdminUsername, findUserByUsername, requireAdmin } from "../lib/auth";
import { getClientIp, isIpBanned, recordUserIp } from "../lib/ip-tracking";

const router: IRouter = Router();

router.get("/auth/me", async (req, res) => {
  if (!req.session.userId) { res.json({ user: null }); return; }
  const [u] = await db.select().from(usersTable).where(eq(usersTable.id, req.session.userId)).limit(1);
  if (!u) { res.json({ user: null }); return; }
  res.json({
    user: {
      id: u.id,
      username: u.username,
      isAdmin: u.isAdmin,
      avatarUrl: u.avatarUrl,
      backgroundUrl: u.backgroundUrl,
      backgroundColor: u.backgroundColor,
      rank: u.rank,
    },
  });
});

router.post("/auth/signup", async (req, res) => {
  const { username, password } = req.body ?? {};
  if (typeof username !== "string" || typeof password !== "string") {
    res.status(400).json({ error: "username and password required" });
    return;
  }
  const u = username.trim();
  if (u.length < 2 || u.length > 32) {
    res.status(400).json({ error: "Username must be 2-32 chars" });
    return;
  }
  if (password.length < 4 || password.length > 128) {
    res.status(400).json({ error: "Password must be 4-128 chars" });
    return;
  }
  const ip = getClientIp(req);
  if (await isIpBanned(ip)) {
    res.status(403).json({ error: "Your network is banned from creating accounts on this site." });
    return;
  }
  const existing = await findUserByUsername(u);
  if (existing) {
    res.status(409).json({ error: "Username taken" });
    return;
  }
  const passwordHash = await hashPassword(password);
  const isAdmin = isAdminUsername(u);
  const [created] = await db
    .insert(usersTable)
    .values({ username: u, passwordHash, isAdmin })
    .returning();
  req.session.userId = created.id;
  req.session.username = created.username;
  req.session.isAdmin = created.isAdmin;
  void recordUserIp(created.username, ip);
  res.json({ user: { id: created.id, username: created.username, isAdmin: created.isAdmin } });
});

router.post("/auth/login", async (req, res) => {
  const { username, password } = req.body ?? {};
  if (typeof username !== "string" || typeof password !== "string") {
    res.status(400).json({ error: "username and password required" });
    return;
  }
  const ip = getClientIp(req);
  const user = await findUserByUsername(username.trim());
  if (!user) {
    res.status(401).json({ error: "Invalid credentials" });
    return;
  }
  // The site owner can always log in even if their network was banned by mistake.
  if (!isAdminUsername(user.username) && await isIpBanned(ip)) {
    res.status(403).json({ error: "Your network is banned from this site." });
    return;
  }
  const ok = await verifyPassword(password, user.passwordHash);
  if (!ok) {
    res.status(401).json({ error: "Invalid credentials" });
    return;
  }
  // Auto-promote if username matches admin name (in case flag was missed)
  if (isAdminUsername(user.username) && !user.isAdmin) {
    await db.update(usersTable).set({ isAdmin: true }).where(eq(usersTable.id, user.id));
    user.isAdmin = true;
  }
  req.session.userId = user.id;
  req.session.username = user.username;
  req.session.isAdmin = user.isAdmin;
  void recordUserIp(user.username, ip);
  res.json({ user: { id: user.id, username: user.username, isAdmin: user.isAdmin } });
});

router.patch("/auth/profile", async (req, res) => {
  if (!req.session.userId) {
    res.status(401).json({ error: "Login required" });
    return;
  }
  const { avatarUrl, backgroundUrl, backgroundColor } = req.body ?? {};
  const update: Record<string, string | null> = {};
  if (avatarUrl !== undefined) {
    if (avatarUrl !== null && (typeof avatarUrl !== "string" || (avatarUrl && !avatarUrl.startsWith("data:image/")))) {
      res.status(400).json({ error: "avatarUrl must be a data:image/* string or null" });
      return;
    }
    if (typeof avatarUrl === "string" && avatarUrl.length > 400_000) {
      res.status(413).json({ error: "Avatar too large" });
      return;
    }
    update.avatarUrl = avatarUrl;
  }
  if (backgroundUrl !== undefined) {
    if (backgroundUrl !== null && (typeof backgroundUrl !== "string" || (backgroundUrl && !backgroundUrl.startsWith("data:image/")))) {
      res.status(400).json({ error: "backgroundUrl must be a data:image/* string or null" });
      return;
    }
    if (typeof backgroundUrl === "string" && backgroundUrl.length > 4_000_000) {
      res.status(413).json({ error: "Background too large" });
      return;
    }
    update.backgroundUrl = backgroundUrl;
  }
  if (backgroundColor !== undefined) {
    if (backgroundColor !== null && (typeof backgroundColor !== "string" || backgroundColor.length > 32)) {
      res.status(400).json({ error: "Bad backgroundColor" });
      return;
    }
    update.backgroundColor = backgroundColor;
  }
  if (Object.keys(update).length === 0) {
    res.json({ ok: true });
    return;
  }
  await db.update(usersTable).set(update).where(eq(usersTable.id, req.session.userId));
  res.json({ ok: true });
});

router.get("/users/:username", async (req, res) => {
  const u = String(req.params.username || "").trim();
  if (!u) { res.status(400).json({ error: "username required" }); return; }
  const user = await findUserByUsername(u);
  if (!user) { res.json({ user: null }); return; }
  res.json({
    user: {
      username: user.username,
      isAdmin: user.isAdmin,
      avatarUrl: user.avatarUrl,
      rank: user.rank,
    },
  });
});

router.get("/users", async (_req, res) => {
  const rows = await db.select({
    username: usersTable.username,
    isAdmin: usersTable.isAdmin,
    avatarUrl: usersTable.avatarUrl,
    rank: usersTable.rank,
  }).from(usersTable).limit(500);
  res.json(rows);
});

// Admin: permanently delete a user (also bans them so they can't immediately re-register).
router.delete("/users/:username", requireAdmin, async (req, res) => {
  const username = String(req.params.username || "").trim();
  if (!username) { res.status(400).json({ error: "username required" }); return; }
  if (isAdminUsername(username)) { res.status(400).json({ error: "Cannot delete the site owner." }); return; }

  const target = await findUserByUsername(username);
  if (!target) { res.status(404).json({ error: "User not found" }); return; }

  // Ban first so the seat is locked even if a stray session existed.
  const actor = req.session.username || "admin";
  const reason = String((req.body && (req.body as any).reason) || "Account deleted by admin");
  try {
    await db.insert(bannedUsersTable).values({ username, bannedBy: actor, reason });
  } catch {
    // Already banned — fine.
  }

  // Remove the account itself and their personal page; chat/forum/etc. content
  // is left intact so threads stay readable, but the admin can delete those
  // individually from each surface.
  await db.delete(userPagesTable).where(eq(userPagesTable.username, username));
  await db.delete(usersTable).where(eq(usersTable.id, target.id));
  await db.insert(chatAuditTable).values({ area: "user", action: "delete", actor, target: username, body: reason });
  res.json({ ok: true });
});

router.post("/auth/logout", (req, res) => {
  req.session.destroy(() => {
    res.clearCookie("connect.sid");
    res.json({ ok: true });
  });
});

export default router;
