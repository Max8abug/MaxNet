import { useEffect, useState } from "react";
import { bjState, bjJoin, bjLeave, bjDeal, bjHit, bjStand, bjSkip, bjReset, type BJState } from "../lib/api";
import { useAuth, hasPermission } from "../lib/auth-store";
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
  const [now, setNow] = useState(Date.now());
  const user = useAuth((u) => u.user);
  const ranks = useAuth((u) => u.ranks);
  const refreshRanks = useAuth((u) => u.refreshRanks);
  const isMod = !!user && (user.isAdmin || hasPermission(user, "deleteMessages", ranks));

  async function refresh() {
    try { setS(await bjState()); } catch {}
  }
  useEffect(() => { void refreshRanks(); }, [refreshRanks]);
  useEffect(() => { void refresh(); const t = setInterval(refresh, 2500); return () => clearInterval(t); }, []);
  // Tick every second so the AFK countdown updates smoothly.
  useEffect(() => { const t = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(t); }, []);

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
  // Match the server-side TURN_TIMEOUT_MS (20s) so the UI countdown matches when skip becomes legal.
  const turnElapsed = s?.turnStartedAt && s?.serverNow ? (now - s.serverNow) + (s.serverNow - s.turnStartedAt) : 0;
  const skipReadyIn = Math.max(0, Math.ceil((20_000 - turnElapsed) / 1000));
  const canSkipNow = s?.phase === "playing" && (myTurn || isMod || (joined && skipReadyIn === 0));
  const stuckSeconds = Math.floor(turnElapsed / 1000);
  const canResetNow = isMod || (joined && (s?.phase === "playing" || s?.phase === "dealer") && stuckSeconds >= 60);

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
          <div className="text-xs self-center opacity-75">
            Waiting on {s.players[s.currentTurn]?.username}…
            {skipReadyIn > 0
              ? <> (skip available in {skipReadyIn}s)</>
              : <> — they look AFK, you can skip them.</>}
          </div>
        )}
        {canSkipNow && !myTurn && (
          <button className="win98-button text-black px-3 py-1 text-xs" disabled={busy} onClick={() => call(bjSkip)} title="Skip the current AFK player (auto-stand)">Skip Player</button>
        )}
        {canResetNow && (
          <button className="win98-button text-black px-3 py-1 text-xs ml-auto" disabled={busy} onClick={() => { if (confirm("Reset the table? This clears the current hand but keeps players seated.")) void call(bjReset); }} title={isMod ? "Reset the table (mod)" : "Reset the stuck table"}>
            Clear / Reset
          </button>
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
