import { Router, type IRouter } from "express";
import { db, dmsTable, usersTable } from "@workspace/db";
import { and, eq, or, desc, isNull, sql } from "drizzle-orm";
import { requireAuth, isAdminUsername } from "../lib/auth";
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
  const rows = await db.select().from(dmsTable).where(or(eq(dmsTable.fromUser, me), eq(dmsTable.toUser, me))).orderBy(desc(dmsTable.createdAt)).limit(500);
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
