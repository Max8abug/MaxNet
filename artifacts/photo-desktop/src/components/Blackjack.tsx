import { useEffect, useState } from "react";
import { bjState, bjJoin, bjLeave, bjDeal, bjHit, bjStand, type BJState } from "../lib/api";
import { useAuth } from "../lib/auth-store";
import { Avatar } from "./Avatar";

interface Props { onRequestLogin?: () => void; }

function Card({ c }: { c: { r: string; s: string } }) {
  const red = c.s === "♥" || c.s === "♦";
  const isHidden = c.r === "?";
  return (
    <div className={`inline-flex flex-col items-center justify-center w-10 h-14 rounded border border-black bg-white shadow-sm font-bold mr-1 ${red ? "text-red-700" : "text-black"} ${isHidden ? "bg-blue-800 text-white" : ""}`}>
      {isHidden ? (
        <div className="text-lg">★</div>
      ) : (
        <>
          <div className="text-sm leading-none">{c.r}</div>
          <div className="text-base leading-none">{c.s}</div>
        </>
      )}
    </div>
  );
}

export function Blackjack({ onRequestLogin }: Props) {
  const [s, setS] = useState<BJState | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const user = useAuth((u) => u.user);

  async function refresh() {
    try { setS(await bjState()); } catch {}
  }
  useEffect(() => { void refresh(); const t = setInterval(refresh, 2500); return () => clearInterval(t); }, []);

  async function call(fn: () => Promise<BJState>) {
    if (!user) { onRequestLogin?.(); return; }
    setBusy(true); setErr(null);
    try { setS(await fn()); }
    catch (e: any) { setErr(e?.message || "Failed"); }
    finally { setBusy(false); }
  }

  const me = s?.players.find((p) => p.username === user?.username);
  const myTurn = s && user && s.phase === "playing" && s.players[s.currentTurn]?.username === user.username;
  const joined = !!me;

  return (
    <div className="w-full h-full flex flex-col text-sm bg-[#0a5d2c] text-white p-2 gap-2">
      <div className="flex items-center gap-2 shrink-0">
        <div className="font-bold">BLACKJACK</div>
        <div className="text-xs opacity-75">phase: {s?.phase ?? "..."} · deck: {s?.deckRemaining ?? 0}</div>
        <div className="flex-1" />
        {user ? (
          joined
            ? <button className="win98-button text-black px-2 py-0.5 text-xs" disabled={busy} onClick={() => call(bjLeave)}>Leave</button>
            : <button className="win98-button text-black px-2 py-0.5 text-xs" disabled={busy} onClick={() => call(bjJoin)}>Sit Down</button>
        ) : (
          <button className="win98-button text-black px-2 py-0.5 text-xs" onClick={onRequestLogin}>Log in to play</button>
        )}
      </div>

      {/* Dealer */}
      <div className="bg-black/30 rounded p-2">
        <div className="text-xs mb-1">Dealer ({s?.dealerValue ?? 0})</div>
        <div>{s?.dealerHand.map((c, i) => <Card key={i} c={c} />)}</div>
      </div>

      {/* Players */}
      <div className="flex-1 overflow-auto bg-black/20 rounded p-2 flex flex-col gap-2">
        {(!s || s.players.length === 0) && <div className="text-xs opacity-70">No players seated. Click Sit Down to join.</div>}
        {s?.players.map((p, idx) => (
          <div key={p.username} className={`p-1 rounded ${idx === s.currentTurn && s.phase === "playing" ? "ring-2 ring-yellow-400" : ""} ${p.username === user?.username ? "bg-white/10" : ""}`}>
            <div className="flex items-center gap-1 text-xs">
              <Avatar username={p.username} size={20} />
              <span className="font-bold">{p.username}</span>
              <span className="opacity-75">— {p.value}</span>
              <span className={`ml-auto uppercase text-[10px] px-1 rounded ${
                p.status === "win" || p.status === "blackjack" ? "bg-green-600" :
                p.status === "lose" || p.status === "bust" ? "bg-red-700" :
                p.status === "push" ? "bg-yellow-600" : "bg-gray-600"
              }`}>{p.status}</span>
            </div>
            <div className="mt-1">{p.hand.map((c, i) => <Card key={i} c={c} />)}</div>
          </div>
        ))}
      </div>

      {/* Controls */}
      <div className="shrink-0 flex flex-wrap gap-1">
        {s?.phase === "waiting" || s?.phase === "done" ? (
          <button className="win98-button text-black px-3 py-1 text-xs" disabled={busy || !joined} onClick={() => call(bjDeal)}>
            Deal {s?.players.length ? `(${s.players.length})` : ""}
          </button>
        ) : null}
        {myTurn && (
          <>
            <button className="win98-button text-black px-3 py-1 text-xs" disabled={busy} onClick={() => call(bjHit)}>Hit</button>
            <button className="win98-button text-black px-3 py-1 text-xs" disabled={busy} onClick={() => call(bjStand)}>Stand</button>
          </>
        )}
        {!myTurn && s?.phase === "playing" && joined && (
          <div className="text-xs self-center opacity-75">Waiting on {s.players[s.currentTurn]?.username}...</div>
        )}
      </div>

      {/* Log */}
      <div className="shrink-0 max-h-20 overflow-auto bg-black/40 rounded p-1 text-[10px] font-mono">
        {s?.log.slice().reverse().map((l, i) => <div key={i}>{l}</div>)}
      </div>

      {err && <div className="text-yellow-300 text-xs">{err}</div>}
    </div>
  );
}
