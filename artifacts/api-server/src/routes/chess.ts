import { Router, type IRouter } from "express";
import { db, chessLobbiesTable } from "@workspace/db";
import { desc, eq, ne } from "drizzle-orm";
import { requireAuth } from "../lib/auth";
import { isBanned, audit } from "./social";

const router: IRouter = Router();

const START_FEN = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1";

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
  return { rows, turn, castling: castling || "-", ep: ep || "-", halfmove: parseInt(halfmove || "0"), fullmove: parseInt(fullmove || "1") };
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
function uciToCoords(m: string) {
  if (m.length < 4 || m.length > 5) return null;
  const fc = m.charCodeAt(0) - 97, fr = 8 - parseInt(m[1]);
  const tc = m.charCodeAt(2) - 97, tr = 8 - parseInt(m[3]);
  if ([fr, fc, tr, tc].some(v => v < 0 || v > 7 || isNaN(v))) return null;
  return { fr, fc, tr, tc, promo: m[4] || null };
}
const isWhitePiece = (p: string | null) => !!p && p === p.toUpperCase();
const isOpponent = (p: string | null, turn: string) => !!p && (turn === "w" ? !isWhitePiece(p) : isWhitePiece(p));
const isOwn = (p: string | null, turn: string) => !!p && (turn === "w" ? isWhitePiece(p) : !isWhitePiece(p));

// Squares attacked by `byTurn` side - used to check if a target square is under attack
function squareAttacked(rows: (string | null)[][], r: number, c: number, byTurn: string): boolean {
  // Pawn attacks
  const pawnDir = byTurn === "w" ? 1 : -1; // attacking square at (r,c) means a pawn sits at r+pawnDir
  const pawn = byTurn === "w" ? "P" : "p";
  for (const dc of [-1, 1]) {
    const pr = r + pawnDir, pc = c + dc;
    if (pr >= 0 && pr < 8 && pc >= 0 && pc < 8 && rows[pr][pc] === pawn) return true;
  }
  // Knight
  const knight = byTurn === "w" ? "N" : "n";
  for (const [dr, dc] of [[-2,-1],[-2,1],[-1,-2],[-1,2],[1,-2],[1,2],[2,-1],[2,1]]) {
    const nr = r + dr, nc = c + dc;
    if (nr >= 0 && nr < 8 && nc >= 0 && nc < 8 && rows[nr][nc] === knight) return true;
  }
  // King
  const king = byTurn === "w" ? "K" : "k";
  for (let dr = -1; dr <= 1; dr++) for (let dc = -1; dc <= 1; dc++) {
    if (!dr && !dc) continue;
    const nr = r + dr, nc = c + dc;
    if (nr >= 0 && nr < 8 && nc >= 0 && nc < 8 && rows[nr][nc] === king) return true;
  }
  // Sliding: bishop/queen diagonals, rook/queen orthogonals
  const bishopQueen = byTurn === "w" ? ["B", "Q"] : ["b", "q"];
  const rookQueen = byTurn === "w" ? ["R", "Q"] : ["r", "q"];
  const slide = (dr: number, dc: number, set: string[]) => {
    let nr = r + dr, nc = c + dc;
    while (nr >= 0 && nr < 8 && nc >= 0 && nc < 8) {
      const p = rows[nr][nc];
      if (p) { return set.includes(p); }
      nr += dr; nc += dc;
    }
    return false;
  };
  for (const [dr, dc] of [[-1,-1],[-1,1],[1,-1],[1,1]]) if (slide(dr, dc, bishopQueen)) return true;
  for (const [dr, dc] of [[-1,0],[1,0],[0,-1],[0,1]]) if (slide(dr, dc, rookQueen)) return true;
  return false;
}

function findKing(rows: (string | null)[][], turn: string): [number, number] | null {
  const k = turn === "w" ? "K" : "k";
  for (let r = 0; r < 8; r++) for (let c = 0; c < 8; c++) if (rows[r][c] === k) return [r, c];
  return null;
}

function pseudoMoves(rows: (string | null)[][], turn: string, ep: string, castling: string): string[] {
  const moves: string[] = [];
  const opp = (p: string | null) => isOpponent(p, turn);
  const own = (p: string | null) => isOwn(p, turn);
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
    if (!p || !own(p)) continue;
    const lo = p.toLowerCase();
    const from = sq(c, r);
    if (lo === "p") {
      const dir = isWhitePiece(p) ? -1 : 1;
      const startR = isWhitePiece(p) ? 6 : 1;
      const promoR = isWhitePiece(p) ? 0 : 7;
      const nr = r + dir;
      if (nr >= 0 && nr < 8 && !rows[nr][c]) {
        if (nr === promoR) for (const q of "qrbn") moves.push(from + sq(c, nr) + q);
        else moves.push(from + sq(c, nr));
        if (r === startR && !rows[r + 2 * dir][c]) moves.push(from + sq(c, r + 2 * dir));
      }
      for (const dc of [-1, 1]) {
        const nc = c + dc;
        if (nc < 0 || nc > 7 || nr < 0 || nr > 7) continue;
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
      // Castling
      const homeR = turn === "w" ? 7 : 0;
      if (r === homeR && c === 4) {
        const enemyTurn = turn === "w" ? "b" : "w";
        const inCheck = squareAttacked(rows, homeR, 4, enemyTurn);
        // King-side
        const kSide = turn === "w" ? "K" : "k";
        if (castling.includes(kSide) && !rows[homeR][5] && !rows[homeR][6] && !inCheck
          && !squareAttacked(rows, homeR, 5, enemyTurn) && !squareAttacked(rows, homeR, 6, enemyTurn)) {
          moves.push(from + sq(6, homeR));
        }
        // Queen-side
        const qSide = turn === "w" ? "Q" : "q";
        if (castling.includes(qSide) && !rows[homeR][1] && !rows[homeR][2] && !rows[homeR][3] && !inCheck
          && !squareAttacked(rows, homeR, 3, enemyTurn) && !squareAttacked(rows, homeR, 2, enemyTurn)) {
          moves.push(from + sq(2, homeR));
        }
      }
    }
  }
  return moves;
}

function applyMoveOnBoard(rows: (string | null)[][], c: { fr: number; fc: number; tr: number; tc: number; promo: string | null }, ep: string, castling: string, turn: string): { rows: (string | null)[][]; ep: string; castling: string; capturedPawn: boolean } {
  const newRows = rows.map(row => [...row]);
  const piece = newRows[c.fr][c.fc]!;
  let newEp = "-";
  let newCastling = castling;
  // EP capture
  if (piece.toLowerCase() === "p" && ep && ep !== "-") {
    const epFile = ep.charCodeAt(0) - 97;
    const epRank = 8 - parseInt(ep[1]);
    if (c.tr === epRank && c.tc === epFile && newRows[c.tr][c.tc] === null) {
      newRows[c.fr][c.tc] = null;
    }
  }
  // Castling: move rook too
  if (piece.toLowerCase() === "k" && Math.abs(c.tc - c.fc) === 2) {
    const homeR = turn === "w" ? 7 : 0;
    if (c.tc === 6) { newRows[homeR][5] = newRows[homeR][7]; newRows[homeR][7] = null; }
    else if (c.tc === 2) { newRows[homeR][3] = newRows[homeR][0]; newRows[homeR][0] = null; }
  }
  newRows[c.fr][c.fc] = null;
  let newPiece = piece;
  if (c.promo && piece.toLowerCase() === "p") newPiece = isWhitePiece(piece) ? c.promo.toUpperCase() : c.promo.toLowerCase();
  newRows[c.tr][c.tc] = newPiece;
  // Update EP
  if (piece.toLowerCase() === "p" && Math.abs(c.tr - c.fr) === 2) {
    const midR = (c.fr + c.tr) / 2;
    newEp = `${String.fromCharCode(97 + c.fc)}${8 - midR}`;
  }
  // Update castling rights
  if (piece === "K") newCastling = newCastling.replace("K", "").replace("Q", "");
  if (piece === "k") newCastling = newCastling.replace("k", "").replace("q", "");
  if (piece === "R" && c.fr === 7 && c.fc === 0) newCastling = newCastling.replace("Q", "");
  if (piece === "R" && c.fr === 7 && c.fc === 7) newCastling = newCastling.replace("K", "");
  if (piece === "r" && c.fr === 0 && c.fc === 0) newCastling = newCastling.replace("q", "");
  if (piece === "r" && c.fr === 0 && c.fc === 7) newCastling = newCastling.replace("k", "");
  // If a rook is captured on its home square, also revoke that rook's castling right
  if (c.tr === 0 && c.tc === 0) newCastling = newCastling.replace("q", "");
  if (c.tr === 0 && c.tc === 7) newCastling = newCastling.replace("k", "");
  if (c.tr === 7 && c.tc === 0) newCastling = newCastling.replace("Q", "");
  if (c.tr === 7 && c.tc === 7) newCastling = newCastling.replace("K", "");
  if (!newCastling) newCastling = "-";
  return { rows: newRows, ep: newEp, castling: newCastling, capturedPawn: piece.toLowerCase() === "p" };
}

function legalMoves(rows: (string | null)[][], turn: string, ep: string, castling: string): string[] {
  const pseudo = pseudoMoves(rows, turn, ep, castling);
  return pseudo.filter(uci => {
    const c = uciToCoords(uci)!;
    const after = applyMoveOnBoard(rows, c, ep, castling, turn);
    const k = findKing(after.rows, turn);
    if (!k) return false;
    const enemyTurn = turn === "w" ? "b" : "w";
    return !squareAttacked(after.rows, k[0], k[1], enemyTurn);
  });
}

function applyMove(fen: string, uci: string): string | null {
  const st = parseFen(fen);
  const all = legalMoves(st.rows, st.turn, st.ep, st.castling);
  let chosen = uci;
  if (!all.includes(chosen) && uci.length === 4) {
    chosen = uci + "q";
    if (!all.includes(chosen)) return null;
  } else if (!all.includes(chosen)) {
    return null;
  }
  const c = uciToCoords(chosen)!;
  const piece = st.rows[c.fr][c.fc]!;
  const after = applyMoveOnBoard(st.rows, c, st.ep, st.castling, st.turn);
  const newTurn = st.turn === "w" ? "b" : "w";
  const wasCapture = !!st.rows[c.tr][c.tc];
  const newHalfmove = (piece.toLowerCase() === "p" || wasCapture) ? 0 : st.halfmove + 1;
  const newFullmove = st.turn === "b" ? st.fullmove + 1 : st.fullmove;
  return boardToFen(after.rows, newTurn, after.castling, after.ep, newHalfmove, newFullmove);
}

function isGameOver(fen: string): { over: boolean; winnerSide: string | null; draw: boolean } {
  const st = parseFen(fen);
  const moves = legalMoves(st.rows, st.turn, st.ep, st.castling);
  if (moves.length > 0) return { over: false, winnerSide: null, draw: false };
  const k = findKing(st.rows, st.turn);
  const enemyTurn = st.turn === "w" ? "b" : "w";
  if (k && squareAttacked(st.rows, k[0], k[1], enemyTurn)) {
    return { over: true, winnerSide: enemyTurn, draw: false };
  }
  return { over: true, winnerSide: null, draw: true };
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
  const willHaveBoth = (update.whiteUser || row.whiteUser) && (update.blackUser || row.blackUser);
  if (willHaveBoth) update.status = "playing";
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
  const end = isGameOver(newFen);
  let winner: string | null = row.winner;
  let status = "playing";
  if (end.over) {
    status = "done";
    if (end.draw) winner = "draw";
    else winner = end.winnerSide === "w" ? row.whiteUser : row.blackUser;
  }
  await db.update(chessLobbiesTable).set({
    fen: newFen, moves, updatedAt: new Date(), status, winner,
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

// Expose legal moves so the client can highlight & avoid illegal click attempts
router.get("/chess/lobbies/:id/moves", async (req, res) => {
  const id = Number(req.params.id);
  const [row] = await db.select().from(chessLobbiesTable).where(eq(chessLobbiesTable.id, id)).limit(1);
  if (!row) { res.status(404).json({ error: "not found" }); return; }
  const st = parseFen(row.fen);
  res.json({ moves: legalMoves(st.rows, st.turn, st.ep, st.castling) });
});

export default router;
