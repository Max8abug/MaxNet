import * as schema from "@workspace/db";
import { db } from "@workspace/db";
import { sql } from "drizzle-orm";
import { storageScope } from "./app-storage";
import { readBackupFile } from "./backup-files";
import { BACKUP_LOCK } from "./storage-mutations";

// Parents precede children for restore. Sessions are deliberately excluded.
const definitions = [
  ["users", "usersTable"], ["ranks", "ranksTable"],
  ["site_settings", "siteSettingsTable"], ["user_pages", "userPagesTable"],
  ["banned_users", "bannedUsersTable"], ["user_ips", "userIpsTable"],
  ["ip_bans", "ipBansTable"], ["device_tokens", "deviceTokensTable"],
  ["device_associations", "deviceAssociationsTable"], ["device_appeals", "deviceAppealsTable"],
  ["drawings", "drawingsTable"], ["chat_messages", "chatMessagesTable"],
  ["guestbook_entries", "guestbookTable"], ["photos", "photosTable"],
  ["news_posts", "newsPostsTable"], ["news_comments", "newsCommentsTable"],
  ["polls", "pollsTable"], ["tracks", "tracksTable"], ["dms", "dmsTable"],
  ["chess_lobbies", "chessLobbiesTable"], ["cafe_settings", "cafeSettingsTable"],
  ["cafe_rooms", "cafeRoomsTable"], ["cafe_objects", "cafeObjectsTable"],
  ["cafe_presence", "cafePresenceTable"], ["cafe_chat", "cafeChatTable"],
  ["forum_threads", "forumThreadsTable"], ["forum_posts", "forumPostsTable"],
  ["youtube_sync", "youtubeSyncTable"], ["blackjack_tables", "blackjackTablesTable"],
  ["flappy_players", "flappyPlayersTable"], ["flappy_scores", "flappyScoresTable"],
  ["visit_counter", "visitCounterTable"], ["chat_audit_log", "chatAuditTable"],
  ["wiki_pages", "wikiPagesTable"], ["wiki_assets", "wikiAssetsTable"],
  ["hosted_sites", "hostedSitesTable"], ["hosted_site_files", "hostedSiteFilesTable"],
] as const;
export const TABLES = definitions.map(([name, table]) => ({
  name, pgName: name, table: schema[table] as any,
}));
export const EXCLUDED = [
  "login sessions", "unreferenced storage objects", "storage cleanup queue",
  "server configuration and secrets", "external URL resources",
  "unlisted database tables (including push subscriptions and Expo push tokens)",
];

// No schema repair, cleanup, authentication or session operations here. Every
// required table and referenced byte must be readable or the entire export fails.
export async function exportSiteBackup(write: (chunk: string) => Promise<void>) {
  const counts: Record<string, number> = {};
  let fileCount = 0;
  let fileBytes = 0;
  await db.transaction(async tx => {
    await tx.execute(sql`SET LOCAL lock_timeout = '30s'`);
    await tx.execute(sql`SELECT pg_advisory_xact_lock(${BACKUP_LOCK}, 0)`);
    await tx.execute(sql.raw(`LOCK TABLE ${TABLES.map(t => `"${t.pgName}"`).join(", ")} IN SHARE MODE`));
    const fileRefs = new Map<string, number>();
    await write(`{"version":2,"exportedAt":${JSON.stringify(new Date().toISOString())},"storageBackend":${JSON.stringify(storageScope().startsWith("local:") ? "local" : "replit")},"tables":{`);
    for (const [index, t] of TABLES.entries()) {
      if (index) await write(",");
      await write(`${JSON.stringify(t.name)}:[`);
      let rows: any[];
      try {
        rows = await tx.select().from(t.table);
      } catch (error: any) {
        throw new Error(`Cannot back up ${t.name}: ${error?.message || "select failed"}`);
      }
      counts[t.name] = rows.length;
      for (const [rowIndex, row] of rows.entries()) {
        if (t.name === "wiki_assets" || t.name === "hosted_site_files") {
          if (typeof row.objectKey !== "string" || !row.objectKey ||
              !Number.isSafeInteger(row.size) || row.size < 0) throw new Error("Invalid storage reference.");
          if (fileRefs.has(row.objectKey) && fileRefs.get(row.objectKey) !== row.size) throw new Error("Conflicting storage sizes.");
          fileRefs.set(row.objectKey, row.size);
        }
        if (rowIndex) await write(",");
        await write(JSON.stringify(row));
      }
      await write("]");
    }
    await write('},"files":[');
    for (const [key, size] of fileRefs) {
      const file = await readBackupFile(key, size);
      if (fileCount) await write(",");
      await write(JSON.stringify(file));
      fileCount++;
      fileBytes += size;
    }
    await write(`],"complete":true,"excluded":${JSON.stringify(EXCLUDED)}}`);
  }, { isolationLevel: "read committed" });
  return { counts, fileCount, fileBytes };
}
