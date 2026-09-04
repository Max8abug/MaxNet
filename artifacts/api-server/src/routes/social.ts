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
import { asc, desc, sql, eq, inArray, and, lt } from "drizzle-orm";
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

function isHttpUrl(s: unknown): s is string {
  if (typeof s !== "string" || s.length > 4_000) return false;
  try {
    const url = new URL(s);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

function isTenorUrl(value: string): boolean {
  try {
    const hostname = new URL(value).hostname.toLowerCase();
    return hostname === "tenor.com" || hostname.endsWith(".tenor.com") || hostname === "tenor.co";
  } catch {
    return false;
  }
}

async function normalizeGifUrl(value: unknown): Promise<string | null> {
  if (!isHttpUrl(value)) return null;
  const url = value.trim();
  if (/\.gif(?:$|[?#])/i.test(url)) return url;
  if (!isTenorUrl(url)) return null;

  // Tenor's share pages are HTML, not image resources. Resolve the image
  // advertised by the page so browsers receive an actual GIF URL.
  try {
    const response = await fetch(url, { headers: { "user-agent": "Portfolio98 chat GIF resolver" } });
    if (!response.ok) return null;
    const html = await response.text();
    const matches = [
      html.match(/<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']+)["']/i),
      html.match(/<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:image["']/i),
      html.match(/https:\/\/media\.tenor\.com\/[^"'\\\s]+/i),
    ];
    const candidate = matches.find(Boolean)?.[1] || matches.find(Boolean)?.[0];
    if (!candidate) return null;
    const decoded = candidate.replace(/&amp;/g, "&");
    return /\.gif(?:$|[?#])/i.test(decoded) ? decoded : null;
  } catch {
    return null;
  }
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
const CHAT_ROOMS = ["lobby", "media", "games", "random"] as const;
type ChatRoom = typeof CHAT_ROOMS[number];
const CHAT_SEND_DELAY_MS = 5_000;
const chatLastPostMap = new Map<string, number>();

function normalizeChatRoom(value: unknown): ChatRoom {
  return typeof value === "string" && (CHAT_ROOMS as readonly string[]).includes(value)
    ? value as ChatRoom
    : "lobby";
}

router.get("/chat/rooms", async (_req, res) => {
  const statuses = await Promise.all(CHAT_ROOMS.map(async (room) => {
    const [latest] = await db
      .select({ id: chatMessagesTable.id, author: chatMessagesTable.author })
      .from(chatMessagesTable)
      .where(eq(chatMessagesTable.room, room))
      .orderBy(desc(chatMessagesTable.id))
      .limit(1);
    const typing = Array.from(typingMap.entries())
      .filter(([key, lastTyping]) => key.startsWith(`${room}:`) && Date.now() - lastTyping < 4_000)
      .map(([key]) => key.slice(room.length + 1));
    return {
      room,
      latestMessageId: latest?.id ?? 0,
      latestAuthor: latest?.author ?? null,
      typing,
    };
  }));
  res.json(statuses);
});

router.get("/chat", async (req, res) => {
  const room = normalizeChatRoom(req.query.room);
  const requestedLimit = Number(req.query.limit);
  const limit = Number.isFinite(requestedLimit) ? Math.max(20, Math.min(100, Math.floor(requestedLimit))) : 60;
  const before = Number(req.query.before);
  const hasBefore = Number.isFinite(before) && before > 0;
  const rows = await db
    .select()
    .from(chatMessagesTable)
    .where(hasBefore
      ? and(eq(chatMessagesTable.room, room), lt(chatMessagesTable.id, before))
      : eq(chatMessagesTable.room, room))
    .orderBy(desc(chatMessagesTable.id))
    .limit(limit + 1);
  const hasMore = rows.length > limit;
  res.setHeader("X-Chat-Has-More", hasMore ? "1" : "0");
  rows.splice(limit);
  res.json(rows.reverse());
});

type ZipEntry = {
  name: string;
  crc: number;
  size: number;
  offset: number;
  dosTime: number;
  dosDate: number;
};

function crc32(data: Buffer): number {
  let crc = 0xffffffff;
  for (const byte of data) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit++) {
      crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function dosTimestamp(date: Date): { dosTime: number; dosDate: number } {
  const year = Math.max(1980, date.getFullYear());
  return {
    dosTime: (date.getHours() << 11) | (date.getMinutes() << 5) | Math.floor(date.getSeconds() / 2),
    dosDate: ((year - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate(),
  };
}

function zipLocalHeader(name: Buffer, data: Buffer, timestamp: { dosTime: number; dosDate: number }): Buffer {
  const header = Buffer.alloc(30 + name.length);
  header.writeUInt32LE(0x04034b50, 0);
  header.writeUInt16LE(20, 4); // version needed
  header.writeUInt16LE(0x800, 6); // UTF-8 names
  header.writeUInt16LE(0, 8); // stored, not compressed
  header.writeUInt16LE(timestamp.dosTime, 10);
  header.writeUInt16LE(timestamp.dosDate, 12);
  header.writeUInt32LE(crc32(data), 14);
  header.writeUInt32LE(data.length, 18);
  header.writeUInt32LE(data.length, 22);
  header.writeUInt16LE(name.length, 26);
  header.writeUInt16LE(0, 28);
  name.copy(header, 30);
  return header;
}

function zipCentralHeader(entry: ZipEntry): Buffer {
  const name = Buffer.from(entry.name, "utf8");
  const header = Buffer.alloc(46 + name.length);
  header.writeUInt32LE(0x02014b50, 0);
  header.writeUInt16LE(20, 4); // version made by
  header.writeUInt16LE(20, 6); // version needed
  header.writeUInt16LE(0x800, 8); // UTF-8 names
  header.writeUInt16LE(0, 10); // stored, not compressed
  header.writeUInt16LE(entry.dosTime, 12);
  header.writeUInt16LE(entry.dosDate, 14);
  header.writeUInt32LE(entry.crc, 16);
  header.writeUInt32LE(entry.size, 20);
  header.writeUInt32LE(entry.size, 24);
  header.writeUInt16LE(name.length, 28);
  header.writeUInt16LE(0, 30); // extra length
  header.writeUInt16LE(0, 32); // comment length
  header.writeUInt16LE(0, 34); // disk number
  header.writeUInt16LE(0, 36); // internal attributes
  header.writeUInt32LE(0, 38); // external attributes
  header.writeUInt32LE(entry.offset, 42);
  name.copy(header, 46);
  return header;
}

function decodeDataUrl(value: string): { data: Buffer; mime: string } | null {
  const match = value.match(/^data:([^;,]+)(;base64)?,([\s\S]*)$/);
  if (!match) return null;
  try {
    const mime = match[1] || "application/octet-stream";
    const payload = match[3] || "";
    const data = match[2]
      ? Buffer.from(payload.replace(/\s/g, ""), "base64")
      : Buffer.from(decodeURIComponent(payload), "utf8");
    return { data, mime };
  } catch {
    return null;
  }
}

function mediaExtension(mime: string): string {
  const known: Record<string, string> = {
    "image/jpeg": "jpg",
    "image/png": "png",
    "image/gif": "gif",
    "image/webp": "webp",
    "image/svg+xml": "svg",
    "video/mp4": "mp4",
    "video/webm": "webm",
    "video/ogg": "ogv",
    "video/quicktime": "mov",
  };
  return known[mime.toLowerCase()] || "bin";
}

// A deliberately small ZIP writer keeps the archive dependency-free. Media
// data is already base64 in PostgreSQL and is not meaningfully compressible;
// storing it avoids another large memory spike while still producing a normal
// ZIP that every archive tool can open.
router.get("/chat/export", requireAdmin, async (_req, res) => {
  const [messages, auditRows] = await Promise.all([
    db.select().from(chatMessagesTable).orderBy(asc(chatMessagesTable.createdAt), asc(chatMessagesTable.id)),
    db.select().from(chatAuditTable)
      .where(eq(chatAuditTable.area, "chat"))
      .orderBy(asc(chatAuditTable.createdAt), asc(chatAuditTable.id)),
  ]);

  const archiveDate = new Date();
  const timestamp = dosTimestamp(archiveDate);
  const entries: ZipEntry[] = [];
  const chunks: Buffer[] = [];
  let offset = 0;
  let aborted = false;
  const onClose = () => { aborted = true; };
  res.on("close", onClose);

  const write = async (chunk: Buffer): Promise<void> => {
    if (aborted) throw new Error("client disconnected");
    chunks.push(chunk);
  };

  const addEntry = async (name: string, data: Buffer): Promise<void> => {
    const nameBytes = Buffer.from(name, "utf8");
    const entry: ZipEntry = {
      name,
      crc: crc32(data),
      size: data.length,
      offset,
      ...timestamp,
    };
    const header = zipLocalHeader(nameBytes, data, timestamp);
    await write(header);
    await write(data);
    offset += header.length + data.length;
    entries.push(entry);
  };

  const mediaErrors: { messageId: number; field: "imageUrl" | "videoUrl" }[] = [];
  const exportedMessages = messages.map((message) => {
    const result: Record<string, unknown> = {
      id: message.id,
      author: message.author,
      body: message.body,
      replyTo: message.replyTo,
      room: message.room,
      createdAt: message.createdAt,
    };
    for (const field of ["imageUrl", "videoUrl"] as const) {
      const value = message[field];
      if (!value) continue;
      const decoded = decodeDataUrl(value);
      if (!decoded) {
        mediaErrors.push({ messageId: message.id, field });
        continue;
      }
      const kind = field === "imageUrl" ? "image" : "video";
      const fileName = `media/chat-${message.id}-${kind}.${mediaExtension(decoded.mime)}`;
      result[field === "imageUrl" ? "imageFile" : "videoFile"] = fileName;
      result[field === "imageUrl" ? "imageMime" : "videoMime"] = decoded.mime;
      (result as any).__media = (result as any).__media || [];
      (result as any).__media.push({ fileName, data: decoded.data });
    }
    return result;
  });

  res.setHeader("Content-Type", "application/zip");
  res.setHeader(
    "Content-Disposition",
    `attachment; filename="chat-archive-${archiveDate.toISOString().slice(0, 10)}.zip"`,
  );
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("X-Accel-Buffering", "no");

  try {
    await addEntry("README.txt", Buffer.from(
      [
        "Chat archive",
        `Exported: ${archiveDate.toISOString()}`,
        `Messages: ${messages.length}`,
        "Text and message metadata are in messages.json.",
        "Attached images and videos are in the media/ folder and are linked from messages.json.",
        "Moderation actions recorded before this export are in chat-audit.json.",
        "",
      ].join("\n"),
      "utf8",
    ));

    for (const message of exportedMessages) {
      const media = (message as any).__media as { fileName: string; data: Buffer }[] | undefined;
      delete (message as any).__media;
      if (!media) continue;
      for (const item of media) await addEntry(item.fileName, item.data);
    }

    await addEntry("messages.json", Buffer.from(JSON.stringify({
      exportedAt: archiveDate.toISOString(),
      messageCount: messages.length,
      mediaErrors,
      messages: exportedMessages,
    }, null, 2), "utf8"));
    await addEntry("chat-audit.json", Buffer.from(JSON.stringify({
      exportedAt: archiveDate.toISOString(),
      entries: auditRows,
    }, null, 2), "utf8"));

    const centralDirectoryOffset = offset;
    for (const entry of entries) {
      const central = zipCentralHeader(entry);
      await write(central);
      offset += central.length;
    }
    const end = Buffer.alloc(22);
    end.writeUInt32LE(0x06054b50, 0);
    end.writeUInt16LE(0, 4); // disk number
    end.writeUInt16LE(0, 6); // central directory disk
    end.writeUInt16LE(entries.length, 8);
    end.writeUInt16LE(entries.length, 10);
    end.writeUInt32LE(offset - centralDirectoryOffset, 12);
    end.writeUInt32LE(centralDirectoryOffset, 16);
    end.writeUInt16LE(0, 20);
    await write(end);
    const archive = Buffer.concat(chunks);
    res.setHeader("Content-Length", archive.length);
    res.end(archive);
  } catch (error) {
    if (!res.headersSent) res.status(500).json({ error: "Could not create chat archive" });
    else res.destroy(error as Error);
  } finally {
    res.off("close", onClose);
  }
});

router.post("/chat", requireAuth, async (req, res) => {
  const { body, imageUrl, videoUrl, replyTo } = req.body ?? {};
  const trimmedBody = typeof body === "string" ? body.trim() : "";
  if (!trimmedBody && !imageUrl && !videoUrl) {
    res.status(400).json({ error: "body or media required" });
    return;
  }
  if (trimmedBody.length > 500) { res.status(413).json({ error: "Message too long" }); return; }
  let normalizedImageUrl: string | null = null;
  if (imageUrl !== undefined && imageUrl !== null) {
    if (validImageData(imageUrl, 3_000_000)) normalizedImageUrl = imageUrl;
    else normalizedImageUrl = await normalizeGifUrl(imageUrl);
    if (!normalizedImageUrl) {
      res.status(400).json({ error: "imageUrl must be a data image, direct GIF URL, or Tenor share link" }); return;
    }
  }
  if (videoUrl !== undefined && videoUrl !== null) {
    if (typeof videoUrl !== "string" || !videoUrl.startsWith("data:video/") || videoUrl.length > 12_000_000) {
      res.status(400).json({ error: "bad videoUrl (max ~9MB)" }); return;
    }
  }
  const replyToId = (typeof replyTo === "number" && Number.isFinite(replyTo)) ? replyTo : null;
  const author = req.session.username || "anon";
  const room = normalizeChatRoom(req.body?.room);
  const previousPost = chatLastPostMap.get(author) || 0;
  const remainingDelay = CHAT_SEND_DELAY_MS - (Date.now() - previousPost);
  if (remainingDelay > 0) {
    res.status(429).json({ error: `Please wait ${Math.ceil(remainingDelay / 1000)}s before sending another message.` });
    return;
  }
  if (await isBanned(author)) {
    await audit("chat", "blocked", author, room, trimmedBody.slice(0, 500));
    res.status(403).json({ error: "You are banned from chat." });
    return;
  }
  const [row] = await db
    .insert(chatMessagesTable)
    .values({ body: trimmedBody, author, room, imageUrl: normalizedImageUrl, videoUrl: videoUrl || null, replyTo: replyToId })
    .returning();
  chatLastPostMap.set(author, Date.now());
  await audit("chat", "post", author, room, trimmedBody + (normalizedImageUrl ? " [image]" : "") + (videoUrl ? " [video]" : ""));

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
const typingMap = new Map<string, number>(); // room:username -> lastTypingMs
router.post("/chat/typing", requireAuth, (req, res) => {
  typingMap.set(`${normalizeChatRoom(req.body?.room)}:${req.session.username!}`, Date.now());
  res.json({ ok: true });
});
router.get("/chat/typing", (req, res) => {
  const room = normalizeChatRoom(req.query.room);
  const now = Date.now();
  const list: string[] = [];
  for (const [key, t] of typingMap.entries()) {
    if (now - t < 4000 && key.startsWith(`${room}:`)) list.push(key.slice(room.length + 1));
    else if (now - t >= 4000) typingMap.delete(key);
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
    .orderBy(desc(chatAuditTable.createdAt));
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
