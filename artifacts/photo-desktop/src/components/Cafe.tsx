import { useEffect, useRef, useState } from "react";
import { fetchCafeState, moveCafe, sayCafe, setCafeTheme, leaveCafe, type CafePresence } from "../lib/api";
import { useAuth, hasPermission } from "../lib/auth-store";

const THEMES: Record<string, { bg: string; floor: string; label: string }> = {
  cafe: { bg: "#3a2418", floor: "#7a4f31", label: "☕ Cafe" },
  library: { bg: "#1f2a3a", floor: "#3a3a4a", label: "📚 Library" },
  holiday: { bg: "#0a1a2a", floor: "#fff", label: "❄️ Holiday" },
  park: { bg: "#5b8c3a", floor: "#3a6020", label: "🌳 Park" },
  city: { bg: "#222", floor: "#444", label: "🏙 City" },
};
const W = 800, H = 500;

export function Cafe() {
  const user = useAuth(s => s.user);
  const ranks = useAuth(s => s.ranks);
  const refreshRanks = useAuth(s => s.refreshRanks);
  const [presence, setPresence] = useState<CafePresence[]>([]);
  const [chat, setChat] = useState<{ author: string; body: string; createdAt: string }[]>([]);
  const [theme, setTheme] = useState("cafe");
  const [pos, setPos] = useState({ x: 200 + Math.floor(Math.random() * 200), y: 250 });
  const [body, setBody] = useState({ color: "#ffd699", hat: "none" });
  const [msg, setMsg] = useState("");
  const myAvatar = useRef(body);
  myAvatar.current = body;

  useEffect(() => { void refreshRanks(); }, [refreshRanks]);

  useEffect(() => {
    let alive = true;
    const tick = async () => { try { const s = await fetchCafeState(); if (!alive) return; setPresence(s.presence); setChat(s.chat); setTheme(s.theme); } catch {} };
    void tick();
    const t = setInterval(tick, 1500);
    return () => { alive = false; clearInterval(t); };
  }, []);

  useEffect(() => {
    if (!user) return;
    const t = setInterval(() => { moveCafe(pos.x, pos.y, myAvatar.current).catch(() => {}); }, 2000);
    return () => clearInterval(t);
  }, [user, pos]);
  useEffect(() => () => { leaveCafe(); }, []);

  useEffect(() => {
    if (!user) return;
    const onKey = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement)?.tagName === "INPUT") return;
      let dx = 0, dy = 0;
      if (e.key === "ArrowLeft" || e.key === "a") dx = -20;
      if (e.key === "ArrowRight" || e.key === "d") dx = 20;
      if (e.key === "ArrowUp" || e.key === "w") dy = -20;
      if (e.key === "ArrowDown" || e.key === "s") dy = 20;
      if (!dx && !dy) return;
      e.preventDefault();
      setPos(p => ({ x: Math.max(20, Math.min(W - 20, p.x + dx)), y: Math.max(40, Math.min(H - 20, p.y + dy)) }));
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [user]);

  async function send() {
    if (!msg.trim()) return;
    try { await sayCafe(msg); setMsg(""); } catch {}
  }
  async function changeTheme(t: string) { try { await setCafeTheme(t); } catch (e: any) { alert(e?.message || "Failed"); } }
  function clickArea(e: React.MouseEvent<HTMLDivElement>) {
    if (!user) return;
    const r = e.currentTarget.getBoundingClientRect();
    setPos({ x: ((e.clientX - r.left) / r.width) * W, y: ((e.clientY - r.top) / r.height) * H });
  }

  const t = THEMES[theme] || THEMES.cafe;
  const canChangeTheme = user && (user.isAdmin || hasPermission(user, "cafeTheme", ranks));
  const recentSpeech = chat.slice(-12);

  return (
    <div className="w-full h-full flex flex-col text-xs gap-1">
      <div className="flex gap-1 items-center shrink-0">
        <div className="font-bold flex-1">{t.label} — {presence.length} online</div>
        {canChangeTheme && (
          <select className="win98-inset" value={theme} onChange={e => changeTheme(e.target.value)}>
            {Object.entries(THEMES).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
          </select>
        )}
      </div>
      {user && (
        <div className="flex gap-1 items-center shrink-0">
          <span>your color</span><input type="color" value={body.color} onChange={e => setBody({ ...body, color: e.target.value })} />
          <span>hat</span>
          <select className="win98-inset" value={body.hat} onChange={e => setBody({ ...body, hat: e.target.value })}>
            <option value="none">none</option><option value="cap">🧢</option><option value="top">🎩</option><option value="party">🎉</option><option value="crown">👑</option>
          </select>
        </div>
      )}
      <div className="flex-1 win98-inset overflow-hidden relative" style={{ backgroundColor: t.bg }} onClick={clickArea}>
        <div className="absolute inset-x-0 bottom-0 h-2/3" style={{ backgroundColor: t.floor }} />
        {presence.map(p => {
          const isMe = user && p.username === user.username;
          const av: any = isMe ? body : (p.avatar || {});
          const speech = recentSpeech.findLast?.(c => c.author === p.username);
          const x = isMe ? pos.x : p.x, y = isMe ? pos.y : p.y;
          return (
            <div key={p.username} className="absolute flex flex-col items-center" style={{ left: `${(x / W) * 100}%`, top: `${(y / H) * 100}%`, transform: "translate(-50%, -100%)" }}>
              {speech && (Date.now() - new Date(speech.createdAt).getTime() < 8000) && (
                <div className="bg-white border border-black px-1 mb-1 max-w-[120px] text-[10px] rounded">{speech.body}</div>
              )}
              <div className="text-white text-[10px] font-bold">{p.username}</div>
              <div className="relative">
                <div style={{ width: 24, height: 28, background: av.color || "#ffd699", borderRadius: "50% 50% 30% 30%" }} />
                {av.hat === "cap" && <div className="absolute -top-2 left-0 right-0 text-center">🧢</div>}
                {av.hat === "top" && <div className="absolute -top-3 left-0 right-0 text-center">🎩</div>}
                {av.hat === "party" && <div className="absolute -top-3 left-0 right-0 text-center">🎉</div>}
                {av.hat === "crown" && <div className="absolute -top-3 left-0 right-0 text-center">👑</div>}
              </div>
              <div style={{ width: 24, height: 12, background: "#3060a0", marginTop: 1 }} />
            </div>
          );
        })}
      </div>
      {user ? (
        <div className="flex gap-1 shrink-0">
          <input className="win98-inset px-1 flex-1" placeholder="Say something... (or use arrows / click to walk)" value={msg} onChange={e => setMsg(e.target.value)} onKeyDown={e => e.key === "Enter" && send()} />
          <button className="win98-button px-2" onClick={send}>Say</button>
        </div>
      ) : <div className="text-gray-500">Log in to join the cafe.</div>}
    </div>
  );
}
