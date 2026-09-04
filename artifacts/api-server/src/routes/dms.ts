import { Router, type IRouter } from "express";
import {
  db, dmsTable, usersTable, dmGroupsTable, dmGroupMembersTable, dmReportsTable,
} from "@workspace/db";
import { and, eq, or, desc, isNull, sql, inArray } from "drizzle-orm";
import { requireAuth, requireAdmin, isAdminUsername } from "../lib/auth";
import { isBanned, audit } from "./social";
import { getUserPermissions } from "./ranks";
import { sendPushToUser } from "../lib/push";

const router: IRouter = Router();

async function canReceiveDMs(username: string): Promise<boolean> {
  if (isAdminUsername(username)) return true;
  const perms = await getUserPermissions(username);
  return perms.includes("dm");
}

router.get("/dms/contacts", requireAuth, async (_req, res) => {
  const all = await db.select({
    username: usersTable.username,
    avatarUrl: usersTable.avatarUrl,
    rank: usersTable.rank,
    isAdmin: usersTable.isAdmin,
  }).from(usersTable);
  const contacts: any[] = [];
  for (const u of all) {
    if (await canReceiveDMs(u.username)) contacts.push(u);
  }
  res.json(contacts);
});

async function groupForUser(id: number, username: string) {
  const [group] = await db.select().from(dmGroupsTable).where(eq(dmGroupsTable.id, id)).limit(1);
  if (!group) return null;
  const members = await db.select({ username: dmGroupMembersTable.username })
    .from(dmGroupMembersTable).where(eq(dmGroupMembersTable.groupId, id));
  if (!members.some((member) => member.username === username)) return null;
  return { group, members: members.map((member) => member.username) };
}

async function groupSummary(id: number, username: string) {
  const access = await groupForUser(id, username);
  if (!access) return null;
  const rows = await db.select().from(dmsTable)
    .where(eq(dmsTable.groupId, id)).orderBy(desc(dmsTable.createdAt)).limit(1);
  const last = rows[0];
  const unreadRows = await db.select({ id: dmsTable.id, fromUser: dmsTable.fromUser }).from(dmsTable).where(and(
    eq(dmsTable.groupId, id), isNull(dmsTable.readAt),
  ));
  return {
    id: access.group.id,
    name: access.group.name,
    createdBy: access.group.createdBy,
    members: access.members,
    lastBody: last?.body || "",
    lastAt: (last?.createdAt as any) || access.group.createdAt,
    unread: unreadRows.filter((row) => row.fromUser !== username).length,
  };
}

router.get("/dms/groups", requireAuth, async (req, res) => {
  const me = req.session.username!;
  const memberships = await db.select({ groupId: dmGroupMembersTable.groupId })
    .from(dmGroupMembersTable).where(eq(dmGroupMembersTable.username, me));
  const groups = await Promise.all(memberships.map((membership) => groupSummary(membership.groupId, me)));
  res.json(groups.filter(Boolean));
});

router.post("/dms/groups", requireAuth, async (req, res) => {
  const me = req.session.username!;
  const name = typeof req.body?.name === "string" ? req.body.name.trim().slice(0, 80) : "";
  const requested: unknown[] = Array.isArray(req.body?.members) ? req.body.members : [];
  const requestedNames = requested
    .filter((member): member is string => typeof member === "string")
    .map((member: string) => member.trim()).filter(Boolean);
  const members: string[] = [...new Set([me, ...requestedNames])];
  if (!name) { res.status(400).json({ error: "Group name required" }); return; }
  if (members.length < 3) { res.status(400).json({ error: "Choose at least two other people" }); return; }
  if (members.length > 20) { res.status(400).json({ error: "Groups are limited to 20 people" }); return; }
  for (const member of members) {
    const [exists] = await db.select({ username: usersTable.username })
      .from(usersTable).where(eq(usersTable.username, member)).limit(1);
    if (!exists) { res.status(400).json({ error: `User not found: ${member}` }); return; }
    if (member !== me && !(await canReceiveDMs(member))) {
      res.status(403).json({ error: `${member} does not accept DMs` }); return;
    }
  }
  const result = await db.transaction(async (tx) => {
    const [group] = await tx.insert(dmGroupsTable).values({ name, createdBy: me }).returning();
    await tx.insert(dmGroupMembersTable).values(members.map((username) => ({ groupId: group.id, username })));
    return group;
  });
  await audit("dm", "group-create", me, String(result.id), name);
  res.json({ id: result.id, name: result.name, createdBy: result.createdBy, members, lastBody: "", lastAt: result.createdAt, unread: 0 });
});

router.get("/dms/groups/:id", requireAuth, async (req, res) => {
  const id = Number(req.params.id);
  const access = await groupForUser(id, req.session.username!);
  if (!access) { res.status(404).json({ error: "Group not found" }); return; }
  const rows = await db.select().from(dmsTable)
    .where(eq(dmsTable.groupId, id)).orderBy(desc(dmsTable.createdAt)).limit(200);
  res.json(rows.reverse());
});

router.post("/dms/groups/:id", requireAuth, async (req, res) => {
  const id = Number(req.params.id);
  const me = req.session.username!;
  const access = await groupForUser(id, me);
  const body = typeof req.body?.body === "string" ? req.body.body.trim().slice(0, 1000) : "";
  if (!access) { res.status(404).json({ error: "Group not found" }); return; }
  if (!body) { res.status(400).json({ error: "body required" }); return; }
  if (await isBanned(me)) { res.status(403).json({ error: "You are banned." }); return; }
  const [row] = await db.insert(dmsTable).values({ fromUser: me, toUser: me, groupId: id, body }).returning();
  await audit("dm", "group-send", me, String(id), body.slice(0, 200));
  for (const member of access.members) {
    if (member !== me) void sendPushToUser(member, {
      title: `${me} in ${access.group.name}`, body: body.slice(0, 140), tag: `dm-group:${id}`, url: "/",
    }).catch(() => {});
  }
  res.json(row);
});

router.post("/dms/groups/:id/read", requireAuth, async (req, res) => {
  const id = Number(req.params.id);
  const access = await groupForUser(id, req.session.username!);
  if (!access) { res.status(404).json({ error: "Group not found" }); return; }
  await db.update(dmsTable).set({ readAt: sql`NOW()` }).where(and(
    eq(dmsTable.groupId, id), isNull(dmsTable.readAt),
  ));
  res.json({ ok: true });
});

router.post("/dms/report", requireAuth, async (req, res) => {
  const messageId = Number(req.body?.messageId);
  const reason = typeof req.body?.reason === "string" ? req.body.reason.trim().slice(0, 500) : "";
  const me = req.session.username!;
  const [message] = await db.select().from(dmsTable).where(eq(dmsTable.id, messageId)).limit(1);
  if (!message) { res.status(404).json({ error: "Message not found" }); return; }
  let allowed = message.fromUser === me || message.toUser === me;
  if (message.groupId) allowed = !!(await groupForUser(message.groupId, me));
  if (!allowed) { res.status(403).json({ error: "You cannot report this message" }); return; }
  const [report] = await db.insert(dmReportsTable).values({ messageId, reporter: me, reason }).returning();
  await audit("dm", "report", me, String(messageId), reason);
  res.json({ ok: true, reportId: report.id });
});

router.get("/dms/moderation/messages", requireAdmin, async (_req, res) => {
  const rows = await db.select().from(dmsTable).orderBy(desc(dmsTable.createdAt)).limit(500);
  res.json(rows);
});

router.get("/dms/moderation/reports", requireAdmin, async (_req, res) => {
  const reports = await db.select().from(dmReportsTable).orderBy(desc(dmReportsTable.createdAt)).limit(500);
  const ids = reports.map((report) => report.messageId);
  const messages = ids.length ? await db.select().from(dmsTable).where(inArray(dmsTable.id, ids)) : [];
  const byId = new Map(messages.map((message) => [message.id, message]));
  res.json(reports.map((report) => ({ ...report, message: byId.get(report.messageId) || null })));
});

router.patch("/dms/moderation/reports/:id", requireAdmin, async (req, res) => {
  const status = req.body?.status;
  if (status !== "resolved" && status !== "dismissed") { res.status(400).json({ error: "Invalid report status" }); return; }
  await db.update(dmReportsTable).set({ status, reviewedAt: new Date() })
    .where(eq(dmReportsTable.id, Number(req.params.id)));
  res.json({ ok: true });
});

router.delete("/dms/moderation/messages/:id", requireAdmin, async (req, res) => {
  const id = Number(req.params.id);
  const [message] = await db.select().from(dmsTable).where(eq(dmsTable.id, id)).limit(1);
  if (!message) { res.status(404).json({ error: "Message not found" }); return; }
  await db.delete(dmsTable).where(eq(dmsTable.id, id));
  await audit("dm", "delete", req.session.username || "admin", `${message.fromUser}/${message.toUser}`, message.body);
  res.json({ ok: true });
});

router.get("/dms/:other", requireAuth, async (req, res) => {
  const me = req.session.username!;
  const other = String(req.params.other);
  const rows = await db.select().from(dmsTable).where(
    or(
      and(eq(dmsTable.fromUser, me), eq(dmsTable.toUser, other)),
      and(eq(dmsTable.fromUser, other), eq(dmsTable.toUser, me)),
    )
  ).orderBy(desc(dmsTable.createdAt)).limit(200);
  res.json(rows.reverse());
});

router.post("/dms/:other", requireAuth, async (req, res) => {
  const me = req.session.username!;
  const other = String(req.params.other);
  const { body } = req.body ?? {};
  if (typeof body !== "string" || !body.trim()) { res.status(400).json({ error: "body required" }); return; }
  if (await isBanned(me)) { res.status(403).json({ error: "You are banned." }); return; }
  if (!(await canReceiveDMs(other))) { res.status(403).json({ error: "User does not accept DMs" }); return; }
  const trimmed = body.trim().slice(0, 1000);
  const [row] = await db.insert(dmsTable).values({ fromUser: me, toUser: other, body: trimmed }).returning();
  await audit("dm", "send", me, other, trimmed.slice(0, 200));
  // Fire a browser push to the recipient so they're alerted even if the
  // site tab is closed. Best-effort — failures here never block the send.
  void sendPushToUser(other, {
    title: `New message from ${me}`,
    body: trimmed.slice(0, 140),
    tag: `dm:${me}`,
    url: "/",
  }).catch(() => {});
  res.json(row);
});

// Mark every incoming DM from `other` as read. Called by the client whenever
// it opens or polls a conversation that is currently visible — that way the
// inbox unread badge and the taskbar notification dot clear immediately
// instead of piling up forever.
router.post("/dms/:other/read", requireAuth, async (req, res) => {
  const me = req.session.username!;
  const other = String(req.params.other);
  await db.update(dmsTable)
    .set({ readAt: sql`NOW()` })
    .where(and(
      eq(dmsTable.toUser, me),
      eq(dmsTable.fromUser, other),
      isNull(dmsTable.readAt),
    ));
  res.json({ ok: true });
});

router.get("/dms", requireAuth, async (req, res) => {
  const me = req.session.username!;
  const rows = await db.select().from(dmsTable).where(and(
    or(eq(dmsTable.fromUser, me), eq(dmsTable.toUser, me)),
    isNull(dmsTable.groupId),
  )).orderBy(desc(dmsTable.createdAt)).limit(500);
  const partners = new Map<string, { partner: string; lastBody: string; lastAt: string; unread: number }>();
  for (const r of rows) {
    const partner = r.fromUser === me ? r.toUser : r.fromUser;
    if (!partners.has(partner)) {
      partners.set(partner, { partner, lastBody: r.body, lastAt: r.createdAt as any, unread: 0 });
    }
    if (r.toUser === me && !r.readAt) partners.get(partner)!.unread++;
  }
  res.json([...partners.values()]);
});

export default router;
