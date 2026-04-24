import { useEffect, useState } from "react";
import { fetchChessLobbies, createChessLobby, fetchChessLobby, joinChessLobby, moveChess, resignChess, chatChess, type ChessLobby } from "../lib/api";
import { useAuth } from "../lib/auth-store";

const PIECE: Record<string, string> = { K: "♔", Q: "♕", R: "♖", B: "♗", N: "♘", P: "♙", k: "♚", q: "♛", r: "♜", b: "♝", n: "♞", p: "♟" };

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

export function Chess() {
  const user = useAuth(s => s.user);
  const [lobbies, setLobbies] = useState<ChessLobby[]>([]);
  const [openId, setOpenId] = useState<number | null>(null);
  const [game, setGame] = useState<ChessLobby | null>(null);
  const [sel, setSel] = useState<{ r: number; c: number } | null>(null);
  const [msg, setMsg] = useState("");
  const [err, setErr] = useState<string | null>(null);

  async function refresh() { try { setLobbies(await fetchChessLobbies()); } catch {} }
  useEffect(() => { void refresh(); const t = setInterval(refresh, 4000); return () => clearInterval(t); }, []);
  useEffect(() => {
    if (openId === null) return;
    const tick = async () => { try { setGame(await fetchChessLobby(openId)); } catch {} };
    void tick(); const t = setInterval(tick, 2000); return () => clearInterval(t);
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
  const rows = flip ? [...board].reverse() : board;

  function squareName(r: number, c: number) {
    const realR = flip ? 7 - r : r;
    const realC = flip ? 7 - c : c;
    return `${String.fromCharCode(97 + realC)}${8 - realR}`;
  }

  async function clickCell(r: number, c: number) {
    if (!myTurn) return;
    const realR = flip ? 7 - r : r;
    const realC = flip ? 7 - c : c;
    const piece = board[realR][realC];
    if (sel) {
      const fromR = flip ? 7 - sel.r : sel.r, fromC = flip ? 7 - sel.c : sel.c;
      if (fromR === realR && fromC === realC) { setSel(null); return; }
      const from = `${String.fromCharCode(97 + fromC)}${8 - fromR}`;
      const to = squareName(r, c);
      try { await moveChess(game!.id, from + to); setSel(null); }
      catch (e: any) { setErr(e?.message || "illegal"); setSel(null); }
    } else if (piece && ((turn === "w" && piece === piece.toUpperCase()) || (turn === "b" && piece === piece.toLowerCase()))) {
      setSel({ r, c });
    }
  }

  async function send() { if (!msg.trim()) return; try { await chatChess(game!.id, msg); setMsg(""); } catch {} }

  return (
    <div className="w-full h-full flex flex-col text-xs gap-1">
      <div className="flex gap-1 shrink-0 items-center">
        <button className="win98-button px-2" onClick={() => { setOpenId(null); setGame(null); setSel(null); }}>← Back</button>
        <div className="font-bold flex-1 truncate">♟ {game.whiteUser || "(open)"} (W) vs {game.blackUser || "(open)"} (B)</div>
        {!myColor && user && (game.status === "waiting" || !game.blackUser) && <button className="win98-button px-2" onClick={() => join(game.id)}>Join</button>}
        {myColor && game.status === "playing" && <button className="win98-button px-2" onClick={() => resignChess(game.id)}>Resign</button>}
      </div>
      {game.status === "done" && <div className="text-center font-bold">Winner: {game.winner || "draw"}</div>}
      {err && <div className="text-red-700">{err}</div>}
      <div className="flex gap-1 flex-1 overflow-hidden">
        <div className="aspect-square h-full max-h-full">
          <div className="grid grid-cols-8 grid-rows-8 w-full h-full">
            {rows.flatMap((row, r) => row.map((p, c) => {
              const dark = (r + c) % 2 === 1;
              const isSel = sel && sel.r === r && sel.c === c;
              return (
                <div key={`${r}-${c}`} className={`${dark ? "bg-amber-700" : "bg-amber-100"} flex items-center justify-center text-xl cursor-pointer ${isSel ? "ring-2 ring-yellow-400" : ""}`} onClick={() => clickCell(r, c)}>
                  {p && <span style={{ color: p === p.toUpperCase() ? "#fff" : "#000", textShadow: p === p.toUpperCase() ? "0 0 2px #000" : "none" }}>{PIECE[p]}</span>}
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
      <div className="text-[10px] text-gray-600 shrink-0">Turn: {turn === "w" ? "White" : "Black"}{myTurn && " (your turn)"} · Moves: {(game.moves || []).length}</div>
    </div>
  );
}
