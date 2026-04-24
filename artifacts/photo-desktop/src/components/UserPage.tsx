import { useEffect, useRef, useState } from "react";
import { fetchUserPage, saveUserPage } from "../lib/api";
import { useAuth } from "../lib/auth-store";

interface Props { username: string; }

export function UserPage({ username }: Props) {
  const me = useAuth((s) => s.user);
  const isMe = me?.username === username;
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const drawing = useRef(false);
  const last = useRef<{ x: number; y: number } | null>(null);
  const [color, setColor] = useState("#000000");
  const [width, setWidth] = useState(3);
  const [erase, setErase] = useState(false);
  const [busy, setBusy] = useState(false);
  const [edit, setEdit] = useState(false);

  async function load() {
    const p = await fetchUserPage(username);
    const c = canvasRef.current; if (!c) return;
    const ctx = c.getContext("2d")!;
    ctx.fillStyle = "#fff"; ctx.fillRect(0, 0, c.width, c.height);
    if (p) {
      const img = new Image();
      img.onload = () => ctx.drawImage(img, 0, 0, c.width, c.height);
      img.src = p.dataUrl;
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
    ctx.strokeStyle = erase ? "#ffffff" : color; ctx.lineWidth = erase ? width * 4 : width;
    ctx.lineCap = "round"; ctx.lineJoin = "round";
    ctx.beginPath(); ctx.moveTo(last.current!.x, last.current!.y); ctx.lineTo(p.x, p.y); ctx.stroke();
    last.current = p;
  }
  function pu(e: React.PointerEvent) { drawing.current = false; last.current = null; try { (e.target as HTMLElement).releasePointerCapture(e.pointerId); } catch {} }

  async function save() {
    const c = canvasRef.current; if (!c) return;
    setBusy(true);
    try { await saveUserPage(c.toDataURL("image/png")); setEdit(false); }
    catch (e: any) { alert(e?.message || "Failed"); }
    finally { setBusy(false); }
  }

  return (
    <div className="w-full h-full flex flex-col text-xs gap-1">
      <div className="flex gap-1 shrink-0">
        <div className="font-bold flex-1">{username}'s personal page</div>
        {isMe && (
          edit ? (
            <>
              <button className="win98-button px-2" onClick={() => setErase(false)}>{!erase ? "✓ " : ""}Pen</button>
              <button className="win98-button px-2" onClick={() => setErase(true)}>{erase ? "✓ " : ""}Eraser</button>
              <input type="color" value={color} onChange={e => setColor(e.target.value)} />
              <input type="range" min={1} max={20} value={width} onChange={e => setWidth(Number(e.target.value))} />
              <button className="win98-button px-2" disabled={busy} onClick={save}>Save</button>
              <button className="win98-button px-2" onClick={() => { setEdit(false); load(); }}>Cancel</button>
            </>
          ) : (
            <button className="win98-button px-2" onClick={() => setEdit(true)}>Customize</button>
          )
        )}
      </div>
      <div className="flex-1 win98-inset bg-white overflow-hidden">
        <canvas ref={canvasRef} width={500} height={400} className="w-full h-full bg-white touch-none" style={{ touchAction: "none", cursor: edit ? "crosshair" : "default" }} onPointerDown={pd} onPointerMove={pm} onPointerUp={pu} onPointerCancel={pu} />
      </div>
    </div>
  );
}
