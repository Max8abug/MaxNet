import { Router, type IRouter } from "express";
import { db, userPagesTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { requireAuth } from "../lib/auth";
import { audit, requireDeleteMessages } from "./social";

const router: IRouter = Router();

function sanitizeElements(raw: unknown): any[] {
  if (!Array.isArray(raw)) return [];
  return raw.slice(0, 30).map((el: any) => {
    if (!el || typeof el !== "object") return null;
    const x = Math.max(0, Math.min(2000, Number(el.x) || 0));
    const y = Math.max(0, Math.min(2000, Number(el.y) || 0));
    const w = Math.max(20, Math.min(2000, Number(el.w) || 200));
    const h = Math.max(20, Math.min(2000, Number(el.h) || 100));
    if (el.type === "text") {
      return { type: "text", x, y, w, h, content: String(el.content || "").slice(0, 2000), color: String(el.color || "#000").slice(0, 16), size: Math.max(8, Math.min(72, Number(el.size) || 16)) };
    }
    if (el.type === "image") {
      const url = String(el.url || "").slice(0, 800_000);
      if (!url.startsWith("data:image/") && !/^https?:\/\//.test(url)) return null;
      return { type: "image", x, y, w, h, url };
    }
    if (el.type === "embed") {
      const url = String(el.url || "").slice(0, 500);
      if (!/^https?:\/\//.test(url)) return null;
      return { type: "embed", x, y, w, h, url };
    }
    return null;
  }).filter(Boolean);
}

router.get("/userpages/:username", async (req, res) => {
  const u = String(req.params.username);
  const [row] = await db.select().from(userPagesTable).where(eq(userPagesTable.username, u)).limit(1);
  res.json({ page: row || null });
});

router.put("/userpages", requireAuth, async (req, res) => {
  const { dataUrl, elements } = req.body ?? {};
  if (typeof dataUrl !== "string" || !dataUrl.startsWith("data:image/")) { res.status(400).json({ error: "data:image/* required" }); return; }
  if (dataUrl.length > 1_500_000) { res.status(413).json({ error: "Drawing too large" }); return; }
  const cleanElements = sanitizeElements(elements);
  const totalSize = JSON.stringify(cleanElements).length;
  if (totalSize > 4_000_000) { res.status(413).json({ error: "Page elements too large" }); return; }
  const me = req.session.username!;
  const [existing] = await db.select().from(userPagesTable).where(eq(userPagesTable.username, me)).limit(1);
  if (existing) {
    await db.update(userPagesTable).set({ dataUrl, elements: cleanElements, updatedAt: new Date() }).where(eq(userPagesTable.username, me));
  } else {
    await db.insert(userPagesTable).values({ username: me, dataUrl, elements: cleanElements });
  }
  res.json({ ok: true });
});

router.delete("/userpages/:username", requireDeleteMessages, async (req, res) => {
  const u = String(req.params.username);
  await db.delete(userPagesTable).where(eq(userPagesTable.username, u));
  await audit("userpage", "clear", req.session.username || "admin", u, "");
  res.json({ ok: true });
});

export default router;
