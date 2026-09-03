import { Router, type IRouter } from "express";
import { db, pollsTable } from "@workspace/db";
import { desc, eq } from "drizzle-orm";
import { requireAuth, requireAdmin } from "../lib/auth";
import { isBanned, audit } from "./social";

const router: IRouter = Router();

router.get("/polls", async (_req, res) => {
  const rows = await db.select().from(pollsTable).orderBy(desc(pollsTable.createdAt)).limit(100);
  res.json(rows);
});

router.post("/polls", requireAuth, async (req, res) => {
  const { question, options } = req.body ?? {};
  if (typeof question !== "string" || !question.trim()) { res.status(400).json({ error: "question required" }); return; }
  if (!Array.isArray(options) || options.length < 2 || options.length > 10) { res.status(400).json({ error: "2-10 options required" }); return; }
  const cleanOpts = options.map((o, i) => ({ id: i, label: String(o).slice(0, 80) })).filter(o => o.label.trim());
  if (cleanOpts.length < 2) { res.status(400).json({ error: "Need at least 2 non-empty options" }); return; }
  const creator = req.session.username!;
  if (await isBanned(creator)) { res.status(403).json({ error: "Banned" }); return; }
  const [row] = await db.insert(pollsTable).values({ question: question.trim().slice(0, 200), creator, options: cleanOpts, votes: {} }).returning();
  await audit("polls", "create", creator, "", question.trim().slice(0, 200));
  res.json(row);
});

router.post("/polls/:id/vote", requireAuth, async (req, res) => {
  const id = Number(req.params.id);
  const { optionId } = req.body ?? {};
  if (!Number.isFinite(id) || typeof optionId !== "number") { res.status(400).json({ error: "bad input" }); return; }
  const [poll] = await db.select().from(pollsTable).where(eq(pollsTable.id, id)).limit(1);
  if (!poll) { res.status(404).json({ error: "not found" }); return; }
  const opts = (poll.options as any[]) || [];
  if (!opts.find(o => o.id === optionId)) { res.status(400).json({ error: "invalid option" }); return; }
  const votes = { ...((poll.votes as any) || {}) };
  votes[req.session.username!] = optionId;
  await db.update(pollsTable).set({ votes }).where(eq(pollsTable.id, id));
  res.json({ ok: true });
});

router.delete("/polls/:id", requireAdmin, async (req, res) => {
  const id = Number(req.params.id);
  await db.delete(pollsTable).where(eq(pollsTable.id, id));
  await audit("polls", "delete", req.session.username || "admin", "", `id=${id}`);
  res.json({ ok: true });
});

export default router;
