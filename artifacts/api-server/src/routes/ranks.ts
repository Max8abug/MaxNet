import { Router, type IRouter } from "express";
import { db, ranksTable, usersTable } from "@workspace/db";
import { eq, asc } from "drizzle-orm";
import { requireAdmin, isAdminUsername } from "../lib/auth";
import { audit } from "./social";

const router: IRouter = Router();

const BUILTIN_RANKS = [
  { name: "admin", color: "#ff3030", tier: 100, permissions: ["deleteMessages", "ban", "dm", "manageRanks", "cafeTheme"] },
  { name: "mod", color: "#3070ff", tier: 50, permissions: ["deleteMessages", "ban", "dm"] },
  { name: "vip", color: "#a040ff", tier: 20, permissions: ["dm"] },
];

async function ensureBuiltins() {
  for (const r of BUILTIN_RANKS) {
    const [existing] = await db.select().from(ranksTable).where(eq(ranksTable.name, r.name)).limit(1);
    if (!existing) {
      try { await db.insert(ranksTable).values(r); } catch {}
    }
  }
}

router.get("/ranks", async (_req, res) => {
  await ensureBuiltins();
  const rows = await db.select().from(ranksTable).orderBy(asc(ranksTable.tier));
  res.json(rows);
});

router.post("/ranks", requireAdmin, async (req, res) => {
  const { name, color, permissions, tier } = req.body ?? {};
  if (typeof name !== "string" || !name.trim()) { res.status(400).json({ error: "name required" }); return; }
  const cleanName = name.trim().slice(0, 24);
  const cleanColor = (typeof color === "string" && color.match(/^#[0-9a-fA-F]{6}$/)) ? color : "#888888";
  const cleanPerms = Array.isArray(permissions) ? permissions.filter((p): p is string => typeof p === "string").slice(0, 20) : [];
  const cleanTier = (typeof tier === "number" && tier >= 1 && tier <= 99) ? Math.floor(tier) : 10;
  try {
    const [row] = await db.insert(ranksTable).values({ name: cleanName, color: cleanColor, permissions: cleanPerms, tier: cleanTier }).returning();
    await audit("ranks", "create", req.session.username || "admin", cleanName, JSON.stringify(cleanPerms));
    res.json(row);
  } catch { res.status(409).json({ error: "rank name taken" }); }
});

router.delete("/ranks/:name", requireAdmin, async (req, res) => {
  const name = String(req.params.name || "");
  if (BUILTIN_RANKS.some(b => b.name === name)) { res.status(400).json({ error: "Cannot delete builtin rank" }); return; }
  await db.delete(ranksTable).where(eq(ranksTable.name, name));
  await db.update(usersTable).set({ rank: null }).where(eq(usersTable.rank, name));
  await audit("ranks", "delete", req.session.username || "admin", name, "");
  res.json({ ok: true });
});

router.post("/ranks/assign", requireAdmin, async (req, res) => {
  const { username, rank } = req.body ?? {};
  if (typeof username !== "string" || !username.trim()) { res.status(400).json({ error: "username required" }); return; }
  if (rank !== null && (typeof rank !== "string" || !rank.trim())) { res.status(400).json({ error: "rank required" }); return; }
  if (rank !== null) {
    const [r] = await db.select().from(ranksTable).where(eq(ranksTable.name, rank)).limit(1);
    if (!r) { res.status(404).json({ error: "rank not found" }); return; }
  }
  await db.update(usersTable).set({ rank }).where(eq(usersTable.username, username.trim()));
  await audit("ranks", "assign", req.session.username || "admin", username.trim(), rank || "(cleared)");
  res.json({ ok: true });
});

export async function getUserPermissions(username: string | undefined): Promise<string[]> {
  if (!username) return [];
  if (isAdminUsername(username)) return ["deleteMessages", "ban", "dm", "manageRanks", "cafeTheme"];
  const [u] = await db.select().from(usersTable).where(eq(usersTable.username, username)).limit(1);
  if (!u || !u.rank) return [];
  await ensureBuiltins();
  const [r] = await db.select().from(ranksTable).where(eq(ranksTable.name, u.rank)).limit(1);
  return Array.isArray(r?.permissions) ? (r!.permissions as string[]) : [];
}

export default router;
