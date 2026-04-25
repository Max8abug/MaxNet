import session from "express-session";
import connectPgSimple from "connect-pg-simple";
import bcrypt from "bcryptjs";
import { db, usersTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import type { RequestHandler } from "express";

const ADMIN_USERNAME = "Max8abug";

declare module "express-session" {
  interface SessionData {
    userId?: number;
    username?: string;
    isAdmin?: boolean;
  }
}

const PgSession = connectPgSimple(session);

const databaseUrl = process.env["DATABASE_URL"];
if (!databaseUrl) throw new Error("DATABASE_URL required");

const secret = process.env["SESSION_SECRET"] || "dev-insecure-secret";
const isProduction = process.env["NODE_ENV"] === "production";

export const sessionMiddleware: RequestHandler = session({
  store: new PgSession({
    conObject: { connectionString: databaseUrl },
    tableName: "session",
    // The session table is created idempotently by `ensureSchema()` at
    // startup (see lib/ensure-schema.ts). We deliberately do NOT use
    // connect-pg-simple's `createTableIfMissing` here: that option reads
    // the library's bundled `table.sql` from disk, but esbuild does not
    // copy that file into our `dist/` output, so the runtime fallback
    // crashes with ENOENT on every session write. The visible symptom
    // was logins appearing to succeed while the session row was never
    // persisted, which broke every auth-required route (drawing pad,
    // chat, etc.) with a 401 "Login required".
    createTableIfMissing: false,
  }),
  secret,
  resave: false,
  saveUninitialized: false,
  // In production we serve over HTTPS behind a reverse proxy, so the cookie
  // must be marked Secure or browsers will silently drop it on cross-site
  // requests. In development we run plain HTTP on localhost, so Secure must
  // be off or the browser refuses to store the cookie at all.
  cookie: {
    httpOnly: true,
    sameSite: "lax",
    secure: isProduction,
    maxAge: 1000 * 60 * 60 * 24 * 30,
  },
});

export async function hashPassword(plain: string): Promise<string> {
  return bcrypt.hash(plain, 10);
}

export async function verifyPassword(plain: string, hash: string): Promise<boolean> {
  return bcrypt.compare(plain, hash);
}

export function isAdminUsername(username: string): boolean {
  return username === ADMIN_USERNAME;
}

export const requireAuth: RequestHandler = (req, res, next) => {
  if (!req.session.userId) {
    res.status(401).json({ error: "Login required" });
    return;
  }
  next();
};

export const requireAdmin: RequestHandler = (req, res, next) => {
  if (!req.session.userId || !req.session.isAdmin) {
    res.status(403).json({ error: "Admin only" });
    return;
  }
  next();
};

export async function findUserByUsername(username: string) {
  const [u] = await db.select().from(usersTable).where(eq(usersTable.username, username)).limit(1);
  return u;
}
