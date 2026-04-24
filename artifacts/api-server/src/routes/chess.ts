import { Router, type IRouter } from "express";
import { db, chessLobbiesTable } from "@workspace/db";
import { desc, eq, ne, and } from "drizzle-orm";
import { requireAuth } from "../lib/auth";
import { isBanned, audit } from "./social";

const router: IRouter = Router();

const START_FEN = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1";

// Minimal chess move validator: parses FEN, applies UCI move ("e2e4", "e7e8q"), returns new FEN or null.
function parseFen(fen: string) {
  const [board, turn, castling, ep, halfmove, fullmove] = fen.split(" ");
  const rows = board.split("/").map(row => {
    const cells: (string | null)[] = [];
    for (const c of row) {
      if (/\d/.test(c)) for (let i = 0; i < parseInt(c); i++) cells.push(null);
      else cells.push(c);
    }
    return cells;
  });
  return { rows, turn, castling, ep, halfmove: parseInt(halfmove || "0"), fullmove: parseInt(fullmove || "1") };
}
function boardToFen(rows: (string | null)[][], turn: string, castling: string, ep: string, halfmove: number, fullmove: number) {
  const parts = rows.map(row => {
    let s = "", run = 0;
    for (const c of row) {
      if (!c) run++;
      else { if (run) { s += run; run = 0; } s += c; }
    }
    if (run) s += run;
    return s;
  });
  return `${parts.join("/")} ${turn} ${castling || "-"} ${ep || "-"} ${halfmove} ${fullmove}`;
}
function uciToCoords(m: string): { fr: number; fc: number; tr: number; tc: number; promo: string | null } | null {
  if (m.length < 4 || m.length > 5) return null;
  const fc = m.charCodeAt(0) - 97, fr = 8 - parseInt(m[1]);
  const tc = m.charCodeAt(2) - 97, tr = 8 - parseInt(m[3]);
  if ([fr, fc, tr, tc].some(v => v < 0 || v > 7 || isNaN(v))) return null;
  return { fr, fc, tr, tc, promo: m[4] || null };
}
function isWhitePiece(p: string | null) { return !!p && p === p.toUpperCase(); }
function isOpponent(piece: string | null, turn: string) {
  if (!piece) return false;
  return turn === "w" ? !isWhitePiece(piece) : isWhitePiece(piece);
}
function clear(p: string | null) { return !p; }

function pseudoMoves(rows: (string | null)[][], turn: string, ep: string): string[] {
  const moves: string[] = [];
  const opp = (p: string | null) => isOpponent(p, turn);
  const own = (p: string | null) => p && (turn === "w" ? isWhitePiece(p) : !isWhitePiece(p));
  const ray = (r: number, c: number, dr: number, dc: number) => {
    const out: [number, number][] = [];
    let nr = r + dr, nc = c + dc;
    while (nr >= 0 && nr < 8 && nc >= 0 && nc < 8) {
      if (own(rows[nr][nc])) break;
      out.push([nr, nc]);
      if (opp(rows[nr][nc])) break;
      nr += dr; nc += dc;
    }
    return out;
  };
  const sq = (c: number, r: number) => `${String.fromCharCode(97 + c)}${8 - r}`;
  for (let r = 0; r < 8; r++) for (let c = 0; c < 8; c++) {
    const p = rows[r][c];
    if (!p) continue;
    if (turn === "w" && !isWhitePiece(p)) continue;
    if (turn === "b" && isWhitePiece(p)) continue;
    const lo = p.toLowerCase();
    const from = sq(c, r);
    if (lo === "p") {
      const dir = isWhitePiece(p) ? -1 : 1;
      const startR = isWhitePiece(p) ? 6 : 1;
      const promoR = isWhitePiece(p) ? 0 : 7;
      const nr = r + dir;
      if (nr >= 0 && nr < 8 && clear(rows[nr][c])) {
        if (nr === promoR) for (const q of "qrbn") moves.push(from + sq(c, nr) + q);
        else moves.push(from + sq(c, nr));
        if (r === startR && clear(rows[r + 2 * dir][c])) moves.push(from + sq(c, r + 2 * dir));
      }
      for (const dc of [-1, 1]) {
        const nc = c + dc;
        if (nc < 0 || nc > 7) continue;
        if (nr < 0 || nr > 7) continue;
        if (opp(rows[nr][nc])) {
          if (nr === promoR) for (const q of "qrbn") moves.push(from + sq(nc, nr) + q);
          else moves.push(from + sq(nc, nr));
        } else if (ep && ep !== "-" && sq(nc, nr) === ep) {
          moves.push(from + sq(nc, nr));
        }
      }
    } else if (lo === "n") {
      for (const [dr, dc] of [[-2,-1],[-2,1],[-1,-2],[-1,2],[1,-2],[1,2],[2,-1],[2,1]]) {
        const nr = r + dr, nc = c + dc;
        if (nr < 0 || nr > 7 || nc < 0 || nc > 7) continue;
        if (own(rows[nr][nc])) continue;
        moves.push(from + sq(nc, nr));
      }
    } else if (lo === "b" || lo === "r" || lo === "q") {
      const dirs: [number, number][] = [];
      if (lo !== "r") dirs.push([-1,-1],[-1,1],[1,-1],[1,1]);
      if (lo !== "b") dirs.push([-1,0],[1,0],[0,-1],[0,1]);
      for (const [dr, dc] of dirs) for (const [nr, nc] of ray(r, c, dr, dc)) moves.push(from + sq(nc, nr));
    } else if (lo === "k") {
      for (const dr of [-1,0,1]) for (const dc of [-1,0,1]) {
        if (!dr && !dc) continue;
        const nr = r + dr, nc = c + dc;
        if (nr < 0 || nr > 7 || nc < 0 || nc > 7) continue;
        if (own(rows[nr][nc])) continue;
        moves.push(from + sq(nc, nr));
      }
    }
  }
  return moves;
}

function applyMove(fen: string, uci: string): string | null {
  const st = parseFen(fen);
  const all = pseudoMoves(st.rows, st.turn, st.ep);
  // Allow the user's UCI if it's in pseudo moves OR matches with a default-queen promo
  let chosen = uci;
  if (!all.includes(chosen) && uci.length === 4) {
    chosen = uci + "q";
    if (!all.includes(chosen)) return null;
  } else if (!all.includes(chosen)) {
    return null;
  }
  const c = uciToCoords(chosen)!;
  const piece = st.rows[c.fr][c.fc]!;
  // EP capture
  if (piece.toLowerCase() === "p" && st.ep && st.ep !== "-") {
    const epFile = st.ep.charCodeAt(0) - 97;
    const epRank = 8 - parseInt(st.ep[1]);
    if (c.tr === epRank && c.tc === epFile && st.rows[c.tr][c.tc] === null) {
      st.rows[c.fr][c.tc] = null;
    }
  }
  st.rows[c.fr][c.fc] = null;
  let newPiece = piece;
  if (c.promo && piece.toLowerCase() === "p") newPiece = isWhitePiece(piece) ? c.promo.toUpperCase() : c.promo.toLowerCase();
  st.rows[c.tr][c.tc] = newPiece;
  // Update EP
  let newEp = "-";
  if (piece.toLowerCase() === "p" && Math.abs(c.tr - c.fr) === 2) {
    const midR = (c.fr + c.tr) / 2;
    newEp = `${String.fromCharCode(97 + c.fc)}${8 - midR}`;
  }
  const newTurn = st.turn === "w" ? "b" : "w";
  const newHalfmove = (piece.toLowerCase() === "p") ? 0 : st.halfmove + 1;
  const newFullmove = st.turn === "b" ? st.fullmove + 1 : st.fullmove;
  return boardToFen(st.rows, newTurn, st.castling, newEp, newHalfmove, newFullmove);
}

router.get("/chess/lobbies", async (_req, res) => {
  const rows = await db.select().from(chessLobbiesTable).where(ne(chessLobbiesTable.status, "done")).orderBy(desc(chessLobbiesTable.createdAt)).limit(50);
  res.json(rows);
});

router.post("/chess/lobbies", requireAuth, async (req, res) => {
  const me = req.session.username!;
  if (await isBanned(me)) { res.status(403).json({ error: "Banned" }); return; }
  const { name } = req.body ?? {};
  const cleanName = (typeof name === "string" && name.trim()) ? name.trim().slice(0, 40) : `${me}'s game`;
  const [row] = await db.insert(chessLobbiesTable).values({ name: cleanName, hostUser: me, whiteUser: me, fen: START_FEN, moves: [], status: "waiting", chat: [] }).returning();
  await audit("chess", "create", me, "", cleanName);
  res.json(row);
});

router.get("/chess/lobbies/:id", async (req, res) => {
  const id = Number(req.params.id);
  const [row] = await db.select().from(chessLobbiesTable).where(eq(chessLobbiesTable.id, id)).limit(1);
  if (!row) { res.status(404).json({ error: "not found" }); return; }
  res.json(row);
});

router.post("/chess/lobbies/:id/join", requireAuth, async (req, res) => {
  const id = Number(req.params.id);
  const me = req.session.username!;
  const [row] = await db.select().from(chessLobbiesTable).where(eq(chessLobbiesTable.id, id)).limit(1);
  if (!row) { res.status(404).json({ error: "not found" }); return; }
  const update: any = {};
  if (!row.whiteUser) update.whiteUser = me;
  else if (!row.blackUser && row.whiteUser !== me) update.blackUser = me;
  else if (row.whiteUser !== me && row.blackUser !== me) { res.status(409).json({ error: "Lobby full" }); return; }
  if (update.blackUser || (row.whiteUser && (row.blackUser || update.blackUser))) {
    update.status = "playing";
  }
  if (Object.keys(update).length) {
    await db.update(chessLobbiesTable).set({ ...update, updatedAt: new Date() }).where(eq(chessLobbiesTable.id, id));
  }
  res.json({ ok: true });
});

router.post("/chess/lobbies/:id/move", requireAuth, async (req, res) => {
  const id = Number(req.params.id);
  const me = req.session.username!;
  const { uci } = req.body ?? {};
  if (typeof uci !== "string") { res.status(400).json({ error: "uci required" }); return; }
  const [row] = await db.select().from(chessLobbiesTable).where(eq(chessLobbiesTable.id, id)).limit(1);
  if (!row) { res.status(404).json({ error: "not found" }); return; }
  if (row.status !== "playing") { res.status(400).json({ error: "Not playing" }); return; }
  const turn = row.fen.split(" ")[1];
  const expected = turn === "w" ? row.whiteUser : row.blackUser;
  if (expected !== me) { res.status(403).json({ error: "Not your turn" }); return; }
  const newFen = applyMove(row.fen, uci);
  if (!newFen) { res.status(400).json({ error: "Illegal move" }); return; }
  const moves = [...((row.moves as string[]) || []), uci];
  // Detect end: no king of new turn = checkmate-ish (simplified)
  const board = newFen.split(" ")[0];
  const newTurn = newFen.split(" ")[1];
  const oppKing = newTurn === "w" ? "K" : "k";
  const winner = !board.includes(oppKing) ? me : null;
  await db.update(chessLobbiesTable).set({
    fen: newFen, moves, updatedAt: new Date(),
    status: winner ? "done" : "playing",
    winner: winner || row.winner,
  }).where(eq(chessLobbiesTable.id, id));
  res.json({ ok: true });
});

router.post("/chess/lobbies/:id/resign", requireAuth, async (req, res) => {
  const id = Number(req.params.id);
  const me = req.session.username!;
  const [row] = await db.select().from(chessLobbiesTable).where(eq(chessLobbiesTable.id, id)).limit(1);
  if (!row) { res.status(404).json({ error: "not found" }); return; }
  if (row.whiteUser !== me && row.blackUser !== me) { res.status(403).json({ error: "Not in game" }); return; }
  const winner = row.whiteUser === me ? row.blackUser : row.whiteUser;
  await db.update(chessLobbiesTable).set({ status: "done", winner: winner || null, updatedAt: new Date() }).where(eq(chessLobbiesTable.id, id));
  res.json({ ok: true });
});

router.post("/chess/lobbies/:id/chat", requireAuth, async (req, res) => {
  const id = Number(req.params.id);
  const me = req.session.username!;
  const { body } = req.body ?? {};
  if (typeof body !== "string" || !body.trim()) { res.status(400).json({ error: "body required" }); return; }
  const [row] = await db.select().from(chessLobbiesTable).where(eq(chessLobbiesTable.id, id)).limit(1);
  if (!row) { res.status(404).json({ error: "not found" }); return; }
  const chat = [...((row.chat as any[]) || []), { author: me, body: body.trim().slice(0, 200), at: Date.now() }].slice(-50);
  await db.update(chessLobbiesTable).set({ chat, updatedAt: new Date() }).where(eq(chessLobbiesTable.id, id));
  res.json({ ok: true });
});

export default router;
