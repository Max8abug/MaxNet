import { pool } from "@workspace/db";
import { logger } from "./logger";

const BOT = "SladenatorEatsOfficial";
const TAGS = "#sladenator #ai #slop";
const POLL_MS = 5 * 60_000;
const DAY_MS = 24 * 60 * 60_000;
const WEEK_MS = 7 * DAY_MS;
const GALLERY_API = "https://sladenator.org/api/photos";

const runtimeStatus = {
  schedulerActive: false,
  checking: false,
  startedAt: null as string | null,
  lastCheckAt: null as string | null,
  lastSuccessfulCheckAt: null as string | null,
  lastError: null as string | null,
};

export function getNetworkBotStatus() {
  return { ...runtimeStatus };
}

type SourcePhoto = { url: string; uploadedAt?: string };

async function getGallery(): Promise<SourcePhoto[]> {
  const response = await fetch(GALLERY_API, {
    headers: { Accept: "application/json", "User-Agent": "Portfolio98-NetworkBot/1.0" },
    signal: AbortSignal.timeout(10_000),
    redirect: "error",
  });
  if (!response.ok || !(response.headers.get("content-type") || "").includes("application/json")) {
    throw new Error(`Photo collection request failed (${response.status}).`);
  }
  const body = await response.text();
  if (body.length > 2_000_000) throw new Error("Photo collection response exceeded 2 MB.");
  const data: unknown = JSON.parse(body);
  if (!Array.isArray(data)) throw new Error("Photo collection response is not a list.");
  const photos = new Map<string, SourcePhoto>();
  for (const entry of data) {
    if (!entry || typeof entry !== "object" || !("url" in entry) || typeof entry.url !== "string") continue;
    try {
      const url = new URL(entry.url, "https://sladenator.org");
      if (url.protocol !== "https:" || url.hostname !== "sladenator.org"
        || !url.pathname.startsWith("/photos/")
        || !/\.(?:jpe?g|png|gif|webp|avif)$/i.test(url.pathname)) continue;
      photos.set(url.href, {
        url: url.href,
        uploadedAt: "uploadedAt" in entry && typeof entry.uploadedAt === "string" ? entry.uploadedAt : undefined,
      });
    } catch { /* Ignore malformed gallery entries. */ }
  }
  return [...photos.values()];
}

function randomDailyDelay(): number {
  // Vary the daily post time while keeping the cadence close to once per day.
  return (20 + Math.random() * 8) * 60 * 60_000;
}

async function publishPhoto(url: string, mode: "unique" | "backlog" | "repeat" = "unique"): Promise<boolean> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    if (mode === "backlog") {
      await client.query(`
        UPDATE network_bot_schedule
        SET backlog_day = CURRENT_DATE, backlog_daily_target = 3 + floor(random() * 3)::int, backlog_posted_today = 0
        WHERE id = 1 AND backlog_day <> CURRENT_DATE
      `);
      const dailyLimit = await client.query<{ backlog_daily_target: number; backlog_posted_today: number }>(
        "SELECT backlog_daily_target, backlog_posted_today FROM network_bot_schedule WHERE id = 1 FOR UPDATE",
      );
      const quota = dailyLimit.rows[0];
      if (!quota || quota.backlog_posted_today >= quota.backlog_daily_target) {
        await client.query("ROLLBACK");
        return false;
      }
    }
    const row = await client.query<{ posted_at: Date | null; is_new: boolean }>(
      "SELECT posted_at, is_new FROM network_bot_photos WHERE source_url = $1 FOR UPDATE", [url],
    );
    if (!row.rows[0] || (row.rows[0].posted_at && mode !== "repeat")) {
      await client.query("ROLLBACK");
      return false;
    }
    await client.query(
      "INSERT INTO social_posts (author, body, external_media_url, media_type) VALUES ($1, $2, $3, 'image')",
      [BOT, row.rows[0].is_new ? `${TAGS} #new` : TAGS, url],
    );
    await client.query("UPDATE network_bot_photos SET posted_at = now() WHERE source_url = $1", [url]);
    if (mode === "backlog") {
      await client.query("UPDATE network_bot_schedule SET backlog_posted_today = backlog_posted_today + 1 WHERE id = 1");
    }
    await client.query("COMMIT");
    logger.info({ sourceUrl: url }, "Network bot published a source photo");
    return true;
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

async function pollAndPost(): Promise<void> {
  const photos = await getGallery();
  const photoUrls = photos.map((photo) => photo.url);
  const uploadTimes = photos.map((photo) => photo.uploadedAt && Number.isFinite(Date.parse(photo.uploadedAt))
    ? new Date(photo.uploadedAt) : null);
  const rolloutTimes = photos.map(() => new Date(Date.now() + Math.random() * WEEK_MS));
  const client = await pool.connect();
  let initialized = false;
  try {
    await client.query("BEGIN");
    const inserted = await client.query(`
      INSERT INTO network_bot_schedule (id, initialized_at, last_new_photo_at, rollout_ends_at, next_random_post_at)
      VALUES (1, now(), now(), now() + interval '7 days', now() + interval '7 days' + ($1 * interval '1 millisecond'))
      ON CONFLICT (id) DO NOTHING RETURNING id
    `, [Math.random() * DAY_MS]);
    initialized = Boolean(inserted.rowCount);
    if (initialized && photos.length) {
      await client.query(`
        INSERT INTO network_bot_photos (source_url, source_uploaded_at, scheduled_at)
        SELECT source_url, uploaded_at, scheduled_at
        FROM unnest($1::text[], $2::timestamptz[], $3::timestamptz[]) AS gallery(source_url, uploaded_at, scheduled_at)
        ON CONFLICT DO NOTHING
      `, [photoUrls, uploadTimes, rolloutTimes]);
    }
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
  if (initialized) {
    logger.info({ photos: photos.length }, "Network bot initialized its one-week photo rollout");
    return;
  }

  const added = photos.length ? await pool.query<{ source_url: string }>(`
    INSERT INTO network_bot_photos (source_url, source_uploaded_at, is_new)
    SELECT source_url, uploaded_at, true FROM unnest($1::text[], $2::timestamptz[]) AS gallery(source_url, uploaded_at)
    ON CONFLICT DO NOTHING RETURNING source_url
  `, [photoUrls, uploadTimes]) : { rows: [] };
  const newPhotos = added.rows.map((row) => row.source_url);
  if (newPhotos.length) {
    await pool.query("UPDATE network_bot_schedule SET last_new_photo_at = now() WHERE id = 1");
  }
  const pendingNew = await pool.query<{ source_url: string }>(
    "SELECT source_url FROM network_bot_photos WHERE is_new = true AND posted_at IS NULL ORDER BY first_seen_at",
  );
  for (const photo of pendingNew.rows) await publishPhoto(photo.source_url);
  const dueRollout = await pool.query<{ source_url: string }>(
    "SELECT source_url FROM network_bot_photos WHERE is_new = false AND posted_at IS NULL AND scheduled_at <= now() ORDER BY random() LIMIT 5",
  );
  for (const photo of dueRollout.rows) await publishPhoto(photo.source_url, "backlog");

  const state = await pool.query<{
    rollout_ends_at: Date; last_new_photo_at: Date; next_random_post_at: Date;
  }>("SELECT rollout_ends_at, last_new_photo_at, next_random_post_at FROM network_bot_schedule WHERE id = 1");
  const schedule = state.rows[0];
  if (!schedule) return;
  const timestamp = Date.now();
  const rolloutActive = timestamp < schedule.rollout_ends_at.getTime();
  const quietForAWeek = timestamp - schedule.last_new_photo_at.getTime() >= WEEK_MS;
  const backlog = await pool.query<{ count: number }>(
    "SELECT count(*)::int AS count FROM network_bot_photos WHERE is_new = false AND posted_at IS NULL",
  );
  if (Number(backlog.rows[0]?.count || 0) > 0) return;
  if (rolloutActive) return;
  if (!quietForAWeek) {
    if (timestamp >= schedule.next_random_post_at.getTime()) {
      await pool.query(
        "UPDATE network_bot_schedule SET next_random_post_at = last_new_photo_at + interval '7 days' + ($1 * interval '1 millisecond') WHERE id = 1",
        [Math.random() * DAY_MS],
      );
    }
    return;
  }
  if (timestamp < schedule.next_random_post_at.getTime()) return;

  const fallback = (await pool.query<{ source_url: string }>(
    "SELECT source_url FROM network_bot_photos WHERE is_new = false ORDER BY random() LIMIT 1",
  )).rows[0];
  if (fallback) await publishPhoto(fallback.source_url, "repeat");
  await pool.query(
    "UPDATE network_bot_schedule SET next_random_post_at = now() + ($1 * interval '1 millisecond') WHERE id = 1",
    [randomDailyDelay()],
  );
}

export function startNetworkBot(): void {
  let running = false;
  runtimeStatus.schedulerActive = true;
  runtimeStatus.startedAt = new Date().toISOString();
  const run = async () => {
    if (running) return;
    running = true;
    runtimeStatus.checking = true;
    runtimeStatus.lastCheckAt = new Date().toISOString();
    try {
      await pollAndPost();
      runtimeStatus.lastSuccessfulCheckAt = new Date().toISOString();
      runtimeStatus.lastError = null;
    } catch (error) {
      runtimeStatus.lastError = error instanceof Error ? error.message.slice(0, 300) : "Photo check failed.";
      logger.warn({ err: error }, "Network bot photo check failed; it will retry");
    } finally {
      running = false;
      runtimeStatus.checking = false;
    }
  };
  void run();
  setInterval(() => void run(), POLL_MS).unref();
}
