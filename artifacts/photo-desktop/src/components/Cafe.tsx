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

function Background({ theme }: { theme: string }) {
  if (theme === "cafe") {
    return (
      <>
        {/* warm lights */}
        <div className="absolute inset-x-0 top-0 h-1/3" style={{ background: "linear-gradient(to bottom, #2d1810 0%, #4a2c1a 100%)" }} />
        {/* hanging lamps */}
        {[15, 50, 85].map((x) => (
          <div key={x} className="absolute" style={{ left: `${x}%`, top: 0, transform: "translateX(-50%)" }}>
            <div className="w-px h-8 bg-black/60 mx-auto" />
            <div className="w-6 h-3 rounded-b-full" style={{ background: "#3a1a0a", boxShadow: "0 6px 20px rgba(255,200,80,0.4)" }} />
            <div className="w-10 h-10 rounded-full -mt-1 mx-auto opacity-30" style={{ background: "radial-gradient(ellipse, #ffd070 0%, transparent 70%)" }} />
          </div>
        ))}
        {/* shelves with cups */}
        <div className="absolute left-3 top-[35%] w-32 h-1 bg-[#2a1810]" />
        <div className="absolute left-4 top-[30%] flex gap-1 text-base">☕☕🍰🥐</div>
        <div className="absolute right-3 top-[35%] w-32 h-1 bg-[#2a1810]" />
        <div className="absolute right-4 top-[30%] flex gap-1 text-base">🫖🥧☕🍪</div>
        {/* espresso bar */}
        <div className="absolute left-1/2 top-[42%] -translate-x-1/2 text-3xl">☕</div>
      </>
    );
  }
  if (theme === "library") {
    return (
      <>
        {/* bookshelves */}
        <div className="absolute inset-x-0 top-0 h-2/3 grid grid-cols-8" style={{ background: "linear-gradient(to bottom, #2a1f15 0%, #1a1410 100%)" }}>
          {Array.from({ length: 32 }).map((_, i) => {
            const colors = ["#7d3a3a", "#3a5d7d", "#5d7d3a", "#7d5d3a", "#3a7d5d", "#7d3a5d"];
            return <div key={i} className="border-r border-black/30" style={{ backgroundColor: colors[i % colors.length], height: i % 4 === 0 ? "100%" : "85%" }} />;
          })}
        </div>
        {/* desk lamps */}
        <div className="absolute left-1/4 top-[58%] text-xl">💡</div>
        <div className="absolute right-1/4 top-[58%] text-xl">💡</div>
        {/* shelf labels */}
        <div className="absolute inset-x-0 top-[20%] text-center text-[8px] text-amber-200/40 font-bold">— SECTION A —</div>
        <div className="absolute inset-x-0 top-[45%] text-center text-[8px] text-amber-200/40 font-bold">— REFERENCE —</div>
      </>
    );
  }
  if (theme === "holiday") {
    return (
      <>
        {/* night sky */}
        <div className="absolute inset-0" style={{ background: "linear-gradient(to bottom, #0a1530 0%, #1a2a50 70%, #2a3a60 100%)" }} />
        {/* stars */}
        {[[10,8],[20,15],[35,5],[50,12],[65,8],[80,18],[90,6],[15,25],[42,22],[72,28]].map(([x,y],i) => (
          <div key={i} className="absolute text-white text-[6px]" style={{ left: `${x}%`, top: `${y}%` }}>✦</div>
        ))}
        {/* falling snow */}
        {Array.from({ length: 20 }).map((_, i) => (
          <div key={i} className="absolute text-white text-xs opacity-70" style={{ left: `${(i * 53) % 100}%`, top: `${(i * 37) % 60}%`, animation: `fall ${3 + (i % 4)}s linear infinite`, animationDelay: `${i * 0.3}s` }}>❄</div>
        ))}
        {/* tree */}
        <div className="absolute left-8 bottom-[35%] flex flex-col items-center text-4xl">🎄</div>
        <div className="absolute right-12 bottom-[35%] flex flex-col items-center text-3xl">🎁🎁</div>
        {/* string lights */}
        <div className="absolute inset-x-0 top-[8%] text-center" style={{ letterSpacing: "1.2em" }}>🟡🔴🟢🔵🟡🔴🟢🔵🟡🔴🟢🔵</div>
        <style>{`@keyframes fall { from { transform: translateY(-20px); } to { transform: translateY(400px); } }`}</style>
      </>
    );
  }
  if (theme === "park") {
    return (
      <>
        <div className="absolute inset-x-0 top-0 h-2/5" style={{ background: "linear-gradient(to bottom, #87ceeb 0%, #b8e0ff 100%)" }} />
        {/* sun */}
        <div className="absolute right-10 top-6 text-3xl">☀️</div>
        {/* clouds */}
        <div className="absolute left-[20%] top-8 text-2xl opacity-90">☁️</div>
        <div className="absolute left-[60%] top-12 text-xl opacity-80">☁️</div>
        {/* trees */}
        <div className="absolute left-4 bottom-[28%] text-4xl">🌳</div>
        <div className="absolute left-1/3 bottom-[30%] text-3xl">🌲</div>
        <div className="absolute right-1/4 bottom-[28%] text-4xl">🌳</div>
        <div className="absolute right-6 bottom-[30%] text-3xl">🌲</div>
        {/* flowers */}
        <div className="absolute inset-x-0 bottom-[15%] flex justify-around text-base">🌸🌼🌷🌻🌺🌸🌼🌷</div>
        {/* benches */}
        <div className="absolute left-1/4 bottom-[20%] text-xl">🪑</div>
        <div className="absolute right-1/3 bottom-[20%] text-xl">🪑</div>
      </>
    );
  }
  if (theme === "city") {
    return (
      <>
        <div className="absolute inset-0" style={{ background: "linear-gradient(to bottom, #0a0e1a 0%, #1a1530 50%, #2a1a3a 100%)" }} />
        {/* moon */}
        <div className="absolute right-8 top-4 w-8 h-8 rounded-full bg-yellow-100 opacity-90" style={{ boxShadow: "0 0 20px rgba(255,255,200,0.5)" }} />
        {/* skyline silhouette */}
        <div className="absolute inset-x-0 bottom-1/3 h-1/3 flex items-end">
          {[60, 90, 50, 110, 70, 130, 80, 100, 60].map((h, i) => (
            <div key={i} className="flex-1 bg-black/80 mx-px relative" style={{ height: `${h}%` }}>
              {Array.from({ length: Math.floor(h / 15) }).map((_, j) => (
                <div key={j} className="absolute w-1 h-1 bg-yellow-200" style={{ left: `${(j * 23) % 60 + 10}%`, top: `${(j * 17) % 70 + 10}%`, opacity: 0.8 }} />
              ))}
            </div>
          ))}
        </div>
        {/* neon */}
        <div className="absolute left-[10%] top-[50%] text-pink-400 text-[10px] font-bold" style={{ textShadow: "0 0 6px rgba(255,100,200,0.9)" }}>OPEN</div>
        <div className="absolute right-[15%] top-[55%] text-cyan-300 text-[10px] font-bold" style={{ textShadow: "0 0 6px rgba(100,200,255,0.9)" }}>BAR</div>
        {/* street lamp */}
        <div className="absolute left-1/2 bottom-[30%] -translate-x-1/2 text-xl">🏙</div>
      </>
    );
  }
  return null;
}

function CharacterEditor({ initialColor, initialHat, initialAccessory, onSave, onCancel }: {
  initialColor: string;
  initialHat: string;
  initialAccessory: string | null;
  onSave: (color: string, hat: string, accessory: string | null) => void;
  onCancel: () => void;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [color, setColor] = useState(initialColor);
  const [hat, setHat] = useState(initialHat);
  const [tool, setTool] = useState<"pen" | "erase">("pen");
  const [strokeColor, setStrokeColor] = useState("#ff3030");
  const [strokeWidth, setStrokeWidth] = useState(3);
  const drawing = useRef(false);
  const last = useRef<{ x: number; y: number } | null>(null);

  // Restore previous accessory drawing if present
  useEffect(() => {
    const c = canvasRef.current; if (!c) return;
    const ctx = c.getContext("2d")!;
    ctx.clearRect(0, 0, c.width, c.height);
    if (initialAccessory) {
      const img = new Image();
      img.onload = () => ctx.drawImage(img, 0, 0, c.width, c.height);
      img.src = initialAccessory;
    }
  }, [initialAccessory]);

  function getPos(e: React.PointerEvent) {
    const c = canvasRef.current!; const r = c.getBoundingClientRect();
    return { x: ((e.clientX - r.left) / r.width) * c.width, y: ((e.clientY - r.top) / r.height) * c.height };
  }
  function pd(e: React.PointerEvent) { e.preventDefault(); drawing.current = true; last.current = getPos(e); (e.target as HTMLElement).setPointerCapture(e.pointerId); }
  function pm(e: React.PointerEvent) {
    if (!drawing.current) return;
    const c = canvasRef.current!; const ctx = c.getContext("2d")!;
    const p = getPos(e);
    ctx.lineCap = "round"; ctx.lineJoin = "round";
    if (tool === "erase") {
      ctx.globalCompositeOperation = "destination-out";
      ctx.strokeStyle = "#000"; ctx.lineWidth = strokeWidth * 4;
    } else {
      ctx.globalCompositeOperation = "source-over";
      ctx.strokeStyle = strokeColor; ctx.lineWidth = strokeWidth;
    }
    ctx.beginPath(); ctx.moveTo(last.current!.x, last.current!.y); ctx.lineTo(p.x, p.y); ctx.stroke();
    last.current = p;
  }
  function pu(e: React.PointerEvent) { drawing.current = false; last.current = null; try { (e.target as HTMLElement).releasePointerCapture(e.pointerId); } catch {} }

  function clearAll() { const c = canvasRef.current!; c.getContext("2d")!.clearRect(0, 0, c.width, c.height); }

  function save() {
    const c = canvasRef.current!;
    // Detect if canvas has any content
    const ctx = c.getContext("2d")!;
    const data = ctx.getImageData(0, 0, c.width, c.height).data;
    let hasInk = false;
    for (let i = 3; i < data.length; i += 4) if (data[i] > 0) { hasInk = true; break; }
    onSave(color, hat, hasInk ? c.toDataURL("image/png") : null);
  }

  return (
    <div className="fixed inset-0 z-[1100] flex items-center justify-center bg-black/40" onPointerDown={(e) => { if (e.target === e.currentTarget) onCancel(); }}>
      <div className="win98-window bg-[#c0c0c0] flex flex-col" style={{ width: 360 }} onPointerDown={(e) => e.stopPropagation()}>
        <div className="bg-[#000080] text-white px-2 py-1 flex items-center justify-between text-sm">
          <span>Customize Character</span>
          <button className="win98-button px-1.5 leading-none" onClick={onCancel}>x</button>
        </div>
        <div className="p-2 flex flex-col gap-2 text-xs">
          <div className="flex items-center gap-2">
            <span>Body color</span>
            <input type="color" value={color} onChange={(e) => setColor(e.target.value)} />
            <span>Hat</span>
            <select className="win98-inset" value={hat} onChange={(e) => setHat(e.target.value)}>
              <option value="none">none</option><option value="cap">🧢</option><option value="top">🎩</option><option value="party">🎉</option><option value="crown">👑</option>
            </select>
          </div>
          <div className="text-[10px] text-gray-700">Draw clothes, hair, accessories on top of and around your character. Save when done.</div>
          <div className="flex gap-1 items-center">
            <button className={`win98-button px-2 ${tool === "pen" ? "shadow-[inset_1px_1px_#808080] border-t-black border-l-black border-r-white border-b-white" : ""}`} onClick={() => setTool("pen")}>Pen</button>
            <button className={`win98-button px-2 ${tool === "erase" ? "shadow-[inset_1px_1px_#808080] border-t-black border-l-black border-r-white border-b-white" : ""}`} onClick={() => setTool("erase")}>Eraser</button>
            <input type="color" value={strokeColor} onChange={(e) => setStrokeColor(e.target.value)} />
            <input type="range" min={1} max={20} value={strokeWidth} onChange={(e) => setStrokeWidth(Number(e.target.value))} className="flex-1" />
            <button className="win98-button px-2" onClick={clearAll}>Clear</button>
          </div>
          <div className="relative win98-inset bg-white" style={{ width: 320, height: 320 }}>
            {/* Character preview underneath */}
            <div className="absolute inset-0 flex items-end justify-center pb-4 pointer-events-none">
              <div className="flex flex-col items-center">
                <div className="relative">
                  <div style={{ width: 80, height: 96, background: color, borderRadius: "50% 50% 30% 30%" }} />
                  {hat === "cap" && <div className="absolute -top-6 left-0 right-0 text-center text-3xl">🧢</div>}
                  {hat === "top" && <div className="absolute -top-7 left-0 right-0 text-center text-3xl">🎩</div>}
                  {hat === "party" && <div className="absolute -top-7 left-0 right-0 text-center text-3xl">🎉</div>}
                  {hat === "crown" && <div className="absolute -top-7 left-0 right-0 text-center text-3xl">👑</div>}
                </div>
                <div style={{ width: 80, height: 40, background: "#3060a0", marginTop: 2 }} />
              </div>
            </div>
            <canvas
              ref={canvasRef}
              width={320}
              height={320}
              className="absolute inset-0 w-full h-full touch-none"
              style={{ touchAction: "none", cursor: "crosshair" }}
              onPointerDown={pd}
              onPointerMove={pm}
              onPointerUp={pu}
              onPointerCancel={pu}
            />
          </div>
          <div className="flex gap-1 justify-end">
            <button className="win98-button px-3" onClick={onCancel}>Cancel</button>
            <button className="win98-button px-3 font-bold" onClick={save}>Save Character</button>
          </div>
        </div>
      </div>
    </div>
  );
}

export function Cafe() {
  const user = useAuth(s => s.user);
  const ranks = useAuth(s => s.ranks);
  const refreshRanks = useAuth(s => s.refreshRanks);
  const [presence, setPresence] = useState<CafePresence[]>([]);
  const [chat, setChat] = useState<{ author: string; body: string; createdAt: string }[]>([]);
  const [theme, setTheme] = useState("cafe");
  const [pos, setPos] = useState({ x: 200 + Math.floor(Math.random() * 200), y: 250 });
  const [body, setBody] = useState<{ color: string; hat: string; accessory: string | null }>({ color: "#ffd699", hat: "none", accessory: null });
  const [msg, setMsg] = useState("");
  const [editing, setEditing] = useState(false);
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
  // Send immediate update when avatar changes
  useEffect(() => {
    if (!user) return;
    moveCafe(pos.x, pos.y, body).catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [body.color, body.hat, body.accessory]);
  useEffect(() => () => { leaveCafe(); }, []);

  useEffect(() => {
    if (!user) return;
    const onKey = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement)?.tagName === "INPUT") return;
      if (editing) return;
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
  }, [user, editing]);

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
        {user && <button className="win98-button px-2" onClick={() => setEditing(true)}>🎨 Customize Character</button>}
        {canChangeTheme && (
          <select className="win98-inset" value={theme} onChange={e => changeTheme(e.target.value)}>
            {Object.entries(THEMES).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
          </select>
        )}
      </div>
      <div className="flex-1 win98-inset overflow-hidden relative" style={{ backgroundColor: t.bg }} onClick={clickArea}>
        <Background theme={theme} />
        <div className="absolute inset-x-0 bottom-0 h-1/3" style={{ backgroundColor: t.floor, opacity: 0.95 }} />
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
              <div className="text-white text-[10px] font-bold" style={{ textShadow: "1px 1px 2px black" }}>{p.username}</div>
              <div className="relative" style={{ width: 32, height: 50 }}>
                <div className="absolute" style={{ left: 4, top: 0, width: 24, height: 28, background: av.color || "#ffd699", borderRadius: "50% 50% 30% 30%" }} />
                <div className="absolute" style={{ left: 4, top: 28, width: 24, height: 14, background: "#3060a0" }} />
                {av.hat === "cap" && <div className="absolute -top-2 left-0 right-0 text-center">🧢</div>}
                {av.hat === "top" && <div className="absolute -top-3 left-0 right-0 text-center">🎩</div>}
                {av.hat === "party" && <div className="absolute -top-3 left-0 right-0 text-center">🎉</div>}
                {av.hat === "crown" && <div className="absolute -top-3 left-0 right-0 text-center">👑</div>}
                {av.accessory && (
                  <img src={av.accessory} alt="" className="absolute" style={{ left: -16, top: -16, width: 64, height: 64, pointerEvents: "none", imageRendering: "pixelated" }} />
                )}
              </div>
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

      {editing && user && (
        <CharacterEditor
          initialColor={body.color}
          initialHat={body.hat}
          initialAccessory={body.accessory}
          onSave={(color, hat, accessory) => { setBody({ color, hat, accessory }); setEditing(false); }}
          onCancel={() => setEditing(false)}
        />
      )}
    </div>
  );
}
