import type { Request } from "express";
import { db, userIpsTable, ipBansTable } from "@workspace/db";
import { and, eq, sql } from "drizzle-orm";

// Normalize Express's req.ip into a canonical form. Express trust-proxy is
// already set in app.ts so this gives us the real client IP, but IPv6 addresses
// commonly arrive as the IPv4-mapped form "::ffff:1.2.3.4" — strip that prefix
// so admin views show the friendlier IPv4 address and so IP bans match.
export function getClientIp(req: Request): string {
  let ip = (req.ip || (req.socket && req.socket.remoteAddress) || "").toString();
  if (ip.startsWith("::ffff:")) ip = ip.slice("::ffff:".length);
  if (ip === "::1") ip = "127.0.0.1";
  return ip;
}

// Upsert a (username, ip) sighting. Cheap and idempotent: bumps hits + lastSeen
// on every login, inserts a new row only the first time we see that pairing.
export async function recordUserIp(username: string, ip: string): Promise<void> {
  if (!username || !ip) return;
  try {
    await db.insert(userIpsTable).values({ username, ip }).onConflictDoNothing();
  } catch {
    // Older deploys may not have a unique constraint — fall through to the
    // update path below which is also safe to run.
  }
  // Bump lastSeen + hits whether the row already existed or was just inserted.
  try {
    await db.execute(sql`
      UPDATE user_ips
      SET last_seen = NOW(), hits = hits + 1
      WHERE username = ${username} AND ip = ${ip}
    `);
  } catch {
    // Don't let IP tracking failures break the auth path.
  }
}

export async function isIpBanned(ip: string): Promise<boolean> {
  if (!ip) return false;
  const [row] = await db.select().from(ipBansTable).where(eq(ipBansTable.ip, ip)).limit(1);
  return !!row;
}

// Returns the username records sharing each provided IP. Useful for the
// "scan IPs" lookup — given the list of IPs we've seen for user X, find every
// other username that also logged in from any of those IPs (those are alts).
export async function findAltsForIps(ip: string, excludeUsername: string) {
  const rows = await db
    .select()
    .from(userIpsTable)
    .where(and(eq(userIpsTable.ip, ip)));
  return rows.filter((r) => r.username !== excludeUsername);
}
