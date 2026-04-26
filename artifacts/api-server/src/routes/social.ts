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
  usersTable,
} from "@workspace/db";
import { desc, sql, eq, inArray } from "drizzle-orm";
import { requireAuth, requireAdmin, isAdminUsername } from "../lib/auth";
import { getUserPermissions } from "./ranks";
import { sendPushToUser } from "../lib/push";

import type { RequestHandler } from "express";
export const requireDeleteMessages: RequestHandler = async (req, res, next) => {
  if (!req.session.userId) { res.status(401).json({ error: "Login required" }); return; }
  if (req.session.isAdmin) { next(); return; }
  const perms = await getUserPermissions(req.session.username!);
  if (!perms.includes("deleteMessages")) { res.status(403).json({ error: "Need deleteMessages permission" }); return; }
  next();
};
export const requireBan: RequestHandler = async (req, res, next) => {
  if (!req.session.userId) { res.status(401).json({ error: "Login required" }); return; }
  if (req.session.isAdmin) { next(); return; }
  const perms = await getUserPermissions(req.session.username!);
  if (!perms.includes("ban")) { res.status(403).json({ error: "Need ban permission" }); return; }
  next();
};

export async function isBanned(username: string): Promise<boolean> {
  const [row] = await db
    .select()
    .from(bannedUsersTable)
    .where(eq(bannedUsersTable.username, username))
    .limit(1);
  return !!row;
}

export async function audit(area: string, action: string, actor: string, target = "", body = "") {
  try {
    await db.insert(chatAuditTable).values({ area, action, actor, target, body });
  } catch { /* ignore */ }
}

const router: IRouter = Router();

function validImageData(s: unknown, max = 2_000_000): s is string {
  return typeof s === "string" && s.startsWith("data:image/") && s.length <= max;
}

// ---------- Drawings ----------
router.get("/drawings", async (req, res) => {
  const rows = await db
    .select()
    .from(drawingsTable)
    .limit(500);
  const me = req.session.username;
  const decorated = rows.map((r) => {
    const votes = (r.votes && typeof r.votes === "object" ? r.votes : {}) as Record<string, number>;
    let score = 0;
    for (const v of Object.values(votes)) score += (v > 0 ? 1 : v < 0 ? -1 : 0);
    return {
      id: r.id,
      author: r.author,
      dataUrl: r.dataUrl,
      createdAt: r.createdAt,
      score,
      myVote: me ? (votes[me] || 0) : 0,
    };
  });
  decorated.sort((a, b) => (b.score - a.score) || (new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()));
  res.json(decorated.slice(0, 200));
});

router.post("/drawings/:id/vote", requireAuth, async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isFinite(id)) { res.status(400).json({ error: "bad id" }); return; }
  const raw = Number(req.body?.vote);
  const vote = raw > 0 ? 1 : raw < 0 ? -1 : 0;
  const [existing] = await db.select().from(drawingsTable).where(eq(drawingsTable.id, id)).limit(1);
  if (!existing) { res.status(404).json({ error: "not found" }); return; }
  const me = req.session.username!;
  const votes = (existing.votes && typeof existing.votes === "object" ? { ...(existing.votes as Record<string, number>) } : {}) as Record<string, number>;
  if (vote === 0) delete votes[me];
  else votes[me] = vote;
  await db.update(drawingsTable).set({ votes }).where(eq(drawingsTable.id, id));
  let score = 0;
  for (const v of Object.values(votes)) score += (v > 0 ? 1 : v < 0 ? -1 : 0);
  res.json({ ok: true, score, myVote: vote });
});

router.post("/drawings", requireAuth, async (req, res) => {
  const { dataUrl } = req.body ?? {};
  if (typeof dataUrl !== "string" || !dataUrl.startsWith("data:image/")) {
    res.status(400).json({ error: "dataUrl must be a data:image/* string" });
    return;
  }
  if (dataUrl.length > 600_000) {
    res.status(413).json({ error: "Drawing too large" });
    return;
  }
  const author = req.session.username || "anon";
  if (await isBanned(author)) {
    await audit("drawing", "blocked", author, author, "submit attempt");
    res.status(403).json({ error: "You are banned." });
    return;
  }
  const [row] = await db
    .insert(drawingsTable)
    .values({ dataUrl, author })
    .returning();
  await audit("drawing", "post", author, "", `id=${row.id}`);
  res.json(row);
});

router.delete("/drawings/:id", requireDeleteMessages, async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isFinite(id)) { res.status(400).json({ error: "bad id" }); return; }
  const [existing] = await db.select().from(drawingsTable).where(eq(drawingsTable.id, id)).limit(1);
  if (!existing) { res.status(404).json({ error: "not found" }); return; }
  await db.delete(drawingsTable).where(eq(drawingsTable.id, id));
  await audit("drawing", "delete", req.session.username || "admin", existing.author, `id=${id}`);
  res.json({ ok: true });
});

// ---------- Chat ----------
router.get("/chat", async (_req, res) => {
  const rows = await db
    .select()
    .from(chatMessagesTable)
    .orderBy(desc(chatMessagesTable.createdAt))
    .limit(100);
  res.json(rows.reverse());
});

router.post("/chat", requireAuth, async (req, res) => {
  const { body, imageUrl, videoUrl, replyTo } = req.body ?? {};
  const trimmedBody = typeof body === "string" ? body.trim() : "";
  if (!trimmedBody && !imageUrl && !videoUrl) {
    res.status(400).json({ error: "body or media required" });
    return;
  }
  if (trimmedBody.length > 500) { res.status(413).json({ error: "Message too long" }); return; }
  if (imageUrl !== undefined && imageUrl !== null && !validImageData(imageUrl, 3_000_000)) {
    res.status(400).json({ error: "bad imageUrl" }); return;
  }
  if (videoUrl !== undefined && videoUrl !== null) {
    if (typeof videoUrl !== "string" || !videoUrl.startsWith("data:video/") || videoUrl.length > 12_000_000) {
      res.status(400).json({ error: "bad videoUrl (max ~9MB)" }); return;
    }
  }
  const replyToId = (typeof replyTo === "number" && Number.isFinite(replyTo)) ? replyTo : null;
  const author = req.session.username || "anon";
  if (await isBanned(author)) {
    await audit("chat", "blocked", author, author, trimmedBody.slice(0, 500));
    res.status(403).json({ error: "You are banned from chat." });
    return;
  }
  const [row] = await db
    .insert(chatMessagesTable)
    .values({ body: trimmedBody, author, imageUrl: imageUrl || null, videoUrl: videoUrl || null, replyTo: replyToId })
    .returning();
  await audit("chat", "post", author, "", trimmedBody + (imageUrl ? " [image]" : "") + (videoUrl ? " [video]" : ""));

  // @-mention notifications: pull every @name from the body, map to real users
  // (case-insensitively), and push to anyone other than the author. Best-effort
  // — if the lookup or push fails we still return the saved message.
  try {
    const candidates = Array.from(new Set(
      Array.from(trimmedBody.matchAll(/@([A-Za-z0-9_]{2,32})/g)).map((m) => m[1]!.toLowerCase())
    ));
    if (candidates.length > 0) {
      const allUsers = await db
        .select({ username: usersTable.username })
        .from(usersTable)
        .where(inArray(sql`lower(${usersTable.username})`, candidates));
      const targets = allUsers
        .map((u) => u.username)
        .filter((u) => u.toLowerCase() !== author.toLowerCase());
      const preview = trimmedBody.slice(0, 140);
      for (const t of targets) {
        void sendPushToUser(t, {
          title: `${author} mentioned you in chat`,
          body: preview,
          tag: `chat-mention:${author}`,
          url: "/",
        }).catch(() => {});
      }
    }
  } catch { /* mention dispatch is best-effort */ }

  res.json(row);
});

// ---------- Typing indicator ----------
const typingMap = new Map<string, number>(); // username -> lastTypingMs
router.post("/chat/typing", requireAuth, (req, res) => {
  typingMap.set(req.session.username!, Date.now());
  res.json({ ok: true });
});
router.get("/chat/typing", (_req, res) => {
  const now = Date.now();
  const list: string[] = [];
  for (const [u, t] of typingMap.entries()) {
    if (now - t < 4000) list.push(u);
    else typingMap.delete(u);
  }
  res.json({ typing: list });
});

router.delete("/chat", requireDeleteMessages, async (req, res) => {
  const all = await db.select().from(chatMessagesTable);
  await db.delete(chatMessagesTable);
  await audit("chat", "clear", req.session.username || "admin", "", `Cleared ${all.length} messages`);
  res.json({ ok: true, count: all.length });
});

router.delete("/chat/:id", requireDeleteMessages, async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isFinite(id)) { res.status(400).json({ error: "bad id" }); return; }
  const [existing] = await db.select().from(chatMessagesTable).where(eq(chatMessagesTable.id, id)).limit(1);
  if (!existing) { res.status(404).json({ error: "not found" }); return; }
  await db.delete(chatMessagesTable).where(eq(chatMessagesTable.id, id));
  await audit("chat", "delete", req.session.username || "admin", existing.author, existing.body);
  res.json({ ok: true });
});

// ---------- Audit log (admin) — supports area filter ----------
router.get("/audit", requireAdmin, async (req, res) => {
  const area = typeof req.query.area === "string" ? req.query.area : null;
  const rows = await db
    .select()
    .from(chatAuditTable)
    .where(area ? eq(chatAuditTable.area, area) : undefined as any)
    .orderBy(desc(chatAuditTable.createdAt))
    .limit(500);
  res.json(rows);
});
// Back-compat alias
router.get("/chat/audit", requireAdmin, async (_req, res) => {
  const rows = await db
    .select()
    .from(chatAuditTable)
    .where(eq(chatAuditTable.area, "chat"))
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

router.post("/bans", requireBan, async (req, res) => {
  const { username, reason } = req.body ?? {};
  if (typeof username !== "string" || !username.trim()) { res.status(400).json({ error: "username required" }); return; }
  const u = username.trim().slice(0, 32);
  if (isAdminUsername(u)) { res.status(400).json({ error: "Cannot ban the admin account" }); return; }
  const safeReason = typeof reason === "string" ? reason.slice(0, 200) : "";
  const actor = req.session.username || "admin";
  try {
    const [row] = await db.insert(bannedUsersTable).values({ username: u, bannedBy: actor, reason: safeReason }).returning();
    await audit("global", "ban", actor, u, safeReason);
    res.json(row);
  } catch { res.status(409).json({ error: "User already banned" }); }
});

router.delete("/bans/:username", requireBan, async (req, res) => {
  const u = String(req.params.username || "").trim();
  if (!u) { res.status(400).json({ error: "username required" }); return; }
  await db.delete(bannedUsersTable).where(eq(bannedUsersTable.username, u));
  await audit("global", "unban", req.session.username || "admin", u, "");
  res.json({ ok: true });
});

// ---------- Guestbook ----------
router.get("/guestbook", async (_req, res) => {
  const rows = await db.select().from(guestbookTable).orderBy(desc(guestbookTable.createdAt)).limit(200);
  res.json(rows);
});

router.post("/guestbook", async (req, res) => {
  const { body, author } = req.body ?? {};
  if (typeof body !== "string" || !body.trim()) { res.status(400).json({ error: "body required" }); return; }
  if (body.length > 280) { res.status(413).json({ error: "Note too long" }); return; }
  // If logged in, use session name (and check ban). Otherwise, anonymous.
  const sessionName = req.session.username;
  const safeAuthor = sessionName
    ? sessionName
    : (typeof author === "string" && author.trim() ? author.trim().slice(0, 32) : "anon");
  if (sessionName && await isBanned(sessionName)) {
    await audit("guestbook", "blocked", sessionName, sessionName, body.trim().slice(0, 280));
    res.status(403).json({ error: "You are banned." });
    return;
  }
  const [row] = await db.insert(guestbookTable).values({ body: body.trim(), author: safeAuthor }).returning();
  await audit("guestbook", "post", safeAuthor, "", body.trim());
  res.json(row);
});

router.delete("/guestbook/:id", requireDeleteMessages, async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isFinite(id)) { res.status(400).json({ error: "bad id" }); return; }
  const [existing] = await db.select().from(guestbookTable).where(eq(guestbookTable.id, id)).limit(1);
  if (!existing) { res.status(404).json({ error: "not found" }); return; }
  await db.delete(guestbookTable).where(eq(guestbookTable.id, id));
  await audit("guestbook", "delete", req.session.username || "admin", existing.author, existing.body);
  res.json({ ok: true });
});

router.delete("/guestbook", requireDeleteMessages, async (req, res) => {
  const all = await db.select().from(guestbookTable);
  await db.delete(guestbookTable);
  await audit("guestbook", "clear", req.session.username || "admin", "", `Cleared ${all.length} entries`);
  res.json({ ok: true, count: all.length });
});

// ---------- Photos ----------
router.get("/photos", async (_req, res) => {
  const rows = await db.select().from(photosTable).orderBy(desc(photosTable.createdAt)).limit(500);
  res.json(rows);
});

router.post("/photos", requireAdmin, async (req, res) => {
  const { dataUrl, caption } = req.body ?? {};
  if (typeof dataUrl !== "string" || !dataUrl.startsWith("data:image/")) { res.status(400).json({ error: "dataUrl must be a data:image/* string" }); return; }
  if (dataUrl.length > 8_000_000) { res.status(413).json({ error: "Photo too large (max ~6MB)" }); return; }
  const safeCaption = typeof caption === "string" ? caption.slice(0, 200) : "";
  const [row] = await db.insert(photosTable).values({ dataUrl, caption: safeCaption }).returning();
  res.json(row);
});

router.delete("/photos/:id", requireAdmin, async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isFinite(id)) { res.status(400).json({ error: "bad id" }); return; }
  await db.delete(photosTable).where(eq(photosTable.id, id));
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
  const [row] = await db.update(visitCounterTable).set({ count: sql`${visitCounterTable.count} + 1` }).returning();
  res.json({ count: row.count });
});

export default router;
