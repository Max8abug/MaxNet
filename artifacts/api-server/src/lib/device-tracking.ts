import { createHash, randomBytes } from "node:crypto";
import type { Request, Response, RequestHandler } from "express";
import { and, desc, eq, inArray } from "drizzle-orm";
import {
  db,
  deviceAppealsTable,
  deviceAssociationsTable,
  deviceTokensTable,
  usersTable,
} from "@workspace/db";

const DEVICE_COOKIE = "pd_device";
const DEVICE_MAX_AGE_SECONDS = 60 * 60 * 24 * 365;
const VALID_DEVICE_TOKEN = /^[A-Za-z0-9_-]{43}$/;
const cookieSecure = process.env["COOKIE_SECURE"] === "true";

function parseCookieHeader(header: string | undefined): Record<string, string> {
  const cookies: Record<string, string> = {};
  for (const part of (header || "").split(";")) {
    const separator = part.indexOf("=");
    if (separator < 0) continue;
    const key = part.slice(0, separator).trim();
    const value = part.slice(separator + 1).trim();
    if (!key) continue;
    try { cookies[key] = decodeURIComponent(value); } catch { /* ignore malformed cookie */ }
  }
  return cookies;
}

function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export function getDeviceToken(req: Request): string | null {
  const token = parseCookieHeader(req.headers.cookie).pd_device;
  return token && VALID_DEVICE_TOKEN.test(token) ? token : null;
}

export const ensureDeviceCookie: RequestHandler = (req, res, next) => {
  const existing = getDeviceToken(req);
  if (!existing) {
    const token = randomBytes(32).toString("base64url");
    const attributes = [
      `${DEVICE_COOKIE}=${encodeURIComponent(token)}`,
      "Path=/",
      `Max-Age=${DEVICE_MAX_AGE_SECONDS}`,
      "HttpOnly",
      "SameSite=Lax",
    ];
    if (cookieSecure) attributes.push("Secure");
    res.append("Set-Cookie", attributes.join("; "));
    // Downstream auth handlers associate the device from the request cookie.
    // Make a cookie issued on this request visible to those handlers too, so
    // a first login after clearing browser cookies is tracked immediately.
    req.headers.cookie = [req.headers.cookie, `${DEVICE_COOKIE}=${encodeURIComponent(token)}`]
      .filter(Boolean)
      .join("; ");
  }
  next();
};

async function ensureDeviceRow(token: string): Promise<number> {
  const tokenHash = hashToken(token);
  const [existing] = await db
    .select({ id: deviceTokensTable.id })
    .from(deviceTokensTable)
    .where(eq(deviceTokensTable.tokenHash, tokenHash))
    .limit(1);
  if (existing) {
    await db.update(deviceTokensTable)
      .set({ lastSeen: new Date() })
      .where(eq(deviceTokensTable.id, existing.id));
    return existing.id;
  }
  const [created] = await db.insert(deviceTokensTable)
    .values({ tokenHash })
    .returning({ id: deviceTokensTable.id });
  return created.id;
}

export async function recordDeviceAssociation(req: Request, userId: number, username: string): Promise<void> {
  const token = getDeviceToken(req);
  if (!token || !userId || !username) return;
  try {
    const deviceTokenId = await ensureDeviceRow(token);
    await db.insert(deviceAssociationsTable)
      .values({ deviceTokenId, userId, username })
      .onConflictDoNothing();
    await db.update(deviceAssociationsTable)
      .set({ username, lastSeen: new Date() })
      .where(and(
        eq(deviceAssociationsTable.deviceTokenId, deviceTokenId),
        eq(deviceAssociationsTable.userId, userId),
      ));
  } catch {
    // Device signals must never make a successful login fail.
  }
}

export async function getDeviceReview(req: Request, userId: number) {
  const token = getDeviceToken(req);
  if (!token || !userId) return null;
  const tokenHash = hashToken(token);
  const [device] = await db.select({
    id: deviceTokensTable.id,
    status: deviceTokensTable.status,
    reason: deviceTokensTable.reason,
  }).from(deviceTokensTable)
    .innerJoin(deviceAssociationsTable, eq(deviceAssociationsTable.deviceTokenId, deviceTokensTable.id))
    .where(and(
      eq(deviceTokensTable.tokenHash, tokenHash),
      eq(deviceAssociationsTable.userId, userId),
    ))
    .orderBy(desc(deviceAssociationsTable.lastSeen))
    .limit(1);
  if (!device || (device.status !== "flagged" && device.status !== "blocked")) return null;

  const [appeal] = await db.select({
    id: deviceAppealsTable.id,
    status: deviceAppealsTable.status,
    message: deviceAppealsTable.message,
    adminResponse: deviceAppealsTable.adminResponse,
    createdAt: deviceAppealsTable.createdAt,
    reviewedAt: deviceAppealsTable.reviewedAt,
  }).from(deviceAppealsTable)
    .where(and(
      eq(deviceAppealsTable.deviceTokenId, device.id),
      eq(deviceAppealsTable.userId, userId),
    ))
    .orderBy(desc(deviceAppealsTable.createdAt))
    .limit(1);

  return {
    deviceId: device.id,
    status: device.status,
    reason: device.reason,
    appeal: appeal || null,
  };
}

export async function flagDevicesForUser(userId: number, actor: string, reason: string): Promise<number> {
  if (!userId) return 0;
  const associations = await db.select({ deviceTokenId: deviceAssociationsTable.deviceTokenId })
    .from(deviceAssociationsTable)
    .where(eq(deviceAssociationsTable.userId, userId));
  const ids = Array.from(new Set(associations.map((row) => row.deviceTokenId)));
  if (ids.length === 0) return 0;
  await db.update(deviceTokensTable).set({
    status: "flagged",
    reason: reason.slice(0, 240),
    flaggedBy: actor,
    reviewedAt: null,
    reviewedBy: null,
  }).where(inArray(deviceTokensTable.id, ids));
  return ids.length;
}

export async function flagDevicesForUsername(username: string, actor: string, reason: string): Promise<number> {
  const [user] = await db.select({ id: usersTable.id })
    .from(usersTable)
    .where(eq(usersTable.username, username))
    .limit(1);
  if (!user) return 0;
  return flagDevicesForUser(user.id, actor, reason);
}

export async function getDeviceIdForRequest(req: Request): Promise<number | null> {
  const token = getDeviceToken(req);
  if (!token) return null;
  const [row] = await db.select({ id: deviceTokensTable.id })
    .from(deviceTokensTable)
    .where(eq(deviceTokensTable.tokenHash, hashToken(token)))
    .limit(1);
  return row?.id ?? null;
}