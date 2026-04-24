import { useEffect, useRef, useState } from "react";
import { fetchUserPage, saveUserPage, clearUserPage, type UserPageElement } from "../lib/api";
import { useAuth } from "../lib/auth-store";

interface Props { username: string; }

const W = 500, H = 400;

function youtubeEmbed(url: string): string | null {
  try {
    const u = new URL(url);
    if (u.hostname.includes("youtu.be")) return `https://www.youtube.com/embed/${u.pathname.slice(1)}`;
    if (u.hostname.includes("youtube.com")) {
      const v = u.searchParams.get("v");
      if (v) return `https://www.youtube.com/embed/${v}`;
      const m = u.pathname.match(/\/embed\/([^/?]+)/);
      if (m) return `https://www.youtube.com/embed/${m[1]}`;
    }
  } catch {}
  return null;
}

function fileToDataUrl(f: File): Promise<string> {
  return new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(r.result as string); r.onerror = rej; r.readAsDataURL(f); });
}

export function UserPage({ username }: Props) {
  const me = useAuth((s) => s.user);
  const isMe = me?.username === username;
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const drawing = useRef(false);
  const last = useRef<{ x: number; y: number } | null>(null);
  const [color, setColor] = useState("#000000");
  const [strokeWidth, setStrokeWidth] = useState(3);
  const [erase, setErase] = useState(false);
  const [busy, setBusy] = useState(false);
  const [edit, setEdit] = useState(false);
  const [elements, setElements] = useState<UserPageElement[]>([]);
  const [selIdx, setSelIdx] = useState<number | null>(null);
  const drag = useRef<{ idx: number; mode: "move" | "resize"; startX: number; startY: number; ox: number; oy: number; ow: number; oh: number } | null>(null);

  async function load() {
    const p = await fetchUserPage(username);
    const c = canvasRef.current; if (!c) return;
    const ctx = c.getContext("2d")!;
    ctx.fillStyle = "#fff"; ctx.fillRect(0, 0, c.width, c.height);
    if (p) {
      const img = new Image();
      img.onload = () => ctx.drawImage(img, 0, 0, c.width, c.height);
      img.src = p.dataUrl;
      setElements(Array.isArray(p.elements) ? p.elements : []);
    } else {
      setElements([]);
    }
  }
  useEffect(() => { void load(); }, [username]);

  function getPos(e: React.PointerEvent) {
    const c = canvasRef.current!; const r = c.getBoundingClientRect();
    return { x: ((e.clientX - r.left) / r.width) * c.width, y: ((e.clientY - r.top) / r.height) * c.height };
  }
  function pd(e: React.PointerEvent) { if (!isMe || !edit) return; e.preventDefault(); e.stopPropagation(); drawing.current = true; last.current = getPos(e); (e.target as HTMLElement).setPointerCapture(e.pointerId); }
  function pm(e: React.PointerEvent) {
    if (!drawing.current) return; e.stopPropagation();
    const c = canvasRef.current!; const ctx = c.getContext("2d")!;
    const p = getPos(e);
    ctx.strokeStyle = erase ? "#ffffff" : color; ctx.lineWidth = erase ? strokeWidth * 4 : strokeWidth;
    ctx.lineCap = "round"; ctx.lineJoin = "round";
    ctx.beginPath(); ctx.moveTo(last.current!.x, last.current!.y); ctx.lineTo(p.x, p.y); ctx.stroke();
    last.current = p;
  }
  function pu(e: React.PointerEvent) { drawing.current = false; last.current = null; try { (e.target as HTMLElement).releasePointerCapture(e.pointerId); } catch {} }

  async function save() {
    const c = canvasRef.current; if (!c) return;
    setBusy(true);
    try { await saveUserPage(c.toDataURL("image/png"), elements); setEdit(false); setSelIdx(null); }
    catch (e: any) { alert(e?.message || "Failed"); }
    finally { setBusy(false); }
  }

  function addText() {
    const content = window.prompt("Text content:", "Hello!");
    if (!content) return;
    setElements(els => [...els, { type: "text", x: 50, y: 50, w: 200, h: 40, content, color: "#000", size: 16 }]);
  }
  function addImageUrl() {
    const url = window.prompt("Image URL (https://...):", "");
    if (!url) return;
    setElements(els => [...els, { type: "image", x: 80, y: 80, w: 160, h: 120, url }]);
  }
  async function addImageFile(f: File) {
    if (f.size > 600_000) { alert("Pick an image under ~600KB"); return; }
    const url = await fileToDataUrl(f);
    setElements(els => [...els, { type: "image", x: 80, y: 80, w: 160, h: 120, url }]);
  }
  function addEmbed() {
    const url = window.prompt("Video URL (YouTube link):", "");
    if (!url) return;
    setElements(els => [...els, { type: "embed", x: 80, y: 100, w: 280, h: 180, url }]);
  }
  function deleteEl(idx: number) { setElements(els => els.filter((_, i) => i !== idx)); setSelIdx(null); }
  function editText(idx: number) {
    const el = elements[idx]; if (el.type !== "text") return;
    const v = window.prompt("Edit text:", el.content);
    if (v === null) return;
    setElements(els => els.map((e, i) => i === idx ? { ...el, content: v } as UserPageElement : e));
  }

  function elementPointerDown(e: React.PointerEvent, idx: number, mode: "move" | "resize") {
    if (!edit || !isMe) return;
    e.preventDefault(); e.stopPropagation();
    setSelIdx(idx);
    const el = elements[idx];
    drag.current = { idx, mode, startX: e.clientX, startY: e.clientY, ox: el.x, oy: el.y, ow: el.w, oh: el.h };
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
  }
  function elementPointerMove(e: React.PointerEvent) {
    if (!drag.current) return;
    e.preventDefault(); e.stopPropagation();
    const c = canvasRef.current!; const r = c.getBoundingClientRect();
    const sx = c.width / r.width, sy = c.height / r.height;
    const dx = (e.clientX - drag.current.startX) * sx;
    const dy = (e.clientY - drag.current.startY) * sy;
    const { idx, mode, ox, oy, ow, oh } = drag.current;
    setElements(els => els.map((el, i) => {
      if (i !== idx) return el;
      if (mode === "move") return { ...el, x: Math.max(0, Math.min(W - el.w, ox + dx)), y: Math.max(0, Math.min(H - el.h, oy + dy)) };
      return { ...el, w: Math.max(40, Math.min(W - el.x, ow + dx)), h: Math.max(30, Math.min(H - el.y, oh + dy)) };
    }));
  }
  function elementPointerUp(e: React.PointerEvent) { drag.current = null; try { (e.target as HTMLElement).releasePointerCapture(e.pointerId); } catch {} }

  async function adminClear() {
    if (!confirm(`Clear ${username}'s entire user page? This cannot be undone.`)) return;
    try { await clearUserPage(username); await load(); }
    catch (e: any) { alert(e?.message || "Failed"); }
  }

  return (
    <div className="w-full h-full flex flex-col text-xs gap-1">
      <div className="flex gap-1 shrink-0 flex-wrap">
        <div className="font-bold flex-1">{username}'s personal page</div>
        {me?.isAdmin && !isMe && <button className="win98-button px-2" onClick={adminClear}>Admin Clear</button>}
        {isMe && (
          edit ? (
            <>
              <button className="win98-button px-2" onClick={() => setErase(false)}>{!erase ? "✓ " : ""}Pen</button>
              <button className="win98-button px-2" onClick={() => setErase(true)}>{erase ? "✓ " : ""}Eraser</button>
              <input type="color" value={color} onChange={e => setColor(e.target.value)} />
              <input type="range" min={1} max={20} value={strokeWidth} onChange={e => setStrokeWidth(Number(e.target.value))} />
              <button className="win98-button px-2" onClick={addText}>+ Text</button>
              <button className="win98-button px-2" onClick={addImageUrl}>+ Img URL</button>
              <label className="win98-button px-2 cursor-pointer">+ Img File
                <input type="file" accept="image/*" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) void addImageFile(f); e.target.value = ""; }} />
              </label>
              <button className="win98-button px-2" onClick={addEmbed}>+ Video</button>
              <button className="win98-button px-2" disabled={busy} onClick={save}>Save</button>
              <button className="win98-button px-2" onClick={() => { setEdit(false); setSelIdx(null); load(); }}>Cancel</button>
            </>
          ) : (
            <button className="win98-button px-2" onClick={() => setEdit(true)}>Customize</button>
          )
        )}
      </div>
      <div className="flex-1 win98-inset bg-white overflow-hidden relative" onClick={() => setSelIdx(null)}>
        <canvas
          ref={canvasRef}
          width={W}
          height={H}
          className="absolute inset-0 w-full h-full bg-white touch-none"
          style={{ touchAction: "none", cursor: edit ? "crosshair" : "default" }}
          onPointerDown={pd}
          onPointerMove={pm}
          onPointerUp={pu}
          onPointerCancel={pu}
        />
        <div className="absolute inset-0" style={{ pointerEvents: "none" }}>
          {elements.map((el, idx) => {
            const left = `${(el.x / W) * 100}%`;
            const top = `${(el.y / H) * 100}%`;
            const width = `${(el.w / W) * 100}%`;
            const height = `${(el.h / H) * 100}%`;
            const selected = selIdx === idx && edit && isMe;
            const interactive = edit && isMe;
            return (
              <div
                key={idx}
                className={`absolute ${selected ? "ring-2 ring-blue-500" : ""}`}
                style={{ left, top, width, height, pointerEvents: interactive ? "auto" : "none" }}
                onPointerDown={(e) => elementPointerDown(e, idx, "move")}
                onPointerMove={elementPointerMove}
                onPointerUp={elementPointerUp}
                onPointerCancel={elementPointerUp}
                onClick={(e) => { if (interactive) { e.stopPropagation(); setSelIdx(idx); } }}
                onDoubleClick={(e) => { if (interactive && el.type === "text") { e.stopPropagation(); editText(idx); } }}
              >
                {el.type === "text" && (
                  <div style={{ color: el.color, fontSize: el.size, width: "100%", height: "100%", overflow: "hidden", whiteSpace: "pre-wrap", wordBreak: "break-word" }}>{el.content}</div>
                )}
                {el.type === "image" && (
                  <img src={el.url} alt="" className="w-full h-full" style={{ objectFit: "contain", pointerEvents: "none" }} draggable={false} />
                )}
                {el.type === "embed" && (() => {
                  const yt = youtubeEmbed(el.url);
                  return yt ? (
                    <iframe src={yt} className="w-full h-full" allow="autoplay; encrypted-media" allowFullScreen style={{ pointerEvents: interactive ? "none" : "auto" }} />
                  ) : (
                    <div className="bg-gray-200 w-full h-full flex items-center justify-center text-[10px] p-1 text-center">Unsupported video URL: {el.url}</div>
                  );
                })()}
                {selected && (
                  <>
                    <button className="absolute -top-5 right-0 win98-button text-[10px] px-1" style={{ pointerEvents: "auto" }} onClick={(e) => { e.stopPropagation(); deleteEl(idx); }}>x</button>
                    <div
                      className="absolute -bottom-1 -right-1 w-3 h-3 bg-blue-500 cursor-se-resize"
                      style={{ pointerEvents: "auto" }}
                      onPointerDown={(e) => elementPointerDown(e, idx, "resize")}
                      onPointerMove={elementPointerMove}
                      onPointerUp={elementPointerUp}
                      onPointerCancel={elementPointerUp}
                    />
                  </>
                )}
              </div>
            );
          })}
        </div>
      </div>
      {edit && isMe && <div className="text-[10px] text-gray-600 shrink-0">Drag elements to move · click to select · drag the blue corner to resize · double-click text to edit · click outside to deselect</div>}
    </div>
  );
}
