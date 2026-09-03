import { useEffect, useState } from "react";
import { fetchChessLobbies, createChessLobby, fetchChessLobby, joinChessLobby, moveChess, resignChess, chatChess, fetchChessMoves, type ChessLobby } from "../lib/api";
import { useAuth } from "../lib/auth-store";

// Use the FILLED chess glyphs for both colors so they render clearly when colored.
// (The outlined ♔♕♖♗♘♙ glyphs vanish when filled with white.)
const PIECE: Record<string, string> = { K: "♚", Q: "♛", R: "♜", B: "♝", N: "♞", P: "♟", k: "♚", q: "♛", r: "♜", b: "♝", n: "♞", p: "♟" };

function fenToBoard(fen: string): (string | null)[][] {
  const [b] = fen.split(" ");
  return b.split("/").map(row => {
    const cells: (string | null)[] = [];
    for (const c of row) {
      if (/\d/.test(c)) for (let i = 0; i < parseInt(c); i++) cells.push(null);
      else cells.push(c);
    }
    return cells;
  });
}

function squareName(c: number, r: number) { return `${String.fromCharCode(97 + c)}${8 - r}`; }

export function Chess() {
  const user = useAuth(s => s.user);
  const [lobbies, setLobbies] = useState<ChessLobby[]>([]);
  const [openId, setOpenId] = useState<number | null>(null);
  const [game, setGame] = useState<ChessLobby | null>(null);
  const [legal, setLegal] = useState<string[]>([]);
  const [sel, setSel] = useState<{ r: number; c: number } | null>(null); // board coords
  const [msg, setMsg] = useState("");
  const [err, setErr] = useState<string | null>(null);

  async function refresh() { try { setLobbies(await fetchChessLobbies()); } catch {} }
  useEffect(() => { void refresh(); const t = setInterval(refresh, 4000); return () => clearInterval(t); }, []);

  useEffect(() => {
    if (openId === null) return;
    let alive = true;
    const tick = async () => {
      try {
        const g = await fetchChessLobby(openId);
        if (!alive) return;
        setGame(prev => {
          // Reset selection if board changed
          if (prev && prev.fen !== g.fen) setSel(null);
          return g;
        });
        if (g.status === "playing") {
          try { const m = await fetchChessMoves(openId); if (alive) setLegal(m); } catch {}
        } else {
          setLegal([]);
        }
      } catch {}
    };
    void tick();
    const t = setInterval(tick, 2000);
    return () => { alive = false; clearInterval(t); };
  }, [openId]);

  async function newGame() {
    if (!user) return;
    try { const l = await createChessLobby(""); setOpenId(l.id); } catch (e: any) { setErr(e?.message || "Failed"); }
  }
  async function join(id: number) { try { await joinChessLobby(id); setOpenId(id); } catch (e: any) { setErr(e?.message || "Failed"); } }

  if (openId === null) {
    return (
      <div className="w-full h-full flex flex-col text-xs gap-1">
        <div className="flex gap-1 shrink-0">
          <div className="font-bold flex-1">Chess Lobbies</div>
          {user && <button className="win98-button px-2" onClick={newGame}>+ New Game</button>}
        </div>
        {err && <div className="text-red-700">{err}</div>}
        <div className="flex-1 win98-inset bg-white overflow-auto">
          {lobbies.length === 0 ? <div className="text-gray-500 p-2">No active games.</div> :
            lobbies.map(l => (
              <div key={l.id} className="flex items-center gap-1 px-1 py-0.5 border-b">
                <span className="flex-1 truncate">{l.name} — {l.whiteUser || "?"} vs {l.blackUser || "?"}</span>
                <span className="text-[10px] text-gray-500">{l.status}</span>
                <button className="win98-button px-2 text-[10px]" onClick={() => join(l.id)}>Open</button>
              </div>
            ))}
        </div>
      </div>
    );
  }

  if (!game) return <div className="p-2">Loading...</div>;

  const board = fenToBoard(game.fen);
  const myColor = game.whiteUser === user?.username ? "w" : game.blackUser === user?.username ? "b" : null;
  const turn = game.fen.split(" ")[1];
  const myTurn = myColor === turn && game.status === "playing";
  const flip = myColor === "b";

  // legal targets from currently selected square (board coords)
  const targets = new Set<string>();
  if (sel && myTurn) {
    const fromName = squareName(sel.c, sel.r);
    for (const m of legal) if (m.startsWith(fromName)) targets.add(m.slice(2, 4));
  }

  function isOwnPiece(p: string | null): boolean {
    if (!p) return false;
    return turn === "w" ? p === p.toUpperCase() : p === p.toLowerCase();
  }

  async function clickCell(displayR: number, displayC: number) {
    if (!myTurn) return;
    setErr(null);
    const realR = flip ? 7 - displayR : displayR;
    const realC = flip ? 7 - displayC : displayC;
    const piece = board[realR][realC];
    // If clicked own piece — switch selection (or deselect if same square)
    if (isOwnPiece(piece)) {
      if (sel && sel.r === realR && sel.c === realC) { setSel(null); return; }
      setSel({ r: realR, c: realC });
      return;
    }
    // No selection yet and clicked empty/enemy: nothing
    if (!sel) return;
    // Try to move
    const from = squareName(sel.c, sel.r);
    const to = squareName(realC, realR);
    const candidate = from + to;
    // Find a matching legal move (could include promotion suffix)
    const match = legal.find(m => m.startsWith(candidate));
    if (!match) {
      setErr("Illegal move");
      setSel(null);
      return;
    }
    let toSend = match;
    // If pawn promotion, ask
    const movingPiece = board[sel.r][sel.c];
    if (movingPiece && movingPiece.toLowerCase() === "p" && (realR === 0 || realR === 7)) {
      const choice = (window.prompt("Promote to (q/r/b/n)?", "q") || "q").toLowerCase();
      if (["q", "r", "b", "n"].includes(choice)) toSend = candidate + choice;
    }
    try { await moveChess(game!.id, toSend); setSel(null); }
    catch (e: any) { setErr(e?.message || "Illegal"); setSel(null); }
  }

  async function send() { if (!msg.trim()) return; try { await chatChess(game!.id, msg); setMsg(""); } catch {} }

  // Build display rows (flipped if black)
  const rowIndices = flip ? [7,6,5,4,3,2,1,0] : [0,1,2,3,4,5,6,7];
  const colIndices = flip ? [7,6,5,4,3,2,1,0] : [0,1,2,3,4,5,6,7];

  return (
    <div className="w-full h-full flex flex-col text-xs gap-1">
      <div className="flex gap-1 shrink-0 items-center">
        <button className="win98-button px-2" onClick={() => { setOpenId(null); setGame(null); setSel(null); setLegal([]); }}>← Back</button>
        <div className="font-bold flex-1 truncate">♟ {game.whiteUser || "(open)"} (W) vs {game.blackUser || "(open)"} (B)</div>
        {!myColor && user && (game.status === "waiting" || !game.blackUser) && <button className="win98-button px-2" onClick={() => join(game.id)}>Join</button>}
        {myColor && game.status === "playing" && <button className="win98-button px-2" onClick={() => resignChess(game.id)}>Resign</button>}
      </div>
      {game.status === "done" && <div className="text-center font-bold">Winner: {game.winner || "draw"}</div>}
      {err && <div className="text-red-700">{err}</div>}
      <div className="flex gap-1 flex-1 overflow-hidden">
        <div className="aspect-square h-full max-h-full">
          <div className="grid grid-cols-8 grid-rows-8 w-full h-full">
            {rowIndices.flatMap((realR, displayR) => colIndices.map((realC, displayC) => {
              const dark = (realR + realC) % 2 === 1;
              const isSel = sel && sel.r === realR && sel.c === realC;
              const isTarget = targets.has(squareName(realC, realR));
              const p = board[realR][realC];
              return (
                <div key={`${realR}-${realC}`}
                  className={`${dark ? "bg-amber-700" : "bg-amber-100"} flex items-center justify-center text-3xl leading-none cursor-pointer relative ${isSel ? "ring-2 ring-yellow-400 ring-inset" : ""}`}
                  onClick={() => clickCell(displayR, displayC)}>
                  {p && <span style={{
                    color: p === p.toUpperCase() ? "#fafafa" : "#1a1a1a",
                    textShadow: p === p.toUpperCase()
                      ? "0 0 1px #000, 1px 1px 0 #000, -1px -1px 0 #000, 1px -1px 0 #000, -1px 1px 0 #000"
                      : "0 0 1px #fff",
                    fontWeight: 900,
                    lineHeight: 1,
                  }}>{PIECE[p]}</span>}
                  {isTarget && <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                    <div className={`${p ? "border-2 border-green-500 w-full h-full opacity-70" : "w-3 h-3 rounded-full bg-green-500 opacity-60"}`} />
                  </div>}
                </div>
              );
            }))}
          </div>
        </div>
        <div className="w-32 flex flex-col">
          <div className="flex-1 win98-inset bg-white p-1 overflow-auto text-[10px]">
            {(game.chat || []).map((c, i) => <div key={i}><b>{c.author}:</b> {c.body}</div>)}
          </div>
          {user && (
            <div className="flex gap-1 mt-1">
              <input className="win98-inset px-1 flex-1" value={msg} onChange={e => setMsg(e.target.value)} onKeyDown={e => e.key === "Enter" && send()} />
              <button className="win98-button px-1" onClick={send}>↵</button>
            </div>
          )}
        </div>
      </div>
      <div className="text-[10px] text-gray-600 shrink-0">
        Turn: {turn === "w" ? "White" : "Black"}{myTurn && " (your turn)"} · Moves: {(game.moves || []).length}
        {myColor && !myTurn && game.status === "playing" && <span className="ml-2 text-blue-700">Waiting for opponent...</span>}
      </div>
    </div>
  );
}
