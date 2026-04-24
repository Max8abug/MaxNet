import { Router, type IRouter } from "express";
import { db, userIpsTable, ipBansTable, chatAuditTable, bannedUsersTable } from "@workspace/db";
import { desc, eq, inArray } from "drizzle-orm";
import { requireAdmin, isAdminUsername } from "../lib/auth";

const router: IRouter = Router();

// Look up everything we know about a user's IP history, including which other
// usernames have logged in from those same IPs (likely alts) and whether each
// IP is currently banned.
router.get("/users/:username/ips", requireAdmin, async (req, res) => {
  const username = String(req.params.username || "").trim();
  if (!username) { res.status(400).json({ error: "username required" }); return; }

  const ipsForUser = await db
    .select()
    .from(userIpsTable)
    .where(eq(userIpsTable.username, username))
    .orderBy(desc(userIpsTable.lastSeen));

  const ipList = ipsForUser.map((r) => r.ip);
  const altRows = ipList.length > 0
    ? await db.select().from(userIpsTable).where(inArray(userIpsTable.ip, ipList))
    : [];
  const banRows = ipList.length > 0
    ? await db.select().from(ipBansTable).where(inArray(ipBansTable.ip, ipList))
    : [];
  const bannedSet = new Set(banRows.map((b) => b.ip));

  // Group alts (other usernames) by IP.
  const altsByIp: Record<string, { username: string; firstSeen: Date; lastSeen: Date; hits: number }[]> = {};
  for (const r of altRows) {
    if (r.username === username) continue;
    if (!altsByIp[r.ip]) altsByIp[r.ip] = [];
    altsByIp[r.ip]!.push({ username: r.username, firstSeen: r.firstSeen, lastSeen: r.lastSeen, hits: r.hits });
  }

  res.json({
    username,
    ips: ipsForUser.map((r) => ({
      ip: r.ip,
      firstSeen: r.firstSeen,
      lastSeen: r.lastSeen,
      hits: r.hits,
      banned: bannedSet.has(r.ip),
      alts: (altsByIp[r.ip] || []).sort((a, b) => +new Date(b.lastSeen) - +new Date(a.lastSeen)),
    })),
  });
});

router.get("/ip-bans", requireAdmin, async (_req, res) => {
  const rows = await db.select().from(ipBansTable).orderBy(desc(ipBansTable.createdAt));
  res.json(rows);
});

router.post("/ip-bans", requireAdmin, async (req, res) => {
  const ip = String(req.body?.ip || "").trim();
  const reason = String(req.body?.reason || "");
  if (!ip) { res.status(400).json({ error: "ip required" }); return; }
  const actor = req.session.username || "admin";
  try {
    await db.insert(ipBansTable).values({ ip, bannedBy: actor, reason }).onConflictDoNothing();
    await db.insert(chatAuditTable).values({ area: "ipban", action: "add", actor, target: ip, body: reason });
    res.json({ ok: true });
  } catch (e: any) {
    res.status(500).json({ error: e?.message || "Failed to ban IP" });
  }
});

// One-click "ban this account": ban the username AND ban every IP we've ever
// seen for them. Used from the IP scan view so admins don't have to ban each
// IP individually after spotting an alt-ring.
router.post("/users/:username/ban-everything", requireAdmin, async (req, res) => {
  const username = String(req.params.username || "").trim();
  if (!username) { res.status(400).json({ error: "username required" }); return; }
  if (isAdminUsername(username)) { res.status(400).json({ error: "Cannot ban the site owner." }); return; }

  const actor = req.session.username || "admin";
  const reason = String((req.body && (req.body as any).reason) || "").slice(0, 200);

  try {
    await db.insert(bannedUsersTable).values({ username, bannedBy: actor, reason }).onConflictDoNothing();
  } catch {
    // Already banned — that's fine, keep going so we still cover the IPs.
  }

  const ipRows = await db
    .select({ ip: userIpsTable.ip })
    .from(userIpsTable)
    .where(eq(userIpsTable.username, username));
  const uniqueIps = Array.from(new Set(ipRows.map((r) => r.ip).filter(Boolean)));

  let bannedIps = 0;
  for (const ip of uniqueIps) {
    try {
      const inserted = await db
        .insert(ipBansTable)
        .values({ ip, bannedBy: actor, reason: reason || `auto: banned with account ${username}` })
        .onConflictDoNothing()
        .returning({ ip: ipBansTable.ip });
      if (inserted.length > 0) bannedIps += 1;
    } catch {
      // Skip — most likely a race on the unique index.
    }
  }

  await db.insert(chatAuditTable).values({
    area: "ipban",
    action: "ban-everything",
    actor,
    target: username,
    body: `account+${bannedIps}/${uniqueIps.length} ips${reason ? `: ${reason}` : ""}`,
  });

  res.json({ ok: true, username, bannedIps, totalIps: uniqueIps.length });
});

router.delete("/ip-bans/:ip", requireAdmin, async (req, res) => {
  const ip = String(req.params.ip || "").trim();
  if (!ip) { res.status(400).json({ error: "ip required" }); return; }
  const actor = req.session.username || "admin";
  await db.delete(ipBansTable).where(eq(ipBansTable.ip, ip));
  await db.insert(chatAuditTable).values({ area: "ipban", action: "remove", actor, target: ip, body: "" });
  res.json({ ok: true });
});

export default router;
