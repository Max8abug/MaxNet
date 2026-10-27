import { createHash, randomBytes } from "node:crypto";
import { and, eq, gt, lt, or } from "drizzle-orm";
import { Router, type IRouter } from "express";
import { db, bannedUsersTable, maxosSyncCodesTable, siteSettingsTable, usersTable } from "@workspace/db";
import { cleanArchivedFeatures } from "@workspace/feature-registry";
import {
  CreateMaxOsSetupRequestBody,
  CreateMaxOsSetupRequestResponse,
  RedeemMaxOsSetupCodeBody,
  RedeemMaxOsSetupCodeResponse,
} from "@workspace/api-zod";
import { getDeviceReview } from "../lib/device-tracking";
import { getUserPermissions } from "./ranks";

const router: IRouter = Router();
const CODE_TTL_MS = 3 * 60 * 1000;
const DISPLAY_THEMES = new Set([
  "classic-light", "classic-dark", "xp-light", "xp-dark",
  "vista", "vista-dark", "gold", "silver",
]);

// MaxOS launchers follow the MaxNet site's published launcher availability.
// Site permissions remain MaxNet-only and never grant Linux administrator rights.
const MAXOS_APP_ARCHIVE_LINKS: Record<string, readonly string[]> = {
  home: [],
  signin: [],
  chat: ["chat"],
  forum: ["forum"],
  dms: ["dms"],
  network: [],
  "network-people": ["userlist"],
  "network-wiki": [],
  gallery: ["sharedphotos"],
  users: ["userlist"],
  visits: ["visits"],
  guestbook: ["guestbook"],
  planner: ["planner"],
  news: ["news"],
  games: [
    "chess", "blackjack", "flappy", "geometry", "poker", "eaglercraft",
    "newcp", "terraria", "gettingoverit", "pvz", "webfishing", "undertale",
  ],
  eaglercraft: ["eaglercraft"],
  mypage: ["mypage"],
  youtube: ["youtube"],
  polls: ["polls"],
  music: ["music"],
  playlists: ["personalplaylists"],
  drawing: ["drawing"],
  settings: [],
};

function hash(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

router.post("/os/setup/request", async (req, res, next): Promise<void> => {
  try {
    if (!req.session.userId) {
      res.status(401).json({ error: "Sign in to MaxNet before syncing MaxOS." });
      return;
    }
    const parsed = CreateMaxOsSetupRequestBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.message });
      return;
    }
    const { state } = parsed.data;

    const [user] = await db.select({
      username: usersTable.username,
      isAdmin: usersTable.isAdmin,
      rank: usersTable.rank,
      backgroundUrl: usersTable.backgroundUrl,
      darkBackgroundUrl: usersTable.darkBackgroundUrl,
      backgroundColor: usersTable.backgroundColor,
      timeZone: usersTable.timeZone,
      displayTheme: usersTable.displayTheme,
    }).from(usersTable).where(eq(usersTable.id, req.session.userId)).limit(1);
    if (!user) {
      res.status(401).json({ error: "Your MaxNet session has expired. Sign in again." });
      return;
    }
    if (!user.isAdmin) {
      const [accountBan] = await db.select({ id: bannedUsersTable.id })
        .from(bannedUsersTable)
        .where(eq(bannedUsersTable.username, user.username))
        .limit(1);
      const deviceReview = await getDeviceReview(req, req.session.userId);
      if (accountBan || deviceReview) {
        req.session.destroy(() => {});
        res.status(403).json({ error: "This MaxNet account cannot sync settings right now." });
        return;
      }
    }

    const [siteSettings] = await db.select({ archivedFeatures: siteSettingsTable.archivedFeatures })
      .from(siteSettingsTable).limit(1);
    const archived = new Set<string>(cleanArchivedFeatures(siteSettings?.archivedFeatures));
    const apps = Object.entries(MAXOS_APP_ARCHIVE_LINKS)
      .filter(([, archiveIds]) => archiveIds.length === 0 || archiveIds.some((id) => !archived.has(id)))
      .map(([id]) => id);

    const theme = typeof user.displayTheme === "string" && DISPLAY_THEMES.has(user.displayTheme)
      ? user.displayTheme
      : null;
    const payload = {
      version: 1,
      username: user.username,
      rank: user.rank,
      isMaxNetAdmin: user.isAdmin,
      permissions: await getUserPermissions(user.username),
      appearance: {
        displayTheme: theme,
        backgroundUrl: user.backgroundUrl,
        darkBackgroundUrl: user.darkBackgroundUrl,
        backgroundColor: user.backgroundColor,
        timeZone: user.timeZone,
      },
      apps,
      archivedFeatures: [...archived],
      issuedAt: new Date().toISOString(),
    };

    const now = new Date();
    await db.delete(maxosSyncCodesTable).where(or(
      lt(maxosSyncCodesTable.expiresAt, now),
      eq(maxosSyncCodesTable.stateHash, hash(state)),
    ));
    const code = randomBytes(32).toString("base64url");
    await db.insert(maxosSyncCodesTable).values({
      codeHash: hash(code),
      stateHash: hash(state),
      payload,
      expiresAt: new Date(now.getTime() + CODE_TTL_MS),
    });
    res.setHeader("Cache-Control", "no-store");
    res.json(CreateMaxOsSetupRequestResponse.parse({
      code,
      expiresAt: new Date(now.getTime() + CODE_TTL_MS),
    }));
  } catch (error) {
    next(error);
  }
});

router.post("/os/setup/redeem", async (req, res, next): Promise<void> => {
  try {
    const parsed = RedeemMaxOsSetupCodeBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.message });
      return;
    }
    const { code, state } = parsed.data;

    const [record] = await db.delete(maxosSyncCodesTable)
      .where(and(
        eq(maxosSyncCodesTable.codeHash, hash(code)),
        eq(maxosSyncCodesTable.stateHash, hash(state)),
        gt(maxosSyncCodesTable.expiresAt, new Date()),
      ))
      .returning({ payload: maxosSyncCodesTable.payload });
    if (!record) {
      res.status(410).json({ error: "This MaxOS sync request expired or was already used. Start setup again." });
      return;
    }

    res.setHeader("Cache-Control", "no-store");
    res.json(RedeemMaxOsSetupCodeResponse.parse(record.payload));
  } catch (error) {
    next(error);
  }
});

export default router;
