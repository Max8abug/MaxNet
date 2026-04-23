import { Router, type IRouter } from "express";
import {
  db,
  drawingsTable,
  chatMessagesTable,
  visitCounterTable,
  guestbookTable,
  photosTable,
  bannedUsersTable,
  chatAuditTable,
} from "@workspace/db";
import { desc, sql, eq } from "drizzle-orm";
import { requireAuth, requireAdmin, isAdminUsername } from "../lib/auth";

async function isBanned(username: string): Promise<boolean> {
  const [row] = await db
    .select()
    .from(bannedUsersTable)
    .where(eq(bannedUsersTable.username, username))
    .limit(1);
  return !!row;
}

async function audit(action: string, actor: string, target = "", body = "") {
  try {
    await db.insert(chatAuditTable).values({ action, actor, target, body });
  } catch { /* ignore */ }
}

const router: IRouter = Router();

// ---------- Drawings ----------
router.get("/drawings", async (_req, res) => {
  const rows = await db
    .select()
    .from(drawingsTable)
    .orderBy(desc(drawingsTable.createdAt))
    .limit(200);
  res.json(rows);
});

router.post("/drawings", async (req, res) => {
  const { dataUrl, author } = req.body ?? {};
  if (typeof dataUrl !== "string" || !dataUrl.startsWith("data:image/")) {
    res.status(400).json({ error: "dataUrl must be a data:image/* string" });
    return;
  }
  if (dataUrl.length > 600_000) {
    res.status(413).json({ error: "Drawing too large" });
    return;
  }
  const safeAuthor = typeof author === "string" && author.trim() ? author.trim().slice(0, 32) : "anon";
  const [row] = await db
    .insert(drawingsTable)
    .values({ dataUrl, author: safeAuthor })
    .returning();
  res.json(row);
});

// ---------- Chat (login required to post; admin can clear) ----------
router.get("/chat", async (_req, res) => {
  const rows = await db
    .select()
    .from(chatMessagesTable)
    .orderBy(desc(chatMessagesTable.createdAt))
    .limit(100);
  res.json(rows.reverse());
});

router.post("/chat", requireAuth, async (req, res) => {
  const { body } = req.body ?? {};
  if (typeof body !== "string" || !body.trim()) {
    res.status(400).json({ error: "body required" });
    return;
  }
  if (body.length > 500) {
    res.status(413).json({ error: "Message too long" });
    return;
  }
  const author = req.session.username || "anon";
  if (await isBanned(author)) {
    await audit("blocked", author, author, body.trim().slice(0, 500));
    res.status(403).json({ error: "You are banned from chat." });
    return;
  }
  const trimmed = body.trim();
  const [row] = await db
    .insert(chatMessagesTable)
    .values({ body: trimmed, author })
    .returning();
  await audit("post", author, "", trimmed);
  res.json(row);
});

router.delete("/chat", requireAdmin, async (req, res) => {
  const all = await db.select().from(chatMessagesTable);
  await db.delete(chatMessagesTable);
  await audit(
    "clear",
    req.session.username || "admin",
    "",
    `Cleared ${all.length} messages`,
  );
  res.json({ ok: true, count: all.length });
});

router.delete("/chat/:id", requireAdmin, async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isFinite(id)) {
    res.status(400).json({ error: "bad id" });
    return;
  }
  const [existing] = await db
    .select()
    .from(chatMessagesTable)
    .where(eq(chatMessagesTable.id, id))
    .limit(1);
  if (!existing) {
    res.status(404).json({ error: "not found" });
    return;
  }
  await db.delete(chatMessagesTable).where(eq(chatMessagesTable.id, id));
  await audit(
    "delete",
    req.session.username || "admin",
    existing.author,
    existing.body,
  );
  res.json({ ok: true });
});

// ---------- Chat audit log (admin) ----------
router.get("/chat/audit", requireAdmin, async (_req, res) => {
  const rows = await db
    .select()
    .from(chatAuditTable)
    .orderBy(desc(chatAuditTable.createdAt))
    .limit(500);
  res.json(rows);
});

// ---------- Bans (admin) ----------
router.get("/bans", requireAdmin, async (_req, res) => {
  const rows = await db
    .select()
    .from(bannedUsersTable)
    .orderBy(desc(bannedUsersTable.createdAt));
  res.json(rows);
});

router.post("/bans", requireAdmin, async (req, res) => {
  const { username, reason } = req.body ?? {};
  if (typeof username !== "string" || !username.trim()) {
    res.status(400).json({ error: "username required" });
    return;
  }
  const u = username.trim().slice(0, 32);
  if (isAdminUsername(u)) {
    res.status(400).json({ error: "Cannot ban the admin account" });
    return;
  }
  const safeReason = typeof reason === "string" ? reason.slice(0, 200) : "";
  const actor = req.session.username || "admin";
  try {
    const [row] = await db
      .insert(bannedUsersTable)
      .values({ username: u, bannedBy: actor, reason: safeReason })
      .returning();
    await audit("ban", actor, u, safeReason);
    res.json(row);
  } catch {
    res.status(409).json({ error: "User already banned" });
  }
});

router.delete("/bans/:username", requireAdmin, async (req, res) => {
  const u = String(req.params.username || "").trim();
  if (!u) {
    res.status(400).json({ error: "username required" });
    return;
  }
  await db.delete(bannedUsersTable).where(eq(bannedUsersTable.username, u));
  await audit("unban", req.session.username || "admin", u, "");
  res.json({ ok: true });
});

// ---------- Guestbook ----------
router.get("/guestbook", async (_req, res) => {
  const rows = await db
    .select()
    .from(guestbookTable)
    .orderBy(desc(guestbookTable.createdAt))
    .limit(200);
  res.json(rows);
});

router.post("/guestbook", async (req, res) => {
  const { body, author } = req.body ?? {};
  if (typeof body !== "string" || !body.trim()) {
    res.status(400).json({ error: "body required" });
    return;
  }
  if (body.length > 280) {
    res.status(413).json({ error: "Note too long" });
    return;
  }
  const safeAuthor =
    typeof author === "string" && author.trim() ? author.trim().slice(0, 32) : "anon";
  const [row] = await db
    .insert(guestbookTable)
    .values({ body: body.trim(), author: safeAuthor })
    .returning();
  res.json(row);
});

router.delete("/guestbook/:id", requireAdmin, async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isFinite(id)) {
    res.status(400).json({ error: "bad id" });
    return;
  }
  await db.delete(guestbookTable).where(sql`${guestbookTable.id} = ${id}`);
  res.json({ ok: true });
});

// ---------- Photos (admin uploads, everyone views) ----------
router.get("/photos", async (_req, res) => {
  const rows = await db
    .select()
    .from(photosTable)
    .orderBy(desc(photosTable.createdAt))
    .limit(500);
  res.json(rows);
});

router.post("/photos", requireAdmin, async (req, res) => {
  const { dataUrl, caption } = req.body ?? {};
  if (typeof dataUrl !== "string" || !dataUrl.startsWith("data:image/")) {
    res.status(400).json({ error: "dataUrl must be a data:image/* string" });
    return;
  }
  if (dataUrl.length > 8_000_000) {
    res.status(413).json({ error: "Photo too large (max ~6MB)" });
    return;
  }
  const safeCaption = typeof caption === "string" ? caption.slice(0, 200) : "";
  const [row] = await db
    .insert(photosTable)
    .values({ dataUrl, caption: safeCaption })
    .returning();
  res.json(row);
});

router.delete("/photos/:id", requireAdmin, async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isFinite(id)) {
    res.status(400).json({ error: "bad id" });
    return;
  }
  await db.delete(photosTable).where(sql`${photosTable.id} = ${id}`);
  res.json({ ok: true });
});

// ---------- Visit counter ----------
router.get("/visits", async (_req, res) => {
  const rows = await db.select().from(visitCounterTable).limit(1);
  res.json({ count: rows[0]?.count ?? 0 });
});

router.post("/visits", async (_req, res) => {
  const rows = await db.select().from(visitCounterTable).limit(1);
  if (rows.length === 0) {
    const [row] = await db.insert(visitCounterTable).values({ count: 1 }).returning();
    res.json({ count: row.count });
    return;
  }
  const [row] = await db
    .update(visitCounterTable)
    .set({ count: sql`${visitCounterTable.count} + 1` })
    .returning();
  res.json({ count: row.count });
});

export default router;
