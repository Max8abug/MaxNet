import { Router, type IRouter } from "express";
import {
  db,
  dmsTable,
  usersTable,
  dmGroupsTable,
  dmGroupMembersTable,
  dmReportsTable,
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

async function isGroupMember(groupId: number, username: string): Promise<boolean> {
  const [member] = await db.select({ id: dmGroupMembersTable.id })
    .from(dmGroupMembersTable)
    .where(and(eq(dmGroupMembersTable.groupId, groupId), eq(dmGroupMembersTable.username, username)))
    .limit(1);
  return !!member;
}

async function notifyAdmins(title: string, body: string, tag: string) {
  try {
    const admins = await db.select({ username: usersTable.username })
      .from(usersTable)
      .where(eq(usersTable.isAdmin, true));
    for (const admin of admins) {
      void sendPushToUser(admin.username, { title, body, tag, url: "/" }).catch(() => {});
    }
  } catch { /* notification delivery is best effort */ }
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

router.get("/dms/groups", requireAuth, async (req, res) => {
  const username = req.session.username!;
  const memberships = await db.select({ groupId: dmGroupMembersTable.groupId })
    .from(dmGroupMembersTable)
    .where(eq(dmGroupMembersTable.username, username));
  const ids = memberships.map((m) => m.groupId);
  if (ids.length === 0) { res.json([]); return; }
  const groups = await db.select().from(dmGroupsTable).where(inArray(dmGroupsTable.id, ids)).orderBy(desc(dmGroupsTable.createdAt));
  const result = [];
  for (const group of groups) {
    const members = await db.select({ username: dmGroupMembersTable.username })
      .from(dmGroupMembersTable).where(eq(dmGroupMembersTable.groupId, group.id));
    result.push({ ...group, members: members.map((m) => m.username) });
  }
  res.json(result);
});

router.post("/dms/groups", requireAuth, async (req, res) => {
  const name = typeof req.body?.name === "string" ? req.body.name.trim() : "";
  const rawMembers = Array.isArray(req.body?.members) ? req.body.members : [];
  const members = Array.from(new Set([req.session.username!, ...rawMembers]
    .filter((value): value is string => typeof value === "string")
    .map((value) => value.trim())
    .filter(Boolean)));
  if (!name || name.length > 80) { res.status(400).json({ error: "Group name must be 1-80 characters" }); return; }
  if (members.length < 2 || members.length > 20) { res.status(400).json({ error: "Choose 1-19 other members" }); return; }
  const users = await db.select({ username: usersTable.username }).from(usersTable).where(inArray(usersTable.username, members));
  if (users.length !== members.length) { res.status(400).json({ error: "One or more members do not exist" }); return; }
  for (const member of members) {
    if (!(await canReceiveDMs(member))) { res.status(403).json({ error: `${member} does not accept DMs` }); return; }
  }
  const [group] = await db.insert(dmGroupsTable).values({ name, owner: req.session.username! }).returning();
  await db.insert(dmGroupMembersTable).values(members.map((username) => ({ groupId: group.id, username })));
  await audit("dm", "group-create", req.session.username!, String(group.id), name);
  res.json({ ...group, members });
});

router.get("/dms/groups/:id", requireAuth, async (req, res) => {
  const groupId = Number(req.params.id);
  if (!Number.isInteger(groupId) || !(await isGroupMember(groupId, req.session.username!))) {
    res.status(404).json({ error: "Group not found" }); return;
  }
  const [group] = await db.select().from(dmGroupsTable).where(eq(dmGroupsTable.id, groupId)).limit(1);
  if (!group) { res.status(404).json({ error: "Group not found" }); return; }
  const rows = await db.select().from(dmsTable).where(eq(dmsTable.groupId, groupId))
    .orderBy(desc(dmsTable.createdAt)).limit(200);
  res.json({ group, messages: rows.reverse() });
});

router.post("/dms/groups/:id", requireAuth, async (req, res) => {
  const groupId = Number(req.params.id);
  const me = req.session.username!;
  if (!Number.isInteger(groupId) || !(await isGroupMember(groupId, me))) {
    res.status(404).json({ error: "Group not found" }); return;
  }
  const body = typeof req.body?.body === "string" ? req.body.body.trim() : "";
  if (!body) { res.status(400).json({ error: "body required" }); return; }
  if (body.length > 1000) { res.status(413).json({ error: "Message too long" }); return; }
  if (await isBanned(me)) { res.status(403).json({ error: "You are banned." }); return; }
  const [row] = await db.insert(dmsTable).values({ fromUser: me, toUser: "", groupId, body }).returning();
  const members = await db.select({ username: dmGroupMembersTable.username })
    .from(dmGroupMembersTable).where(eq(dmGroupMembersTable.groupId, groupId));
  for (const member of members) {
    if (member.username !== me) {
      void sendPushToUser(member.username, {
        title: `New group message from ${me}`,
        body: body.slice(0, 140),
        tag: `dm-group:${groupId}`,
        url: "/",
      }).catch(() => {});
    }
  }
  await audit("dm", "group-send", me, String(groupId), body.slice(0, 200));
  res.json(row);
});

router.post("/dms/groups/:id/read", requireAuth, async (req, res) => {
  const groupId = Number(req.params.id);
  const me = req.session.username!;
  if (!Number.isInteger(groupId) || !(await isGroupMember(groupId, me))) {
    res.status(404).json({ error: "Group not found" }); return;
  }
  await db.update(dmsTable).set({ readAt: sql`NOW()` }).where(and(
    eq(dmsTable.groupId, groupId), sql`${dmsTable.fromUser} <> ${me}`, isNull(dmsTable.readAt),
  ));
  res.json({ ok: true });
});

router.post("/dms/reports", requireAuth, async (req, res) => {
  const me = req.session.username!;
  const messageId = Number(req.body?.messageId);
  const groupId = req.body?.groupId == null ? null : Number(req.body.groupId);
  const reason = typeof req.body?.reason === "string" ? req.body.reason.trim() : "";
  if (!reason || reason.length > 500) { res.status(400).json({ error: "Reason must be 1-500 characters" }); return; }
  if (!Number.isInteger(messageId) || messageId <= 0) { res.status(400).json({ error: "A message is required" }); return; }
  const [message] = await db.select().from(dmsTable).where(eq(dmsTable.id, messageId)).limit(1);
  if (!message) { res.status(404).json({ error: "Message not found" }); return; }
  const canAccess = message.groupId
    ? await isGroupMember(message.groupId, me)
    : (message.fromUser === me || message.toUser === me);
  if (!canAccess || (groupId !== null && message.groupId !== groupId)) {
    res.status(403).json({ error: "You cannot report this message" }); return;
  }
  const [existing] = await db.select({ id: dmReportsTable.id }).from(dmReportsTable).where(and(
    eq(dmReportsTable.messageId, messageId), eq(dmReportsTable.reporter, me), eq(dmReportsTable.status, "open"),
  )).limit(1);
  if (existing) { res.status(409).json({ error: "You already reported this message" }); return; }
  const [report] = await db.insert(dmReportsTable).values({
    reporter: me, messageId, groupId: message.groupId ?? null, reason,
  }).returning();
  await audit("dm", "report", me, message.fromUser || String(message.groupId || ""), reason);
  void notifyAdmins("DM report received", `${me}: ${reason.slice(0, 120)}`, `dm-report:${report.id}`);
  res.json(report);
});

router.get("/dms/admin/reports", requireAdmin, async (_req, res) => {
  const reports = await db.select().from(dmReportsTable).orderBy(desc(dmReportsTable.createdAt)).limit(200);
  const result = [];
  for (const report of reports) {
    const [message] = report.messageId
      ? await db.select().from(dmsTable).where(eq(dmsTable.id, report.messageId)).limit(1)
      : [];
    result.push({ ...report, message: message || null });
  }
  res.json(result);
});

router.patch("/dms/admin/reports/:id", requireAdmin, async (req, res) => {
  const id = Number(req.params.id);
  const status = req.body?.status;
  if (!Number.isInteger(id) || !["open", "reviewed", "dismissed"].includes(status)) {
    res.status(400).json({ error: "Invalid report status" }); return;
  }
  const [updated] = await db.update(dmReportsTable).set({
    status, reviewedBy: req.session.username!, reviewedAt: new Date(),
  }).where(eq(dmReportsTable.id, id)).returning();
  if (!updated) { res.status(404).json({ error: "Report not found" }); return; }
  await audit("dm", `report-${status}`, req.session.username!, String(id), "");
  res.json(updated);
});

router.delete("/dms/admin/messages/:id", requireAdmin, async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) { res.status(400).json({ error: "bad id" }); return; }
  const [message] = await db.select().from(dmsTable).where(eq(dmsTable.id, id)).limit(1);
  if (!message) { res.status(404).json({ error: "Message not found" }); return; }
  await db.delete(dmsTable).where(eq(dmsTable.id, id));
  await audit("dm", "admin-delete-message", req.session.username!, message.fromUser, message.body.slice(0, 200));
  res.json({ ok: true });
});

router.get("/dms/:other", requireAuth, async (req, res) => {
  const me = req.session.username!;
  const other = String(req.params.other);
  const rows = await db.select().from(dmsTable).where(
    and(
      isNull(dmsTable.groupId),
      or(
        and(eq(dmsTable.fromUser, me), eq(dmsTable.toUser, other)),
        and(eq(dmsTable.fromUser, other), eq(dmsTable.toUser, me)),
      ),
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
      isNull(dmsTable.groupId),
      eq(dmsTable.toUser, me),
      eq(dmsTable.fromUser, other),
      isNull(dmsTable.readAt),
    ));
  res.json({ ok: true });
});

router.get("/dms", requireAuth, async (req, res) => {
  const me = req.session.username!;
  const rows = await db.select().from(dmsTable).where(and(
    isNull(dmsTable.groupId),
    or(eq(dmsTable.fromUser, me), eq(dmsTable.toUser, me)),
  )).orderBy(desc(dmsTable.createdAt)).limit(500);
  const partners = new Map<string, { kind: "direct"; partner: string; lastBody: string; lastAt: string; unread: number }>();
  for (const r of rows) {
    const partner = r.fromUser === me ? r.toUser : r.fromUser;
    if (!partners.has(partner)) {
      partners.set(partner, { kind: "direct", partner, lastBody: r.body, lastAt: r.createdAt as any, unread: 0 });
    }
    if (r.toUser === me && !r.readAt) partners.get(partner)!.unread++;
  }
  const memberships = await db.select({ groupId: dmGroupMembersTable.groupId })
    .from(dmGroupMembersTable).where(eq(dmGroupMembersTable.username, me));
  const groupConversations: any[] = [];
  for (const membership of memberships) {
    const [group] = await db.select().from(dmGroupsTable)
      .where(eq(dmGroupsTable.id, membership.groupId)).limit(1);
    if (!group) continue;
    const groupRows = await db.select().from(dmsTable)
      .where(eq(dmsTable.groupId, group.id))
      .orderBy(desc(dmsTable.createdAt)).limit(200);
    const latest = groupRows[0];
    groupConversations.push({
      kind: "group",
      partner: `group:${group.id}`,
      groupId: group.id,
      groupName: group.name,
      members: (await db.select({ username: dmGroupMembersTable.username })
        .from(dmGroupMembersTable).where(eq(dmGroupMembersTable.groupId, group.id))).map((m) => m.username),
      lastBody: latest?.body || "",
      lastAt: latest?.createdAt || group.createdAt,
      unread: groupRows.filter((row) => row.fromUser !== me && !row.readAt).length,
    });
  }
  res.json([...partners.values(), ...groupConversations]
    .sort((a, b) => new Date(b.lastAt).getTime() - new Date(a.lastAt).getTime()));
});

export default router;
