import { pool } from "@workspace/db";
import { logger } from "./logger";

/**
 * Idempotent production-safe schema bootstrap.
 *
 * Why this exists:
 *   The user deploys by pushing to GitHub and then deploying. There is no
 *   `drizzle-kit push` step in that pipeline, so whenever a schema change
 *   ships in code without a corresponding DB migration, the production
 *   database falls behind and any route that touches the new
 *   table/column 500s with "relation does not exist" or "column does not
 *   exist". Before this bootstrap, that's exactly how /api/news started
 *   failing in prod after the news_posts table was added in code.
 *
 * What it does:
 *   Runs `CREATE TABLE IF NOT EXISTS` for every Drizzle-managed table and
 *   `ALTER TABLE ... ADD COLUMN IF NOT EXISTS` for columns that were added
 *   after a table's initial creation. Both forms are no-ops if the
 *   table/column is already there, so the script is safe to run on every
 *   server start, on a fresh DB, or on a stale prod DB.
 *
 * This file is the canonical place to add new tables/columns going
 * forward — keep it in sync with `lib/db/src/schema/social.ts` whenever
 * the schema changes.
 */
export async function ensureSchema(): Promise<void> {
  const sql = `
    CREATE TABLE IF NOT EXISTS users (
      id serial PRIMARY KEY,
      username text NOT NULL UNIQUE,
      password_hash text NOT NULL,
      is_admin boolean NOT NULL DEFAULT false,
      avatar_url text,
      background_url text,
      background_color text,
      rank text,
      cafe_avatar jsonb NOT NULL DEFAULT '{}'::jsonb,
      created_at timestamp NOT NULL DEFAULT now()
    );
    ALTER TABLE users ADD COLUMN IF NOT EXISTS cafe_avatar jsonb NOT NULL DEFAULT '{}'::jsonb;
    ALTER TABLE users ADD COLUMN IF NOT EXISTS rank text;
    ALTER TABLE users ADD COLUMN IF NOT EXISTS background_url text;
    ALTER TABLE users ADD COLUMN IF NOT EXISTS background_color text;
    ALTER TABLE users ADD COLUMN IF NOT EXISTS avatar_url text;

    CREATE TABLE IF NOT EXISTS drawings (
      id serial PRIMARY KEY,
      author text NOT NULL DEFAULT 'anon',
      data_url text NOT NULL,
      votes jsonb NOT NULL DEFAULT '{}'::jsonb,
      created_at timestamp NOT NULL DEFAULT now()
    );

    CREATE TABLE IF NOT EXISTS chat_messages (
      id serial PRIMARY KEY,
      author text NOT NULL DEFAULT 'anon',
      body text NOT NULL,
      image_url text,
      video_url text,
      reply_to integer,
      created_at timestamp NOT NULL DEFAULT now()
    );
    ALTER TABLE chat_messages ADD COLUMN IF NOT EXISTS image_url text;
    ALTER TABLE chat_messages ADD COLUMN IF NOT EXISTS video_url text;
    ALTER TABLE chat_messages ADD COLUMN IF NOT EXISTS reply_to integer;

    CREATE TABLE IF NOT EXISTS visit_counter (
      id serial PRIMARY KEY,
      count integer NOT NULL DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS ranks (
      id serial PRIMARY KEY,
      name text NOT NULL UNIQUE,
      color text NOT NULL DEFAULT '#888888',
      permissions jsonb NOT NULL DEFAULT '[]'::jsonb,
      tier integer NOT NULL DEFAULT 1,
      created_at timestamp NOT NULL DEFAULT now()
    );

    CREATE TABLE IF NOT EXISTS tracks (
      id serial PRIMARY KEY,
      uploader text NOT NULL,
      title text NOT NULL,
      data_url text NOT NULL,
      created_at timestamp NOT NULL DEFAULT now()
    );

    CREATE TABLE IF NOT EXISTS polls (
      id serial PRIMARY KEY,
      question text NOT NULL,
      creator text NOT NULL,
      options jsonb NOT NULL DEFAULT '[]'::jsonb,
      votes jsonb NOT NULL DEFAULT '{}'::jsonb,
      created_at timestamp NOT NULL DEFAULT now()
    );

    CREATE TABLE IF NOT EXISTS dms (
      id serial PRIMARY KEY,
      from_user text NOT NULL,
      to_user text NOT NULL,
      body text NOT NULL DEFAULT '',
      image_url text,
      read_at timestamp,
      created_at timestamp NOT NULL DEFAULT now()
    );
    ALTER TABLE dms ADD COLUMN IF NOT EXISTS image_url text;
    ALTER TABLE dms ADD COLUMN IF NOT EXISTS read_at timestamp;

    CREATE TABLE IF NOT EXISTS chess_lobbies (
      id serial PRIMARY KEY,
      name text NOT NULL,
      host_user text NOT NULL,
      white_user text,
      black_user text,
      fen text NOT NULL DEFAULT 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1',
      moves jsonb NOT NULL DEFAULT '[]'::jsonb,
      status text NOT NULL DEFAULT 'waiting',
      winner text,
      chat jsonb NOT NULL DEFAULT '[]'::jsonb,
      updated_at timestamp NOT NULL DEFAULT now(),
      created_at timestamp NOT NULL DEFAULT now()
    );

    CREATE TABLE IF NOT EXISTS user_pages (
      username text PRIMARY KEY,
      data_url text NOT NULL,
      elements jsonb NOT NULL DEFAULT '[]'::jsonb,
      updated_at timestamp NOT NULL DEFAULT now()
    );
    ALTER TABLE user_pages ADD COLUMN IF NOT EXISTS elements jsonb NOT NULL DEFAULT '[]'::jsonb;

    CREATE TABLE IF NOT EXISTS cafe_presence (
      username text PRIMARY KEY,
      x integer NOT NULL DEFAULT 200,
      y integer NOT NULL DEFAULT 200,
      avatar jsonb NOT NULL DEFAULT '{}'::jsonb,
      last_seen timestamp NOT NULL DEFAULT now()
    );
    ALTER TABLE cafe_presence ADD COLUMN IF NOT EXISTS avatar jsonb NOT NULL DEFAULT '{}'::jsonb;

    CREATE TABLE IF NOT EXISTS cafe_chat (
      id serial PRIMARY KEY,
      author text NOT NULL,
      body text NOT NULL,
      created_at timestamp NOT NULL DEFAULT now()
    );

    CREATE TABLE IF NOT EXISTS cafe_settings (
      id serial PRIMARY KEY,
      theme text NOT NULL DEFAULT 'cafe'
    );

    CREATE TABLE IF NOT EXISTS cafe_rooms (
      id serial PRIMARY KEY,
      slug text NOT NULL UNIQUE,
      name text NOT NULL,
      background_data_url text NOT NULL,
      floor_color text NOT NULL DEFAULT '#444444',
      created_by text NOT NULL,
      created_at timestamp NOT NULL DEFAULT now()
    );

    CREATE TABLE IF NOT EXISTS cafe_objects (
      id serial PRIMARY KEY,
      room text NOT NULL,
      name text NOT NULL,
      x integer NOT NULL,
      y integer NOT NULL,
      width integer NOT NULL DEFAULT 48,
      height integer NOT NULL DEFAULT 48,
      emoji text,
      drawing_data_url text,
      action_type text NOT NULL,
      action_value text NOT NULL,
      created_by text NOT NULL,
      created_at timestamp NOT NULL DEFAULT now()
    );

    CREATE TABLE IF NOT EXISTS guestbook_entries (
      id serial PRIMARY KEY,
      author text NOT NULL DEFAULT 'anon',
      body text NOT NULL,
      created_at timestamp NOT NULL DEFAULT now()
    );

    CREATE TABLE IF NOT EXISTS photos (
      id serial PRIMARY KEY,
      caption text NOT NULL DEFAULT '',
      data_url text NOT NULL,
      created_at timestamp NOT NULL DEFAULT now()
    );

    CREATE TABLE IF NOT EXISTS banned_users (
      id serial PRIMARY KEY,
      username text NOT NULL UNIQUE,
      banned_by text NOT NULL,
      reason text NOT NULL DEFAULT '',
      created_at timestamp NOT NULL DEFAULT now()
    );

    CREATE TABLE IF NOT EXISTS user_ips (
      id serial PRIMARY KEY,
      username text NOT NULL,
      ip text NOT NULL,
      first_seen timestamp NOT NULL DEFAULT now(),
      last_seen timestamp NOT NULL DEFAULT now(),
      hits integer NOT NULL DEFAULT 1
    );
    CREATE INDEX IF NOT EXISTS user_ips_username_idx ON user_ips (username);
    CREATE INDEX IF NOT EXISTS user_ips_ip_idx ON user_ips (ip);

    CREATE TABLE IF NOT EXISTS ip_bans (
      id serial PRIMARY KEY,
      ip text NOT NULL UNIQUE,
      banned_by text NOT NULL DEFAULT 'admin',
      reason text NOT NULL DEFAULT '',
      created_at timestamp NOT NULL DEFAULT now()
    );

    CREATE TABLE IF NOT EXISTS news_posts (
      id serial PRIMARY KEY,
      author text NOT NULL,
      title text NOT NULL DEFAULT '',
      body text NOT NULL DEFAULT '',
      images jsonb NOT NULL DEFAULT '[]'::jsonb,
      created_at timestamp NOT NULL DEFAULT now(),
      updated_at timestamp NOT NULL DEFAULT now()
    );
    ALTER TABLE news_posts ADD COLUMN IF NOT EXISTS images jsonb NOT NULL DEFAULT '[]'::jsonb;
    ALTER TABLE news_posts ADD COLUMN IF NOT EXISTS updated_at timestamp NOT NULL DEFAULT now();
    ALTER TABLE news_posts ADD COLUMN IF NOT EXISTS title text NOT NULL DEFAULT '';
    ALTER TABLE news_posts ADD COLUMN IF NOT EXISTS body text NOT NULL DEFAULT '';

    CREATE TABLE IF NOT EXISTS site_settings (
      id serial PRIMARY KEY,
      logo_data_url text NOT NULL DEFAULT '',
      site_name text NOT NULL DEFAULT 'Portfolio 98',
      updated_at timestamp NOT NULL DEFAULT now()
    );
    ALTER TABLE site_settings ADD COLUMN IF NOT EXISTS site_name text NOT NULL DEFAULT 'Portfolio 98';
    ALTER TABLE site_settings ADD COLUMN IF NOT EXISTS updated_at timestamp NOT NULL DEFAULT now();

    CREATE TABLE IF NOT EXISTS chat_audit_log (
      id serial PRIMARY KEY,
      area text NOT NULL DEFAULT 'chat',
      action text NOT NULL,
      actor text NOT NULL,
      target text NOT NULL DEFAULT '',
      body text NOT NULL DEFAULT '',
      created_at timestamp NOT NULL DEFAULT now()
    );
    ALTER TABLE chat_audit_log ADD COLUMN IF NOT EXISTS area text NOT NULL DEFAULT 'chat';

    CREATE TABLE IF NOT EXISTS forum_threads (
      id serial PRIMARY KEY,
      title text NOT NULL,
      author text NOT NULL,
      password_hash text,
      created_at timestamp NOT NULL DEFAULT now()
    );
    ALTER TABLE forum_threads ADD COLUMN IF NOT EXISTS password_hash text;

    CREATE TABLE IF NOT EXISTS forum_posts (
      id serial PRIMARY KEY,
      thread_id integer NOT NULL,
      author text NOT NULL,
      body text NOT NULL,
      image_url text,
      created_at timestamp NOT NULL DEFAULT now()
    );
    ALTER TABLE forum_posts ADD COLUMN IF NOT EXISTS image_url text;

    CREATE TABLE IF NOT EXISTS youtube_sync (
      id serial PRIMARY KEY,
      video_id text NOT NULL DEFAULT '',
      started_at timestamp NOT NULL DEFAULT now(),
      set_by text NOT NULL DEFAULT ''
    );

    CREATE TABLE IF NOT EXISTS blackjack_tables (
      id serial PRIMARY KEY,
      name text NOT NULL DEFAULT 'Table 1',
      state jsonb NOT NULL DEFAULT '{}'::jsonb,
      updated_at timestamp NOT NULL DEFAULT now()
    );

    CREATE TABLE IF NOT EXISTS flappy_players (
      username text PRIMARY KEY,
      y integer NOT NULL DEFAULT 0,
      score integer NOT NULL DEFAULT 0,
      alive boolean NOT NULL DEFAULT true,
      updated_at timestamp NOT NULL DEFAULT now()
    );

    CREATE TABLE IF NOT EXISTS flappy_scores (
      id serial PRIMARY KEY,
      username text NOT NULL,
      score integer NOT NULL,
      created_at timestamp NOT NULL DEFAULT now()
    );
  `;

  const client = await pool.connect();
  try {
    // One big multi-statement query inside a transaction so that a
    // partial failure leaves the DB unchanged. `IF NOT EXISTS` makes
    // every individual statement a no-op when the object already exists,
    // so the transaction is normally a near-instant batch of cheap
    // metadata reads.
    await client.query("BEGIN");
    await client.query(sql);
    await client.query("COMMIT");
    logger.info("Database schema bootstrap complete");
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    // We log and rethrow — if bootstrap fails, the server should NOT come
    // up serving traffic against an unknown DB shape. Crashing here turns
    // a silent prod-data-corruption scenario into a loud deploy failure.
    logger.error({ err }, "Database schema bootstrap failed");
    throw err;
  } finally {
    client.release();
  }
}
