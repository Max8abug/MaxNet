import { Router, type IRouter } from "express";
import { db, usersTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { hashPassword, verifyPassword, isAdminUsername, findUserByUsername } from "../lib/auth";

const router: IRouter = Router();

router.get("/auth/me", (req, res) => {
  if (!req.session.userId) {
    res.json({ user: null });
    return;
  }
  res.json({
    user: {
      id: req.session.userId,
      username: req.session.username,
      isAdmin: !!req.session.isAdmin,
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
  res.json({ user: { id: created.id, username: created.username, isAdmin: created.isAdmin } });
});

router.post("/auth/login", async (req, res) => {
  const { username, password } = req.body ?? {};
  if (typeof username !== "string" || typeof password !== "string") {
    res.status(400).json({ error: "username and password required" });
    return;
  }
  const user = await findUserByUsername(username.trim());
  if (!user) {
    res.status(401).json({ error: "Invalid credentials" });
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
    },
  });
});

router.post("/auth/logout", (req, res) => {
  req.session.destroy(() => {
    res.clearCookie("connect.sid");
    res.json({ ok: true });
  });
});

export default router;
