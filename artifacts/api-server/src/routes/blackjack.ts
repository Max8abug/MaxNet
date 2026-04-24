import { Router, type IRouter } from "express";
import { db, blackjackTablesTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { requireAuth, isAdminUsername } from "../lib/auth";
import { getUserPermissions } from "./ranks";

const router: IRouter = Router();

const TURN_TIMEOUT_MS = 20_000;

type Card = { r: string; s: string };
interface Player { username: string; hand: Card[]; bet: number; status: "playing" | "stood" | "bust" | "win" | "lose" | "push" | "blackjack"; joinedAt: number; }
interface BJState {
  phase: "waiting" | "playing" | "dealer" | "done";
  deck: Card[];
  dealerHand: Card[];
  dealerHidden: boolean;
  players: Player[];
  currentTurn: number;
  turnStartedAt?: number;
  lastResultAt?: number;
  log: string[];
}

const RANKS = ["A", "2", "3", "4", "5", "6", "7", "8", "9", "10", "J", "Q", "K"];
const SUITS = ["♠", "♥", "♦", "♣"];

function freshDeck(): Card[] {
  const d: Card[] = [];
  for (let n = 0; n < 4; n++) for (const s of SUITS) for (const r of RANKS) d.push({ r, s });
  for (let i = d.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [d[i], d[j]] = [d[j], d[i]]; }
  return d;
}

function value(hand: Card[]): number {
  let v = 0, aces = 0;
  for (const c of hand) {
    if (c.r === "A") { v += 11; aces++; }
    else if (["J","Q","K"].includes(c.r)) v += 10;
    else v += parseInt(c.r);
  }
  while (v > 21 && aces > 0) { v -= 10; aces--; }
  return v;
}

function emptyState(): BJState {
  return { phase: "waiting", deck: freshDeck(), dealerHand: [], dealerHidden: true, players: [], currentTurn: 0, log: ["Table opened. Players can join."] };
}

async function getState(id: number): Promise<{ row: any; state: BJState }> {
  const [row] = await db.select().from(blackjackTablesTable).where(eq(blackjackTablesTable.id, id)).limit(1);
  if (!row) throw new Error("table not found");
  const state = (row.state && typeof row.state === "object" && Object.keys(row.state).length > 0 ? row.state : emptyState()) as BJState;
  if (!Array.isArray(state.deck) || state.deck.length === 0) state.deck = freshDeck();
  if (!Array.isArray(state.players)) state.players = [];
  if (!Array.isArray(state.log)) state.log = [];
  return { row, state };
}

async function saveState(id: number, state: BJState) {
  await db.update(blackjackTablesTable).set({ state: state as any, updatedAt: new Date() }).where(eq(blackjackTablesTable.id, id));
}

function publicState(state: BJState) {
  return {
    phase: state.phase,
    dealerHand: state.dealerHidden && state.dealerHand.length > 1 ? [state.dealerHand[0], { r: "?", s: "?" }] : state.dealerHand,
    dealerValue: state.dealerHidden && state.dealerHand.length > 1 ? value([state.dealerHand[0]]) : value(state.dealerHand),
    players: state.players.map((p) => ({ ...p, value: value(p.hand) })),
    currentTurn: state.currentTurn,
    log: state.log.slice(-30),
    deckRemaining: state.deck.length,
    turnStartedAt: state.turnStartedAt || 0,
    serverNow: Date.now(),
  };
}

async function ensureTable(): Promise<number> {
  const [row] = await db.select().from(blackjackTablesTable).limit(1);
  if (row) return row.id;
  const [created] = await db.insert(blackjackTablesTable).values({ name: "Main Table", state: emptyState() as any }).returning();
  return created.id;
}

router.get("/blackjack", async (_req, res) => {
  const id = await ensureTable();
  const { state } = await getState(id);
  res.json({ tableId: id, ...publicState(state) });
});

router.post("/blackjack/join", requireAuth, async (req, res) => {
  const id = await ensureTable();
  const { state } = await getState(id);
  const username = req.session.username!;
  if (state.phase === "playing" || state.phase === "dealer") {
    res.status(400).json({ error: "Game in progress, wait for next round" });
    return;
  }
  if (state.players.find((p) => p.username === username)) {
    res.json(publicState(state));
    return;
  }
  if (state.players.length >= 5) { res.status(400).json({ error: "Table full" }); return; }
  state.players.push({ username, hand: [], bet: 10, status: "playing", joinedAt: Date.now() });
  state.log.push(`${username} joined the table`);
  await saveState(id, state);
  res.json(publicState(state));
});

router.post("/blackjack/leave", requireAuth, async (req, res) => {
  const id = await ensureTable();
  const { state } = await getState(id);
  const username = req.session.username!;
  state.players = state.players.filter((p) => p.username !== username);
  state.log.push(`${username} left the table`);
  if (state.players.length === 0) Object.assign(state, emptyState());
  await saveState(id, state);
  res.json(publicState(state));
});

router.post("/blackjack/deal", requireAuth, async (_req, res) => {
  const id = await ensureTable();
  const { state } = await getState(id);
  if (state.players.length === 0) { res.status(400).json({ error: "No players" }); return; }
  if (state.phase === "playing" || state.phase === "dealer") { res.status(400).json({ error: "Round in progress" }); return; }
  if (state.deck.length < 20) state.deck = freshDeck();
  state.dealerHand = [];
  state.dealerHidden = true;
  for (const p of state.players) { p.hand = []; p.status = "playing"; }
  for (let i = 0; i < 2; i++) {
    for (const p of state.players) p.hand.push(state.deck.pop()!);
    state.dealerHand.push(state.deck.pop()!);
  }
  state.currentTurn = 0;
  state.phase = "playing";
  state.log.push(`--- New round dealt (${state.players.length} players) ---`);
  // Check for naturals
  for (const p of state.players) if (value(p.hand) === 21) { p.status = "blackjack"; state.log.push(`${p.username} has blackjack!`); }
  // Advance past blackjacks
  while (state.currentTurn < state.players.length && state.players[state.currentTurn].status !== "playing") state.currentTurn++;
  state.turnStartedAt = Date.now();
  if (state.currentTurn >= state.players.length) await dealerPlay(state);
  await saveState(id, state);
  res.json(publicState(state));
});

async function dealerPlay(state: BJState) {
  state.phase = "dealer";
  state.dealerHidden = false;
  while (value(state.dealerHand) < 17) state.dealerHand.push(state.deck.pop()!);
  const dv = value(state.dealerHand);
  state.log.push(`Dealer reveals: ${dv}${dv > 21 ? " (bust)" : ""}`);
  for (const p of state.players) {
    const pv = value(p.hand);
    if (p.status === "bust") { p.status = "lose"; continue; }
    if (p.status === "blackjack" && dv !== 21) { p.status = "blackjack"; state.log.push(`${p.username}: blackjack pays 3:2`); continue; }
    if (dv > 21) { p.status = "win"; state.log.push(`${p.username}: win (${pv})`); }
    else if (pv > dv) { p.status = "win"; state.log.push(`${p.username}: win (${pv} vs ${dv})`); }
    else if (pv === dv) { p.status = "push"; state.log.push(`${p.username}: push (${pv})`); }
    else { p.status = "lose"; state.log.push(`${p.username}: lose (${pv} vs ${dv})`); }
  }
  state.phase = "done";
  state.lastResultAt = Date.now();
}

router.post("/blackjack/hit", requireAuth, async (req, res) => {
  const id = await ensureTable();
  const { state } = await getState(id);
  const username = req.session.username!;
  if (state.phase !== "playing") { res.status(400).json({ error: "Not playing" }); return; }
  const player = state.players[state.currentTurn];
  if (!player || player.username !== username) { res.status(403).json({ error: "Not your turn" }); return; }
  player.hand.push(state.deck.pop()!);
  state.log.push(`${username} hits → ${value(player.hand)}`);
  if (value(player.hand) > 21) { player.status = "bust"; state.log.push(`${username} busts!`); advanceTurn(state); }
  else if (value(player.hand) === 21) { player.status = "stood"; advanceTurn(state); }
  if (state.currentTurn >= state.players.length) await dealerPlay(state);
  await saveState(id, state);
  res.json(publicState(state));
});

router.post("/blackjack/stand", requireAuth, async (req, res) => {
  const id = await ensureTable();
  const { state } = await getState(id);
  const username = req.session.username!;
  if (state.phase !== "playing") { res.status(400).json({ error: "Not playing" }); return; }
  const player = state.players[state.currentTurn];
  if (!player || player.username !== username) { res.status(403).json({ error: "Not your turn" }); return; }
  player.status = "stood";
  state.log.push(`${username} stands at ${value(player.hand)}`);
  advanceTurn(state);
  if (state.currentTurn >= state.players.length) await dealerPlay(state);
  await saveState(id, state);
  res.json(publicState(state));
});

function advanceTurn(state: BJState) {
  state.currentTurn++;
  while (state.currentTurn < state.players.length && state.players[state.currentTurn].status !== "playing") state.currentTurn++;
  state.turnStartedAt = Date.now();
}

router.post("/blackjack/skip", requireAuth, async (req, res) => {
  const id = await ensureTable();
  const { state } = await getState(id);
  const me = req.session.username!;
  if (state.phase !== "playing") { res.status(400).json({ error: "Nothing to skip" }); return; }
  const player = state.players[state.currentTurn];
  if (!player) { res.status(400).json({ error: "No active player" }); return; }
  const seated = state.players.some((p) => p.username === me);
  const perms = await getUserPermissions(me);
  const isMod = isAdminUsername(me) || perms.includes("deleteMessages");
  const elapsed = Date.now() - (state.turnStartedAt || 0);
  // Allow: the active player; mods anytime; any seated player after timeout
  const allowed =
    player.username === me ||
    isMod ||
    (seated && elapsed >= TURN_TIMEOUT_MS);
  if (!allowed) {
    const wait = Math.max(0, Math.ceil((TURN_TIMEOUT_MS - elapsed) / 1000));
    res.status(403).json({ error: `Wait ${wait}s before skipping (or sit down at the table)` });
    return;
  }
  player.status = "stood";
  state.log.push(`${player.username} was skipped (AFK) by ${me}`);
  advanceTurn(state);
  if (state.currentTurn >= state.players.length) await dealerPlay(state);
  await saveState(id, state);
  res.json(publicState(state));
});

router.post("/blackjack/reset", requireAuth, async (req, res) => {
  const id = await ensureTable();
  const { state } = await getState(id);
  const me = req.session.username!;
  const perms = await getUserPermissions(me);
  const isMod = isAdminUsername(me) || perms.includes("deleteMessages");
  const seated = state.players.some((p) => p.username === me);
  // Anyone seated can reset if game has been stuck > 60s, or any mod anytime.
  const stale = (state.phase === "playing" || state.phase === "dealer") &&
    Date.now() - (state.turnStartedAt || 0) > 60_000;
  if (!isMod && !(seated && stale)) {
    res.status(403).json({ error: "Only mods can reset, or a seated player after the table is stuck for 60s." });
    return;
  }
  // Reset hands and phase but keep players seated.
  const players = state.players;
  Object.assign(state, emptyState());
  state.players = players.map((p) => ({ ...p, hand: [], status: "playing" as const }));
  state.log.push(`Table was reset by ${me}.`);
  await saveState(id, state);
  res.json(publicState(state));
});

export default router;
