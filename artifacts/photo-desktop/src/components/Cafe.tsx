import { useEffect, useMemo, useRef, useState } from "react";
import {
  fetchCafeState, moveCafe, sayCafe, setCafeTheme, leaveCafe,
  fetchCafeRooms, createCafeRoom, deleteCafeRoom,
  fetchCafeObjects, createCafeObject, updateCafeObject, deleteCafeObject,
  type CafePresence, type CafeRoom, type CafeObject, type CafeObjectAction,
} from "../lib/api";
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

// In-game character cell is 32×50 for the BODY silhouette, plus a 20px
// HEAD_PAD area above the head where the user can draw hats / horns / antennae
// / hair tufts. The whole accessory drawing area is therefore 32×70.
//
// CharacterCell renders into a 32×70 box: the body silhouette is anchored at
// the BOTTOM (so the feet still sit at the bottom of the wrapper, which is
// what the cafe positions against). The 20px above is reserved for headwear.
//
// Editor saves the PNG at ACCESSORY_W*SCALE × ACCESSORY_H*SCALE; in-game we
// render it back at native ACCESSORY_W × ACCESSORY_H — so a pixel drawn in the
// editor lands at the exact same spot on the avatar.
const CELL_W = 32;
const CELL_H = 50;
const HEAD_PAD = 20;
const ACCESSORY_W = CELL_W;
const ACCESSORY_H = CELL_H + HEAD_PAD; // 70
const EDITOR_SCALE = 9;
const EDITOR_CANVAS_W = ACCESSORY_W * EDITOR_SCALE; // 288
const EDITOR_CANVAS_H = ACCESSORY_H * EDITOR_SCALE; // 630

function CharacterCell({ color, hat, accessoryUrl }: { color: string; hat: string; accessoryUrl: string | null }) {
  // The single source of truth for what a character looks like. Used by the
  // in-game cafe (scale 1) and by the editor preview (wrapped in a CSS
  // transform: scale(EDITOR_SCALE)). The body silhouette lives in the bottom
  // CELL_H of the box; the top HEAD_PAD is reserved for headwear drawings.
  return (
    <>
      <div className="absolute" style={{ left: 4, top: HEAD_PAD + 0,  width: 24, height: 28, background: color || "#ffd699", borderRadius: "50% 50% 30% 30%" }} />
      <div className="absolute" style={{ left: 4, top: HEAD_PAD + 28, width: 24, height: 14, background: "#3060a0" }} />
      {hat === "cap"   && <div className="absolute left-0 right-0 text-center leading-none" style={{ top: HEAD_PAD - 8 }}>🧢</div>}
      {hat === "top"   && <div className="absolute left-0 right-0 text-center leading-none" style={{ top: HEAD_PAD - 12 }}>🎩</div>}
      {hat === "party" && <div className="absolute left-0 right-0 text-center leading-none" style={{ top: HEAD_PAD - 12 }}>🎉</div>}
      {hat === "crown" && <div className="absolute left-0 right-0 text-center leading-none" style={{ top: HEAD_PAD - 12 }}>👑</div>}
      {accessoryUrl && (
        <img
          src={accessoryUrl}
          alt=""
          className="absolute pointer-events-none select-none"
          style={{ left: 0, top: 0, width: ACCESSORY_W, height: ACCESSORY_H }}
          draggable={false}
        />
      )}
    </>
  );
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
  const [strokeWidth, setStrokeWidth] = useState(8);
  const drawing = useRef(false);
  const last = useRef<{ x: number; y: number } | null>(null);

  // Responsive display scale: the canvas backing buffer always stays at
  // EDITOR_CANVAS_W × EDITOR_CANVAS_H so saved drawings keep full resolution,
  // but the on-screen size shrinks to fit smaller viewports. We reserve room
  // for the modal chrome (header, toolbar rows, save buttons, paddings) when
  // computing the available height.
  const MODAL_CHROME_H = 220; // header + tool rows + save row + paddings
  const MODAL_CHROME_W = 32;  // horizontal paddings inside the window
  const [displayScale, setDisplayScale] = useState(EDITOR_SCALE);
  useEffect(() => {
    function recompute() {
      const vw = window.innerWidth;
      const vh = window.innerHeight;
      const maxW = Math.max(120, vw - MODAL_CHROME_W);
      const maxH = Math.max(180, vh - MODAL_CHROME_H);
      const s = Math.min(EDITOR_SCALE, maxW / ACCESSORY_W, maxH / ACCESSORY_H);
      setDisplayScale(Math.max(1.5, s));
    }
    recompute();
    window.addEventListener("resize", recompute);
    window.addEventListener("orientationchange", recompute);
    return () => {
      window.removeEventListener("resize", recompute);
      window.removeEventListener("orientationchange", recompute);
    };
  }, []);
  const dispW = ACCESSORY_W * displayScale;
  const dispH = ACCESSORY_H * displayScale;

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
    const ctx = c.getContext("2d")!;
    const data = ctx.getImageData(0, 0, c.width, c.height).data;
    let hasInk = false;
    for (let i = 3; i < data.length; i += 4) if (data[i] > 0) { hasInk = true; break; }
    onSave(color, hat, hasInk ? c.toDataURL("image/png") : null);
  }

  return (
    <div className="fixed inset-0 z-[1100] flex items-center justify-center bg-black/40 p-2 overflow-auto" onPointerDown={(e) => { if (e.target === e.currentTarget) onCancel(); }}>
      <div
        className="win98-window bg-[#c0c0c0] flex flex-col"
        style={{ width: "min(360px, 100%)", maxHeight: "calc(100dvh - 16px)" }}
        onPointerDown={(e) => e.stopPropagation()}
      >
        <div className="bg-[#000080] text-white px-2 py-1 flex items-center justify-between text-sm shrink-0">
          <span>Customize Character</span>
          <button className="win98-button px-1.5 leading-none" onClick={onCancel}>x</button>
        </div>
        <div className="p-2 flex flex-col gap-2 text-xs overflow-y-auto">
          <div className="flex items-center gap-2 flex-wrap">
            <span>Body color</span>
            <input type="color" value={color} onChange={(e) => setColor(e.target.value)} />
            <span>Hat</span>
            <select className="win98-inset" value={hat} onChange={(e) => setHat(e.target.value)}>
              <option value="none">none</option><option value="cap">🧢</option><option value="top">🎩</option><option value="party">🎉</option><option value="crown">👑</option>
            </select>
          </div>
          <div className="text-[10px] text-gray-700">Draw on top of your character — the area <b>above</b> the head is for hats / hair / antennae, the body area is for clothes & face. Maps 1:1 onto the in-game character.</div>
          <div className="flex gap-1 items-center flex-wrap">
            <button className={`win98-button px-2 ${tool === "pen" ? "shadow-[inset_1px_1px_#808080] border-t-black border-l-black border-r-white border-b-white" : ""}`} onClick={() => setTool("pen")}>Pen</button>
            <button className={`win98-button px-2 ${tool === "erase" ? "shadow-[inset_1px_1px_#808080] border-t-black border-l-black border-r-white border-b-white" : ""}`} onClick={() => setTool("erase")}>Eraser</button>
            <input type="color" value={strokeColor} onChange={(e) => setStrokeColor(e.target.value)} />
            <input type="range" min={1} max={40} value={strokeWidth} onChange={(e) => setStrokeWidth(Number(e.target.value))} className="flex-1 min-w-[80px]" />
            <button className="win98-button px-2" onClick={clearAll}>Clear</button>
          </div>
          {/*
            The editor preview and drawing canvas BOTH cover exactly the
            character cell area at displayScale×. The character preview is the
            same JSX used in-game, wrapped in a CSS scale transform so its body
            and legs occupy the IDENTICAL pixels in the editor that the saved
            drawing will occupy in-game (when rendered back at scale 1).
            The canvas backing buffer stays at EDITOR_CANVAS_W × EDITOR_CANVAS_H
            so saved PNGs keep full resolution; only the on-screen size changes
            with displayScale to fit the viewport.
            Result: where the user draws is exactly where it appears on the
            in-game avatar — no offsets, no margins, no rounding error.
          */}
          <div className="win98-inset bg-white self-center" style={{ padding: 0 }}>
            <div className="relative" style={{ width: dispW, height: dispH, boxSizing: "content-box" }}>
              <div
                className="absolute top-0 left-0 pointer-events-none"
                style={{
                  width: ACCESSORY_W,
                  height: ACCESSORY_H,
                  transform: `scale(${displayScale})`,
                  transformOrigin: "top left",
                }}
              >
                <div className="relative" style={{ width: ACCESSORY_W, height: ACCESSORY_H }}>
                  <CharacterCell color={color} hat={hat} accessoryUrl={null} />
                </div>
              </div>
              {/* Faint horizontal guide marking the top of the head — anything
                  drawn above this line shows up above the in-game character. */}
              <div
                className="absolute left-0 right-0 pointer-events-none"
                style={{ top: HEAD_PAD * displayScale, height: 1, background: "rgba(0,0,0,0.15)" }}
              />
              <canvas
                ref={canvasRef}
                width={EDITOR_CANVAS_W}
                height={EDITOR_CANVAS_H}
                className="absolute inset-0 touch-none"
                style={{ width: dispW, height: dispH, touchAction: "none", cursor: "crosshair" }}
                onPointerDown={pd}
                onPointerMove={pm}
                onPointerUp={pu}
                onPointerCancel={pu}
              />
            </div>
          </div>
          <div className="flex gap-1 justify-end shrink-0">
            <button className="win98-button px-3" onClick={onCancel}>Cancel</button>
            <button className="win98-button px-3 font-bold" onClick={save}>Save Character</button>
          </div>
        </div>
      </div>
    </div>
  );
}

// CSS keyframes for the walk wobble — injected once.
const WOBBLE_STYLE_ID = "cafe-wobble-keyframes";
function ensureWobbleStyle() {
  if (typeof document === "undefined") return;
  if (document.getElementById(WOBBLE_STYLE_ID)) return;
  const s = document.createElement("style");
  s.id = WOBBLE_STYLE_ID;
  s.textContent = `
    @keyframes cafeWobble {
      0%   { transform: translateY(0)    rotate(0deg); }
      20%  { transform: translateY(-2px) rotate(-6deg); }
      50%  { transform: translateY(0)    rotate(0deg); }
      80%  { transform: translateY(-2px) rotate(6deg); }
      100% { transform: translateY(0)    rotate(0deg); }
    }
    .cafe-walk { animation: cafeWobble 360ms ease-in-out infinite; transform-origin: 50% 100%; }
  `;
  document.head.appendChild(s);
}

export function Cafe() {
  const user = useAuth(s => s.user);
  const ranks = useAuth(s => s.ranks);
  const refreshRanks = useAuth(s => s.refreshRanks);
  const [presence, setPresence] = useState<CafePresence[]>([]);
  const [chat, setChat] = useState<{ author: string; body: string; createdAt: string }[]>([]);
  const [theme, setTheme] = useState("cafe");
  const [rooms, setRooms] = useState<CafeRoom[]>([]);
  const [objects, setObjects] = useState<CafeObject[]>([]);
  const [managingRooms, setManagingRooms] = useState(false);
  const [editObjectsMode, setEditObjectsMode] = useState(false);
  const [pendingObject, setPendingObject] = useState<{ x: number; y: number } | null>(null);
  const [editingObject, setEditingObject] = useState<CafeObject | null>(null);
  const [pos, setPos] = useState({ x: 200 + Math.floor(Math.random() * 200), y: 250 });
  const [body, setBody] = useState<{ color: string; hat: string; accessory: string | null }>({ color: "#ffd699", hat: "none", accessory: null });
  const [msg, setMsg] = useState("");
  const [editing, setEditing] = useState(false);
  const [joined, setJoined] = useState(false);
  // Track who is currently "walking" — username -> timestamp of last detected motion.
  const [walking, setWalking] = useState<Record<string, number>>({});
  const lastPositions = useRef<Record<string, { x: number; y: number }>>({});
  const myAvatar = useRef(body);
  myAvatar.current = body;

  useEffect(() => { ensureWobbleStyle(); }, []);

  async function loadRooms() {
    try { setRooms(await fetchCafeRooms()); } catch {}
  }
  async function loadObjects(forTheme: string) {
    try { setObjects(await fetchCafeObjects(forTheme)); } catch { setObjects([]); }
  }
  useEffect(() => { void loadRooms(); }, []);
  useEffect(() => { void loadObjects(theme); }, [theme]);

  useEffect(() => { void refreshRanks(); }, [refreshRanks]);

  useEffect(() => {
    let alive = true;
    const tick = async () => { try { const s = await fetchCafeState(); if (!alive) return; setPresence(s.presence); setChat(s.chat); setTheme(s.theme); } catch {} };
    void tick();
    const t = setInterval(tick, 1500);
    return () => { alive = false; clearInterval(t); };
  }, []);

  // Detect movement of remote players to drive their wobble.
  useEffect(() => {
    const now = Date.now();
    let any = false;
    const next: Record<string, number> = { ...walking };
    for (const p of presence) {
      const isMe = user && p.username === user.username;
      if (isMe) continue;
      const prev = lastPositions.current[p.username];
      if (prev && (prev.x !== p.x || prev.y !== p.y)) { next[p.username] = now; any = true; }
      lastPositions.current[p.username] = { x: p.x, y: p.y };
    }
    if (any) setWalking(next);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [presence]);

  // Expire wobble entries after 600ms of no motion.
  useEffect(() => {
    const t = setInterval(() => {
      const now = Date.now();
      setWalking(w => {
        const out: Record<string, number> = {};
        let changed = false;
        for (const [k, v] of Object.entries(w)) {
          if (now - v < 600) out[k] = v; else changed = true;
        }
        return changed ? out : w;
      });
    }, 200);
    return () => clearInterval(t);
  }, []);

  // Move ticker — only runs when joined.
  useEffect(() => {
    if (!user || !joined) return;
    moveCafe(pos.x, pos.y, myAvatar.current).catch(() => {});
    const t = setInterval(() => { moveCafe(pos.x, pos.y, myAvatar.current).catch(() => {}); }, 2000);
    return () => clearInterval(t);
  }, [user, joined, pos]);

  // Send immediate update when avatar changes (only if joined).
  useEffect(() => {
    if (!user || !joined) return;
    moveCafe(pos.x, pos.y, body).catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [body.color, body.hat, body.accessory]);

  // Always leave on unmount.
  useEffect(() => () => { leaveCafe().catch(() => {}); }, []);

  // Keyboard movement only when joined and not in a modal.
  useEffect(() => {
    if (!user || !joined) return;
    const onKey = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement)?.tagName === "INPUT") return;
      if (editing || editObjectsMode || pendingObject || editingObject) return;
      let dx = 0, dy = 0;
      if (e.key === "ArrowLeft" || e.key === "a") dx = -20;
      if (e.key === "ArrowRight" || e.key === "d") dx = 20;
      if (e.key === "ArrowUp" || e.key === "w") dy = -20;
      if (e.key === "ArrowDown" || e.key === "s") dy = 20;
      if (!dx && !dy) return;
      e.preventDefault();
      setPos(p => ({ x: Math.max(20, Math.min(W - 20, p.x + dx)), y: Math.max(40, Math.min(H - 20, p.y + dy)) }));
      if (user) setWalking(w => ({ ...w, [user.username]: Date.now() }));
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [user, joined, editing, editObjectsMode, pendingObject, editingObject]);

  async function send() {
    if (!msg.trim()) return;
    try { await sayCafe(msg); setMsg(""); } catch {}
  }
  async function changeTheme(t: string) { try { await setCafeTheme(t); } catch (e: any) { alert(e?.message || "Failed"); } }

  async function joinCafe() {
    if (!user) return;
    setJoined(true);
    try { await moveCafe(pos.x, pos.y, body); } catch {}
  }
  async function leaveNow() {
    setJoined(false);
    try { await leaveCafe(); } catch {}
  }

  function handleObjectAction(o: CafeObject) {
    switch (o.actionType) {
      case "teleport": {
        const target = o.actionValue.trim().toLowerCase();
        if (!target) return;
        changeTheme(target);
        // Reset the local position to a sensible spawn so the user can see they teleported.
        setPos({ x: 200 + Math.floor(Math.random() * 200), y: 250 });
        if (joined && user) setWalking(w => ({ ...w, [user.username]: Date.now() }));
        return;
      }
      case "message":
        alert(o.actionValue);
        return;
      case "url": {
        const url = o.actionValue.trim();
        if (!/^https?:\/\//i.test(url)) { alert("Invalid URL on object"); return; }
        window.open(url, "_blank", "noopener,noreferrer");
        return;
      }
    }
  }

  function clickArea(e: React.MouseEvent<HTMLDivElement>) {
    if (!user) return;
    const r = e.currentTarget.getBoundingClientRect();
    const x = Math.round(((e.clientX - r.left) / r.width) * W);
    const y = Math.round(((e.clientY - r.top) / r.height) * H);
    if (editObjectsMode) {
      setPendingObject({ x, y });
      return;
    }
    if (!joined) return;
    setPos({ x, y });
    setWalking(w => ({ ...w, [user.username]: Date.now() }));
  }

  const customRoom = rooms.find(r => r.slug === theme);
  const t = customRoom
    ? { bg: "#000", floor: customRoom.floorColor, label: `🖼 ${customRoom.name}` }
    : (THEMES[theme] || THEMES.cafe);
  const canChangeTheme = user && (user.isAdmin || hasPermission(user, "cafeTheme", ranks));
  const recentSpeech = chat.slice(-12);

  // Build the list of names visible in the cafe scene. If I'm joined, ensure I render
  // even before the server's first echo of my presence.
  const presenceForScene = useMemo(() => {
    if (!user || !joined) return presence.filter(p => p.username !== user?.username);
    if (presence.some(p => p.username === user.username)) return presence;
    return [...presence, { username: user.username, x: pos.x, y: pos.y, avatar: body, lastSeen: new Date().toISOString() } as any];
  }, [presence, user, joined, pos.x, pos.y, body]);

  return (
    <div className="w-full h-full flex flex-col text-xs gap-1">
      <div className="flex gap-1 items-center shrink-0 flex-wrap">
        <div className="font-bold flex-1">{t.label} — {presence.length} online</div>
        {user && <button className="win98-button px-2" onClick={() => setEditing(true)}>🎨 Customize Character</button>}
        {canChangeTheme && (
          <select className="win98-inset" value={theme} onChange={e => changeTheme(e.target.value)}>
            <optgroup label="Built-in">
              {Object.entries(THEMES).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
            </optgroup>
            {rooms.length > 0 && (
              <optgroup label="Custom rooms">
                {rooms.map(r => <option key={r.slug} value={r.slug}>🖼 {r.name}</option>)}
              </optgroup>
            )}
          </select>
        )}
        {user?.isAdmin && (
          <>
            <button className="win98-button px-2" onClick={() => setManagingRooms(true)}>Manage Rooms</button>
            <button
              className={`win98-button px-2 ${editObjectsMode ? "font-bold" : ""}`}
              onClick={() => setEditObjectsMode(v => !v)}
              title="When on, click empty space to add an object, or click an existing object to edit it."
            >
              {editObjectsMode ? "✏ Editing Objects" : "Edit Objects"}
            </button>
          </>
        )}
        {user && (
          joined
            ? <button className="win98-button px-2" onClick={leaveNow}>🚪 Leave Cafe</button>
            : <button className="win98-button px-2 font-bold" onClick={joinCafe}>🚪 Join Cafe</button>
        )}
      </div>

      <div
        className="flex-1 win98-inset overflow-hidden relative"
        style={{ backgroundColor: t.bg, cursor: editObjectsMode ? "crosshair" : (joined ? "pointer" : "default") }}
        onClick={clickArea}
      >
        {customRoom ? (
          <img
            src={customRoom.backgroundDataUrl}
            alt={customRoom.name}
            className="absolute inset-0 w-full h-full pointer-events-none select-none"
            style={{ objectFit: "cover" }}
            draggable={false}
          />
        ) : (
          <Background theme={theme} />
        )}
        <div className="absolute inset-x-0 bottom-0 h-1/3" style={{ backgroundColor: t.floor, opacity: customRoom ? 0.4 : 0.95 }} />

        {/* Cafe objects */}
        {objects.map(o => (
          <div
            key={o.id}
            className="absolute select-none"
            style={{
              left: `${(o.x / W) * 100}%`,
              top: `${(o.y / H) * 100}%`,
              width: o.width,
              height: o.height,
              transform: "translate(-50%, -50%)",
              cursor: editObjectsMode ? "move" : "pointer",
              outline: editObjectsMode ? "2px dashed #ff0" : "none",
              outlineOffset: 2,
            }}
            title={`${o.name} — ${o.actionType}: ${o.actionValue}`}
            onClick={(e) => {
              e.stopPropagation();
              if (editObjectsMode) { setEditingObject(o); return; }
              handleObjectAction(o);
            }}
          >
            {o.drawingDataUrl ? (
              <img src={o.drawingDataUrl} alt={o.name} draggable={false} className="w-full h-full pointer-events-none" style={{ imageRendering: "pixelated", objectFit: "contain" }} />
            ) : (
              <div className="w-full h-full flex items-center justify-center" style={{ fontSize: Math.min(o.width, o.height) * 0.85, lineHeight: 1 }}>
                {o.emoji || "❓"}
              </div>
            )}
            {editObjectsMode && (
              <div className="absolute -top-4 left-0 bg-yellow-200 text-black text-[9px] px-1 border border-black whitespace-nowrap">
                {o.name} · {o.actionType}
              </div>
            )}
          </div>
        ))}

        {/* People */}
        {presenceForScene.map(p => {
          const isMe = user && p.username === user.username;
          const av: any = isMe ? body : (p.avatar || {});
          const speech = recentSpeech.findLast?.(c => c.author === p.username);
          const x = isMe ? pos.x : p.x, y = isMe ? pos.y : p.y;
          const isWalking = !!walking[p.username];
          return (
            <div key={p.username} className="absolute flex flex-col items-center" style={{ left: `${(x / W) * 100}%`, top: `${(y / H) * 100}%`, transform: "translate(-50%, -100%)", transition: "left 250ms linear, top 250ms linear" }}>
              {speech && (Date.now() - new Date(speech.createdAt).getTime() < 8000) && (
                <div className="bg-white border border-black px-1 mb-1 max-w-[120px] text-[10px] rounded">{speech.body}</div>
              )}
              <div className="text-white text-[10px] font-bold" style={{ textShadow: "1px 1px 2px black" }}>{p.username}</div>
              <div className={`relative ${isWalking ? "cafe-walk" : ""}`} style={{ width: ACCESSORY_W, height: ACCESSORY_H }}>
                <CharacterCell color={av.color} hat={av.hat || "none"} accessoryUrl={av.accessory || null} />
              </div>
            </div>
          );
        })}

        {/* Not-joined overlay */}
        {user && !joined && (
          <div
            className="absolute inset-0 flex items-center justify-center"
            style={{ backgroundColor: "rgba(0,0,0,0.45)" }}
            onClick={(e) => { e.stopPropagation(); }}
          >
            <button className="win98-button px-4 py-2 text-base font-bold" onClick={joinCafe}>
              🚪 Join Cafe
            </button>
          </div>
        )}
      </div>

      {user ? (
        joined ? (
          <div className="flex gap-1 shrink-0">
            <input className="win98-inset px-1 flex-1" placeholder="Say something... (or use arrows / click to walk)" value={msg} onChange={e => setMsg(e.target.value)} onKeyDown={e => e.key === "Enter" && send()} />
            <button className="win98-button px-2" onClick={send}>Say</button>
          </div>
        ) : (
          <div className="text-gray-600">Click <b>Join Cafe</b> above to walk around and chat. Other people are still visible.</div>
        )
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

      {managingRooms && user?.isAdmin && (
        <RoomManager
          rooms={rooms}
          onClose={() => setManagingRooms(false)}
          onChanged={loadRooms}
        />
      )}

      {pendingObject && user?.isAdmin && (
        <ObjectEditor
          mode="create"
          initial={{ x: pendingObject.x, y: pendingObject.y, room: theme }}
          rooms={rooms}
          onClose={() => setPendingObject(null)}
          onSaved={async () => { setPendingObject(null); await loadObjects(theme); }}
        />
      )}

      {editingObject && user?.isAdmin && (
        <ObjectEditor
          mode="edit"
          initial={editingObject}
          rooms={rooms}
          onClose={() => setEditingObject(null)}
          onSaved={async () => { setEditingObject(null); await loadObjects(theme); }}
          onDelete={async () => {
            if (!confirm(`Delete object "${editingObject.name}"?`)) return;
            try { await deleteCafeObject(editingObject.id); } catch (e: any) { alert(e?.message || "Failed"); return; }
            setEditingObject(null);
            await loadObjects(theme);
          }}
        />
      )}
    </div>
  );
}

function RoomManager({ rooms, onClose, onChanged }: {
  rooms: CafeRoom[];
  onClose: () => void;
  onChanged: () => Promise<void> | void;
}) {
  const [slug, setSlug] = useState("");
  const [name, setName] = useState("");
  const [floorColor, setFloorColor] = useState("#444444");
  const [bgDataUrl, setBgDataUrl] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  function pickFile(file: File | null | undefined) {
    setErr(null);
    if (!file) return;
    if (!file.type.startsWith("image/")) { setErr("Pick an image file."); return; }
    const img = new Image();
    const reader = new FileReader();
    reader.onload = () => {
      img.onload = () => {
        const canvas = document.createElement("canvas");
        canvas.width = 800;
        canvas.height = 500;
        const ctx = canvas.getContext("2d")!;
        ctx.drawImage(img, 0, 0, 800, 500);
        const url = canvas.toDataURL("image/jpeg", 0.82);
        if (url.length > 1_900_000) {
          const smaller = canvas.toDataURL("image/jpeg", 0.6);
          setBgDataUrl(smaller);
        } else {
          setBgDataUrl(url);
        }
      };
      img.onerror = () => setErr("Could not read that image.");
      img.src = String(reader.result);
    };
    reader.readAsDataURL(file);
  }

  async function submit() {
    setErr(null);
    if (!/^[a-z0-9][a-z0-9-]{1,30}$/.test(slug)) { setErr("Slug must be 2-31 chars: lowercase letters, numbers, dashes."); return; }
    if (!name.trim()) { setErr("Name required"); return; }
    if (!bgDataUrl) { setErr("Pick a background image"); return; }
    setBusy(true);
    try {
      await createCafeRoom({ slug, name: name.trim(), backgroundDataUrl: bgDataUrl, floorColor });
      setSlug(""); setName(""); setBgDataUrl(""); setFloorColor("#444444");
      await onChanged();
    } catch (e: any) {
      setErr(e?.message || "Failed to create room");
    } finally {
      setBusy(false);
    }
  }

  async function remove(s: string) {
    if (!confirm(`Delete room "${s}"? Anyone currently viewing it will fall back to the default theme.`)) return;
    try { await deleteCafeRoom(s); await onChanged(); } catch (e: any) { setErr(e?.message || "Delete failed"); }
  }

  return (
    <div className="absolute inset-0 z-50 flex items-center justify-center bg-black/40" onClick={onClose}>
      <div className="win98-window w-[520px] max-h-[90%] overflow-auto" onClick={e => e.stopPropagation()}>
        <div className="win98-titlebar flex justify-between items-center px-1">
          <span>Manage Cafe Rooms</span>
          <button className="win98-button px-2" onClick={onClose}>×</button>
        </div>
        <div className="p-2 flex flex-col gap-2 text-xs">
          <div className="font-bold">Existing rooms</div>
          {rooms.length === 0 ? (
            <div className="text-gray-600">No custom rooms yet.</div>
          ) : (
            <div className="flex flex-col gap-1">
              {rooms.map(r => (
                <div key={r.slug} className="flex items-center gap-2 win98-inset p-1">
                  <img src={r.backgroundDataUrl} alt="" className="w-16 h-10 object-cover" />
                  <div className="flex-1">
                    <div className="font-bold">{r.name}</div>
                    <div className="text-gray-600">slug: {r.slug} · by {r.createdBy}</div>
                  </div>
                  <button className="win98-button px-2" onClick={() => remove(r.slug)}>Delete</button>
                </div>
              ))}
            </div>
          )}

          <hr className="my-1" />
          <div className="font-bold">Add a new room</div>
          <label className="flex flex-col gap-1">
            Name
            <input className="win98-inset px-1" value={name} onChange={e => setName(e.target.value)} maxLength={40} />
          </label>
          <label className="flex flex-col gap-1">
            Slug (URL-safe id)
            <input className="win98-inset px-1" value={slug} onChange={e => setSlug(e.target.value.toLowerCase())} placeholder="e.g. beach-hut" />
          </label>
          <label className="flex items-center gap-2">
            Floor color
            <input type="color" value={floorColor} onChange={e => setFloorColor(e.target.value)} />
            <span className="text-gray-600">overlay tint along the bottom</span>
          </label>
          <label className="flex flex-col gap-1">
            Background image (will be resized to 800×500)
            <input type="file" accept="image/*" onChange={e => pickFile(e.target.files?.[0])} />
          </label>
          {bgDataUrl && (
            <div className="win98-inset p-1">
              <img src={bgDataUrl} alt="preview" className="w-full" style={{ maxHeight: 160, objectFit: "contain" }} />
            </div>
          )}
          {err && <div className="text-red-700">{err}</div>}
          <div className="flex justify-end gap-1">
            <button className="win98-button px-2" onClick={onClose}>Close</button>
            <button className="win98-button px-2" disabled={busy} onClick={submit}>{busy ? "Saving…" : "Add Room"}</button>
          </div>
        </div>
      </div>
    </div>
  );
}

function ObjectEditor({ mode, initial, rooms, onClose, onSaved, onDelete }: {
  mode: "create" | "edit";
  initial: Partial<CafeObject> & { x: number; y: number; room: string };
  rooms: CafeRoom[];
  onClose: () => void;
  onSaved: () => Promise<void> | void;
  onDelete?: () => Promise<void> | void;
}) {
  const [name, setName] = useState(initial.name || "");
  const [x, setX] = useState(initial.x);
  const [y, setY] = useState(initial.y);
  const [width, setWidth] = useState(initial.width || 48);
  const [height, setHeight] = useState(initial.height || 48);
  const [emoji, setEmoji] = useState(initial.emoji || "");
  const [drawingDataUrl, setDrawingDataUrl] = useState<string | null>(initial.drawingDataUrl || null);
  const [actionType, setActionType] = useState<CafeObjectAction>((initial.actionType as CafeObjectAction) || "message");
  const [actionValue, setActionValue] = useState(initial.actionValue || "");
  const [room] = useState(initial.room);
  const [busy, setBusy] = useState(false);
  const [drawing, setDrawing] = useState(false);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const drawingCtx = useRef<CanvasRenderingContext2D | null>(null);
  const [strokeColor, setStrokeColor] = useState("#000000");
  const [strokeSize, setStrokeSize] = useState(6);

  useEffect(() => {
    const c = canvasRef.current; if (!c) return;
    const ctx = c.getContext("2d"); if (!ctx) return;
    ctx.imageSmoothingEnabled = false;
    drawingCtx.current = ctx;
    if (drawingDataUrl) {
      const img = new Image();
      img.onload = () => { ctx.clearRect(0, 0, c.width, c.height); ctx.drawImage(img, 0, 0, c.width, c.height); };
      img.src = drawingDataUrl;
    } else {
      ctx.clearRect(0, 0, c.width, c.height);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function canvasPoint(e: React.PointerEvent<HTMLCanvasElement>) {
    const c = canvasRef.current!;
    const r = c.getBoundingClientRect();
    return { x: ((e.clientX - r.left) / r.width) * c.width, y: ((e.clientY - r.top) / r.height) * c.height };
  }
  function startDraw(e: React.PointerEvent<HTMLCanvasElement>) {
    e.currentTarget.setPointerCapture(e.pointerId);
    setDrawing(true);
    const ctx = drawingCtx.current; if (!ctx) return;
    const p = canvasPoint(e);
    ctx.beginPath(); ctx.moveTo(p.x, p.y);
    ctx.lineCap = "round"; ctx.lineJoin = "round";
    ctx.strokeStyle = strokeColor; ctx.lineWidth = strokeSize;
  }
  function moveDraw(e: React.PointerEvent<HTMLCanvasElement>) {
    if (!drawing) return;
    const ctx = drawingCtx.current; if (!ctx) return;
    const p = canvasPoint(e);
    ctx.lineTo(p.x, p.y); ctx.stroke();
  }
  function endDraw() {
    if (!drawing) return;
    setDrawing(false);
    const c = canvasRef.current; if (!c) return;
    setDrawingDataUrl(c.toDataURL("image/png"));
  }
  function clearDraw() {
    const c = canvasRef.current; const ctx = drawingCtx.current; if (!c || !ctx) return;
    ctx.clearRect(0, 0, c.width, c.height);
    setDrawingDataUrl(null);
  }

  async function submit() {
    if (!name.trim()) { alert("Name required"); return; }
    if (!actionValue.trim()) { alert("Action value required"); return; }
    if (!emoji.trim() && !drawingDataUrl) { alert("Provide an emoji or draw something"); return; }
    setBusy(true);
    try {
      const payload = {
        room, name: name.trim(),
        x: Math.round(x), y: Math.round(y),
        width: Math.round(width), height: Math.round(height),
        emoji: emoji.trim() || null,
        drawingDataUrl: drawingDataUrl,
        actionType, actionValue: actionValue.trim(),
      };
      if (mode === "create") await createCafeObject(payload as any);
      else if (initial.id != null) await updateCafeObject(initial.id, payload as any);
      await onSaved();
    } catch (e: any) {
      alert(e?.message || "Failed");
    } finally { setBusy(false); }
  }

  // Build the room slug list for the teleport picker.
  const teleportTargets: { value: string; label: string }[] = [
    ...Object.entries(THEMES).map(([k, v]) => ({ value: k, label: v.label })),
    ...rooms.map(r => ({ value: r.slug, label: `🖼 ${r.name}` })),
  ];

  return (
    <div className="absolute inset-0 z-30 flex items-center justify-center" style={{ backgroundColor: "rgba(0,0,0,0.5)" }} onClick={onClose}>
      <div className="win98-window p-2 w-[460px] max-h-[90%] overflow-auto" onClick={e => e.stopPropagation()}>
        <div className="font-bold mb-2">{mode === "create" ? "Add Object" : `Edit Object: ${initial.name}`}</div>
        <div className="grid grid-cols-2 gap-2 text-xs">
          <label className="col-span-2">Name
            <input className="win98-inset px-1 w-full" value={name} onChange={e => setName(e.target.value)} placeholder="e.g. Door to Library" />
          </label>
          <label>X
            <input type="number" className="win98-inset px-1 w-full" value={x} onChange={e => setX(Number(e.target.value))} />
          </label>
          <label>Y
            <input type="number" className="win98-inset px-1 w-full" value={y} onChange={e => setY(Number(e.target.value))} />
          </label>
          <label>Width
            <input type="number" min={16} max={400} className="win98-inset px-1 w-full" value={width} onChange={e => setWidth(Number(e.target.value))} />
          </label>
          <label>Height
            <input type="number" min={16} max={400} className="win98-inset px-1 w-full" value={height} onChange={e => setHeight(Number(e.target.value))} />
          </label>
          <label className="col-span-2">Emoji (optional, used if no drawing)
            <input className="win98-inset px-1 w-full" value={emoji} onChange={e => setEmoji(e.target.value)} placeholder="🚪 🪑 🍰 ❓" />
          </label>
          <label className="col-span-2">Action
            <select className="win98-inset px-1 w-full" value={actionType} onChange={e => setActionType(e.target.value as CafeObjectAction)}>
              <option value="message">Show message</option>
              <option value="teleport">Teleport to room</option>
              <option value="url">Open URL</option>
            </select>
          </label>
          <label className="col-span-2">
            {actionType === "teleport" ? "Target room" : actionType === "url" ? "URL (https://…)" : "Message text"}
            {actionType === "teleport" ? (
              <select className="win98-inset px-1 w-full" value={actionValue} onChange={e => setActionValue(e.target.value)}>
                <option value="">— pick a room —</option>
                {teleportTargets.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
              </select>
            ) : (
              <input className="win98-inset px-1 w-full" value={actionValue} onChange={e => setActionValue(e.target.value)} placeholder={actionType === "url" ? "https://example.com" : "Hello!"} />
            )}
          </label>
        </div>

        <div className="mt-2 border-t pt-2">
          <div className="font-bold text-xs mb-1">Drawing (optional, overrides emoji)</div>
          <div className="flex gap-2 items-center text-xs mb-1">
            <input type="color" value={strokeColor} onChange={e => setStrokeColor(e.target.value)} />
            <label>Size <input type="range" min={1} max={24} value={strokeSize} onChange={e => setStrokeSize(Number(e.target.value))} /></label>
            <button className="win98-button px-2" onClick={clearDraw}>Clear</button>
          </div>
          <canvas
            ref={canvasRef}
            width={96}
            height={96}
            className="win98-inset bg-white touch-none"
            style={{ width: 192, height: 192, imageRendering: "pixelated", cursor: "crosshair" }}
            onPointerDown={startDraw}
            onPointerMove={moveDraw}
            onPointerUp={endDraw}
            onPointerCancel={endDraw}
          />
        </div>

        <div className="flex justify-between gap-1 mt-2">
          <div>
            {mode === "edit" && onDelete && (
              <button className="win98-button px-2" onClick={onDelete}>Delete</button>
            )}
          </div>
          <div className="flex gap-1">
            <button className="win98-button px-2" onClick={onClose}>Cancel</button>
            <button className="win98-button px-2" disabled={busy} onClick={submit}>{busy ? "Saving…" : (mode === "create" ? "Create" : "Save")}</button>
          </div>
        </div>
      </div>
    </div>
  );
}
