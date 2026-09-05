import { Router, type IRouter } from "express";
import { db, usersTable, bannedUsersTable, userPagesTable, chatAuditTable, deviceAppealsTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { hashPassword, verifyPassword, isAdminUsername, findUserByUsername, requireAdmin } from "../lib/auth";
import { getClientIp, isIpBanned, recordUserIp } from "../lib/ip-tracking";
import { flagDevicesForUsername, getDeviceReview, recordDeviceAssociation, getDeviceIdForRequest } from "../lib/device-tracking";

const router: IRouter = Router();

router.get("/auth/me", async (req, res) => {
  if (!req.session.userId) { res.json({ user: null }); return; }
  const [u] = await db.select().from(usersTable).where(eq(usersTable.id, req.session.userId)).limit(1);
  if (!u) { res.json({ user: null }); return; }
  if (!u.isAdmin) {
    const [accountBan] = await db.select({ id: bannedUsersTable.id })
      .from(bannedUsersTable)
      .where(eq(bannedUsersTable.username, u.username))
      .limit(1);
    const deviceReview = await getDeviceReview(req, u.id);
    if (accountBan || deviceReview) {
      req.session.destroy(() => {});
      res.json({ user: null });
      return;
    }
  }
  res.json({
    user: {
      id: u.id,
      username: u.username,
      isAdmin: u.isAdmin,
      avatarUrl: u.avatarUrl,
      backgroundUrl: u.backgroundUrl,
      darkBackgroundUrl: u.darkBackgroundUrl,
      backgroundColor: u.backgroundColor,
      rank: u.rank,
      timeZone: u.timeZone,
    },
  });
});

router.post("/auth/signup", async (req, res, next) => {
  try {
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
    const [bannedUsername] = await db.select({ id: bannedUsersTable.id })
      .from(bannedUsersTable)
      .where(eq(bannedUsersTable.username, u))
      .limit(1);
    if (bannedUsername) {
      res.status(403).json({ error: "That username is banned from this site.", code: "ACCOUNT_BANNED" });
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
    await recordDeviceAssociation(req, created.id, created.username);
    res.json({ user: { id: created.id, username: created.username, isAdmin: created.isAdmin } });
  } catch (err) {
    // Forward to the central error handler so the underlying cause (DB
    // outage, missing column, session-store failure, etc.) is logged with a
    // full stack trace instead of disappearing into a generic HTTP 500.
    next(err);
  }
});

router.post("/auth/login", async (req, res, next) => {
  try {
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
    const [accountBan] = await db.select({ id: bannedUsersTable.id })
      .from(bannedUsersTable)
      .where(eq(bannedUsersTable.username, user.username))
      .limit(1);
    if (accountBan && !user.isAdmin) {
      res.status(403).json({ error: "This account is banned from this site.", code: "ACCOUNT_BANNED" });
      return;
    }
    // Auto-promote if username matches admin name (in case flag was missed)
    if (isAdminUsername(user.username) && !user.isAdmin) {
      await db.update(usersTable).set({ isAdmin: true }).where(eq(usersTable.id, user.id));
      user.isAdmin = true;
    }
    if (!user.isAdmin) {
      const review = await getDeviceReview(req, user.id);
      if (review) {
        res.status(403).json({
          error: "This device needs admin review before this account can sign in.",
          code: "DEVICE_APPEAL_REQUIRED",
          appeal: review.appeal
            ? { status: review.appeal.status, createdAt: review.appeal.createdAt, adminResponse: review.appeal.adminResponse }
            : null,
        });
        return;
      }
    }
    req.session.userId = user.id;
    req.session.username = user.username;
    req.session.isAdmin = user.isAdmin;
    void recordUserIp(user.username, ip);
    await recordDeviceAssociation(req, user.id, user.username);
    res.json({ user: { id: user.id, username: user.username, isAdmin: user.isAdmin } });
  } catch (err) {
    next(err);
  }
});

// A flagged device can submit an appeal after proving ownership of the
// account. No session is created until an admin approves the appeal.
router.post("/auth/device-appeals", async (req, res, next) => {
  try {
    const { username, password, message } = req.body ?? {};
    if (typeof username !== "string" || typeof password !== "string" || typeof message !== "string") {
      res.status(400).json({ error: "username, password, and appeal message are required" });
      return;
    }
    const user = await findUserByUsername(username.trim());
    if (!user || !(await verifyPassword(password, user.passwordHash))) {
      res.status(401).json({ error: "Invalid credentials" });
      return;
    }
    const review = await getDeviceReview(req, user.id);
    if (!review) {
      res.status(400).json({ error: "This device is not currently awaiting an appeal." });
      return;
    }
    if (review.appeal?.status === "open") {
      res.json({ ok: true, status: "open", appealId: review.appeal.id });
      return;
    }
    const deviceTokenId = await getDeviceIdForRequest(req);
    if (!deviceTokenId) {
      res.status(400).json({ error: "Device identity unavailable. Refresh and try again." });
      return;
    }
    const cleanMessage = message.trim().slice(0, 2000);
    if (!cleanMessage) {
      res.status(400).json({ error: "Please explain why this device should be restored." });
      return;
    }
    const [appeal] = await db.insert(deviceAppealsTable).values({
      deviceTokenId,
      userId: user.id,
      username: user.username,
      message: cleanMessage,
    }).returning({ id: deviceAppealsTable.id, status: deviceAppealsTable.status });
    await db.insert(chatAuditTable).values({
      area: "device",
      action: "appeal",
      actor: user.username,
      target: String(deviceTokenId),
      body: "device access appeal submitted",
    });
    res.json({ ok: true, appealId: appeal.id, status: appeal.status });
  } catch (err) {
    next(err);
  }
});

router.patch("/auth/password", async (req, res, next) => {
  try {
    if (!req.session.userId) {
      res.status(401).json({ error: "Login required" });
      return;
    }
    const { currentPassword, newPassword } = req.body ?? {};
    if (typeof currentPassword !== "string" || typeof newPassword !== "string") {
      res.status(400).json({ error: "Current and new passwords are required" });
      return;
    }
    if (newPassword.length < 4 || newPassword.length > 128) {
      res.status(400).json({ error: "Password must be 4-128 chars" });
      return;
    }
    const [user] = await db.select().from(usersTable)
      .where(eq(usersTable.id, req.session.userId))
      .limit(1);
    if (!user || !(await verifyPassword(currentPassword, user.passwordHash))) {
      res.status(400).json({ error: "Current password is incorrect" });
      return;
    }
    const passwordHash = await hashPassword(newPassword);
    await db.update(usersTable)
      .set({ passwordHash })
      .where(eq(usersTable.id, user.id));
    await db.insert(chatAuditTable).values({
      area: "user",
      action: "password",
      actor: user.username,
      target: user.username,
      body: "password changed by account owner",
    });
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

router.patch("/auth/profile", async (req, res) => {
  if (!req.session.userId) {
    res.status(401).json({ error: "Login required" });
    return;
  }
  const { avatarUrl, backgroundUrl, darkBackgroundUrl, backgroundColor, timeZone } = req.body ?? {};
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
  if (darkBackgroundUrl !== undefined) {
    if (darkBackgroundUrl !== null && (typeof darkBackgroundUrl !== "string" || (darkBackgroundUrl && !darkBackgroundUrl.startsWith("data:image/")))) {
      res.status(400).json({ error: "darkBackgroundUrl must be a data:image/* string or null" });
      return;
    }
    if (typeof darkBackgroundUrl === "string" && darkBackgroundUrl.length > 4_000_000) {
      res.status(413).json({ error: "Dark background too large" });
      return;
    }
    update.darkBackgroundUrl = darkBackgroundUrl;
  }
  if (backgroundColor !== undefined) {
    if (backgroundColor !== null && (typeof backgroundColor !== "string" || backgroundColor.length > 32)) {
      res.status(400).json({ error: "Bad backgroundColor" });
      return;
    }
    update.backgroundColor = backgroundColor;
  }
  if (timeZone !== undefined) {
    if (timeZone !== null && (typeof timeZone !== "string" || !isValidTimeZone(timeZone))) {
      res.status(400).json({ error: "Invalid time zone" });
      return;
    }
    update.timeZone = timeZone;
  }
  if (Object.keys(update).length === 0) {
    res.json({ ok: true });
    return;
  }
  await db.update(usersTable).set(update).where(eq(usersTable.id, req.session.userId));
  res.json({ ok: true });
});

router.patch("/auth/username", async (req, res, next) => {
  try {
    if (!req.session.userId || !req.session.username) {
      res.status(401).json({ error: "Login required" });
      return;
    }
    const { currentPassword, username } = req.body ?? {};
    if (typeof currentPassword !== "string" || typeof username !== "string") {
      res.status(400).json({ error: "Current password and new username are required" });
      return;
    }
    const nextUsername = username.trim();
    if (nextUsername.length < 2 || nextUsername.length > 32) {
      res.status(400).json({ error: "Username must be 2-32 chars" });
      return;
    }
    if (isAdminUsername(req.session.username)) {
      res.status(400).json({ error: "The site owner username cannot be changed." });
      return;
    }
    if (isAdminUsername(nextUsername)) {
      res.status(400).json({ error: "That username is reserved." });
      return;
    }
    const [user] = await db.select().from(usersTable)
      .where(eq(usersTable.id, req.session.userId)).limit(1);
    if (!user || !(await verifyPassword(currentPassword, user.passwordHash))) {
      res.status(400).json({ error: "Current password is incorrect" });
      return;
    }
    if (nextUsername === user.username) {
      res.status(400).json({ error: "Choose a different username" });
      return;
    }
    const existing = await findUserByUsername(nextUsername);
    if (existing) {
      res.status(409).json({ error: "Username taken" });
      return;
    }
    const [page] = await db.select({ username: userPagesTable.username })
      .from(userPagesTable).where(eq(userPagesTable.username, nextUsername)).limit(1);
    if (page) {
      res.status(409).json({ error: "That username already has a personal page." });
      return;
    }

    await db.transaction(async (tx) => {
      await tx.update(usersTable).set({ username: nextUsername }).where(eq(usersTable.id, user.id));
      await tx.update(userPagesTable).set({ username: nextUsername })
        .where(eq(userPagesTable.username, user.username));
      await tx.insert(chatAuditTable).values({
        area: "user",
        action: "username",
        actor: user.username,
        target: nextUsername,
        body: "username changed by account owner",
      });
    });
    req.session.username = nextUsername;
    res.json({ ok: true, username: nextUsername });
  } catch (err) {
    next(err);
  }
});

function isValidTimeZone(value: string): boolean {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: value }).format();
    return true;
  } catch {
    return false;
  }
}

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
      lastSeen: user.lastSeen,
    },
  });
});

router.get("/users", async (req, res) => {
  const rows = await db.select({
    username: usersTable.username,
    isAdmin: usersTable.isAdmin,
    avatarUrl: usersTable.avatarUrl,
    rank: usersTable.rank,
    lastSeen: usersTable.lastSeen,
    pageUsername: userPagesTable.username,
    pageVotes: userPagesTable.votes,
  }).from(usersTable)
    .leftJoin(userPagesTable, eq(usersTable.username, userPagesTable.username))
    .limit(500);
  res.json(rows.map((row) => {
    const votes = row.pageVotes && typeof row.pageVotes === "object"
      ? row.pageVotes as Record<string, boolean>
      : {};
    return {
      username: row.username,
      isAdmin: row.isAdmin,
      avatarUrl: row.avatarUrl,
      rank: row.rank,
      lastSeen: row.lastSeen,
      hasPage: !!row.pageUsername,
      upvotes: Object.values(votes).filter(Boolean).length,
      myVote: req.session.username ? !!votes[req.session.username] : false,
    };
  }));
});

// Admin: change an account's username and/or password without exposing the
// password hash or requiring the account owner's current password.
router.patch("/users/:username/credentials", requireAdmin, async (req, res) => {
  const currentUsername = String(req.params.username || "").trim();
  if (!currentUsername) { res.status(400).json({ error: "username required" }); return; }

  const target = await findUserByUsername(currentUsername);
  if (!target) { res.status(404).json({ error: "User not found" }); return; }

  const body = req.body ?? {};
  const hasUsername = body.username !== undefined;
  const hasPassword = body.password !== undefined;
  if (!hasUsername && !hasPassword) {
    res.status(400).json({ error: "Provide a username or password" });
    return;
  }

  let nextUsername = target.username;
  if (hasUsername) {
    if (typeof body.username !== "string") {
      res.status(400).json({ error: "username must be a string" });
      return;
    }
    nextUsername = body.username.trim();
    if (nextUsername.length < 2 || nextUsername.length > 32) {
      res.status(400).json({ error: "Username must be 2-32 chars" });
      return;
    }
    if (nextUsername !== target.username && isAdminUsername(target.username)) {
      res.status(400).json({ error: "The site owner username cannot be changed." });
      return;
    }
    if (isAdminUsername(nextUsername) && nextUsername !== target.username) {
      res.status(400).json({ error: "That username is reserved." });
      return;
    }
    const collision = await findUserByUsername(nextUsername);
    if (collision && collision.id !== target.id) {
      res.status(409).json({ error: "Username taken" });
      return;
    }
    if (nextUsername !== target.username) {
      const [page] = await db.select({ username: userPagesTable.username })
        .from(userPagesTable)
        .where(eq(userPagesTable.username, nextUsername))
        .limit(1);
      if (page) {
        res.status(409).json({ error: "That username already has a personal page." });
        return;
      }
    }
  }

  let nextPasswordHash: string | undefined;
  if (hasPassword) {
    if (typeof body.password !== "string") {
      res.status(400).json({ error: "password must be a string" });
      return;
    }
    if (body.password.length < 4 || body.password.length > 128) {
      res.status(400).json({ error: "Password must be 4-128 chars" });
      return;
    }
    nextPasswordHash = await hashPassword(body.password);
  }

  const actor = req.session.username || "admin";
  const usernameChanged = nextUsername !== target.username;
  const passwordChanged = nextPasswordHash !== undefined;
  const update: { username?: string; passwordHash?: string } = {};
  if (usernameChanged) update.username = nextUsername;
  if (nextPasswordHash) update.passwordHash = nextPasswordHash;

  await db.transaction(async (tx) => {
    if (Object.keys(update).length > 0) {
      await tx.update(usersTable).set(update).where(eq(usersTable.id, target.id));
    }
    if (usernameChanged) {
      await tx.update(userPagesTable)
        .set({ username: nextUsername })
        .where(eq(userPagesTable.username, target.username));
    }
    await tx.insert(chatAuditTable).values({
      area: "user",
      action: "credentials",
      actor,
      target: target.username,
      body: [
        usernameChanged ? `username changed to ${nextUsername}` : "",
        passwordChanged ? "password changed" : "",
      ].filter(Boolean).join("; "),
    });
  });

  if (req.session.userId === target.id) {
    req.session.username = nextUsername;
  }
  res.json({ ok: true, username: nextUsername });
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
  const flaggedDevices = await flagDevicesForUsername(username, actor, reason);
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
  await db.insert(chatAuditTable).values({ area: "user", action: "delete", actor, target: username, body: `${reason}${flaggedDevices ? `; flagged ${flaggedDevices} device(s)` : ""}` });
  res.json({ ok: true, flaggedDevices });
});

router.post("/auth/logout", (req, res) => {
  req.session.destroy(() => {
    res.clearCookie("connect.sid");
    res.json({ ok: true });
  });
});

export default router;
