import { Router, type IRouter } from "express";
import { db, cafeRoomsTable } from "@workspace/db";
import { asc, eq } from "drizzle-orm";
import { requireAdmin } from "../lib/auth";
import { audit } from "./social";

const router: IRouter = Router();

const MAX_BG_BYTES = 2_000_000;
const MAX_NAME_LEN = 40;
const SLUG_RE = /^[a-z0-9][a-z0-9-]{1,30}$/;
const COLOR_RE = /^#[0-9a-fA-F]{6}$/;

router.get("/cafe-rooms", async (_req, res) => {
  const rows = await db
    .select({
      id: cafeRoomsTable.id,
      slug: cafeRoomsTable.slug,
      name: cafeRoomsTable.name,
      backgroundDataUrl: cafeRoomsTable.backgroundDataUrl,
      floorColor: cafeRoomsTable.floorColor,
      createdBy: cafeRoomsTable.createdBy,
      createdAt: cafeRoomsTable.createdAt,
    })
    .from(cafeRoomsTable)
    .orderBy(asc(cafeRoomsTable.name));
  res.json(rows);
});

router.post("/cafe-rooms", requireAdmin, async (req, res) => {
  const slug = String(req.body?.slug || "").trim().toLowerCase();
  const name = String(req.body?.name || "").trim().slice(0, MAX_NAME_LEN);
  const backgroundDataUrl = String(req.body?.backgroundDataUrl || "");
  const floorColor = String(req.body?.floorColor || "#444444");

  if (!SLUG_RE.test(slug)) {
    res.status(400).json({ error: "Slug must be 2-31 chars, lowercase letters/numbers/dashes, starting with a letter or number." });
    return;
  }
  if (!name) { res.status(400).json({ error: "name required" }); return; }
  if (!backgroundDataUrl.startsWith("data:image/")) {
    res.status(400).json({ error: "backgroundDataUrl must be a data:image/* string" });
    return;
  }
  if (backgroundDataUrl.length > MAX_BG_BYTES) {
    res.status(413).json({ error: `Background too large (max ${Math.round(MAX_BG_BYTES / 1024)}KB after encoding)` });
    return;
  }
  const cleanFloor = COLOR_RE.test(floorColor) ? floorColor : "#444444";

  const actor = req.session.username || "admin";
  try {
    const [row] = await db
      .insert(cafeRoomsTable)
      .values({ slug, name, backgroundDataUrl, floorColor: cleanFloor, createdBy: actor })
      .returning();
    await audit("cafe", "room-create", actor, slug, name);
    res.json(row);
  } catch {
    res.status(409).json({ error: "A room with that slug already exists" });
  }
});

router.delete("/cafe-rooms/:slug", requireAdmin, async (req, res) => {
  const slug = String(req.params.slug || "").trim().toLowerCase();
  if (!slug) { res.status(400).json({ error: "slug required" }); return; }
  const [existing] = await db.select().from(cafeRoomsTable).where(eq(cafeRoomsTable.slug, slug)).limit(1);
  if (!existing) { res.status(404).json({ error: "Not found" }); return; }
  await db.delete(cafeRoomsTable).where(eq(cafeRoomsTable.slug, slug));
  await audit("cafe", "room-delete", req.session.username || "admin", slug, existing.name);
  res.json({ ok: true });
});

export default router;
