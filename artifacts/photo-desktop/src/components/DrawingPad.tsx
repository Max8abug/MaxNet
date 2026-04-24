import { useEffect, useRef, useState } from "react";
import { fetchDrawings, submitDrawing, deleteDrawing, voteDrawing, type Drawing } from "../lib/api";
import { useAuth, hasPermission } from "../lib/auth-store";
import { ModAuditPanel } from "./ModAuditPanel";
import { Avatar } from "./Avatar";
import { showFullscreen } from "./ImageViewer";

interface Props { onRequestLogin?: () => void; }
type Tab = "draw" | "wall" | "audit";

const PALETTE = ["#000000", "#ffffff", "#ff3030", "#ff8c00", "#ffd700", "#39c139", "#1e90ff", "#a040ff", "#8b4513", "#ff69b4"];

export function DrawingPad({ onRequestLogin }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const drawing = useRef(false);
  const last = useRef<{ x: number; y: number } | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [drawings, setDrawings] = useState<Drawing[]>([]);
  const [tab, setTab] = useState<Tab>("draw");
  const [color, setColor] = useState("#000000");
  const [width, setWidth] = useState(3);
  const [erase, setErase] = useState(false);
  const user = useAuth((s) => s.user);
  const ranks = useAuth((s) => s.ranks);
  const refreshRanks = useAuth((s) => s.refreshRanks);
  const isAdmin = !!user?.isAdmin;
  const canDelete = !!user && (isAdmin || hasPermission(user, "deleteMessages", ranks));

  useEffect(() => { void refresh(); void refreshRanks(); }, [refreshRanks]);
  // Auto-refresh the gallery so new submissions and vote totals stay current.
  useEffect(() => {
    if (tab !== "wall") return;
    const t = setInterval(() => { void refresh(); }, 5000);
    return () => clearInterval(t);
  }, [tab]);

  async function refresh() { try { setDrawings(await fetchDrawings()); } catch {} }

  function clearCanvas() {
    const c = canvasRef.current; if (!c) return;
    const ctx = c.getContext("2d"); if (!ctx) return;
    ctx.fillStyle = "#ffffff"; ctx.fillRect(0, 0, c.width, c.height);
  }

  useEffect(() => {
    if (tab === "draw") {
      const c = canvasRef.current; if (!c) return;
      const ctx = c.getContext("2d"); if (!ctx) return;
      const img = ctx.getImageData(0, 0, 1, 1).data;
      if (img[3] === 0) { ctx.fillStyle = "#ffffff"; ctx.fillRect(0, 0, c.width, c.height); }
    }
  }, [tab]);

  function getPos(e: React.PointerEvent) {
    const c = canvasRef.current!;
    const rect = c.getBoundingClientRect();
    return { x: ((e.clientX - rect.left) / rect.width) * c.width, y: ((e.clientY - rect.top) / rect.height) * c.height };
  }
  function onPointerDown(e: React.PointerEvent) {
    e.preventDefault(); e.stopPropagation();
    drawing.current = true; last.current = getPos(e);
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
  }
  function onPointerMove(e: React.PointerEvent) {
    if (!drawing.current) return; e.stopPropagation();
    const c = canvasRef.current!; const ctx = c.getContext("2d")!;
    const p = getPos(e);
    ctx.strokeStyle = erase ? "#ffffff" : color;
    ctx.lineWidth = erase ? width * 4 : width;
    ctx.lineCap = "round"; ctx.lineJoin = "round";
    ctx.beginPath(); ctx.moveTo(last.current!.x, last.current!.y); ctx.lineTo(p.x, p.y); ctx.stroke();
    last.current = p;
  }
  function onPointerUp(e: React.PointerEvent) {
    drawing.current = false; last.current = null;
    try { (e.target as HTMLElement).releasePointerCapture(e.pointerId); } catch {}
  }

  async function handleSubmit() {
    if (!user) { onRequestLogin?.(); return; }
    const c = canvasRef.current; if (!c) return;
    setSubmitting(true);
    try {
      const dataUrl = c.toDataURL("image/png");
      await submitDrawing(dataUrl, user.username);
      clearCanvas(); await refresh(); setTab("wall");
    } catch (e: any) { alert(e?.message || "Failed"); }
    finally { setSubmitting(false); }
  }

  async function del(id: number) { if (!confirm("Delete drawing?")) return; try { await deleteDrawing(id); await refresh(); } catch {} }

  async function castVote(id: number, current: number, target: -1 | 1) {
    if (!user) { onRequestLogin?.(); return; }
    const next: -1 | 0 | 1 = current === target ? 0 : target;
    // Optimistic update so the UI feels responsive.
    setDrawings((prev) => prev.map((d) => d.id === id ? { ...d, score: d.score - current + next, myVote: next } : d));
    try { await voteDrawing(id, next); await refresh(); }
    catch { await refresh(); }
  }

  return (
    <div className="w-full h-full flex flex-col gap-1 text-sm">
      <div className="flex gap-1 shrink-0">
        <button className={`win98-button px-2 py-0.5 ${tab === "draw" ? "shadow-[inset_1px_1px_#808080] border-t-black border-l-black border-r-white border-b-white" : ""}`} onClick={() => setTab("draw")}>Draw</button>
        <button className={`win98-button px-2 py-0.5 ${tab === "wall" ? "shadow-[inset_1px_1px_#808080] border-t-black border-l-black border-r-white border-b-white" : ""}`} onClick={() => { setTab("wall"); void refresh(); }}>Gallery Wall ({drawings.length})</button>
        {isAdmin && (
          <button className={`win98-button px-2 py-0.5 ${tab === "audit" ? "shadow-[inset_1px_1px_#808080] border-t-black border-l-black border-r-white border-b-white" : ""}`} onClick={() => setTab("audit")}>Audit</button>
        )}
        <div className="flex-1" />
        {tab === "draw" && (
          <>
            <button className="win98-button px-2 py-0.5" onClick={clearCanvas}>Clear</button>
            <button className="win98-button px-2 py-0.5 font-bold" disabled={submitting} onClick={handleSubmit}>{submitting ? "..." : user ? "Submit" : "Log in to submit"}</button>
          </>
        )}
      </div>

      {tab === "draw" && (
        <>
          <div className="flex items-center gap-1 shrink-0 flex-wrap">
            {PALETTE.map(c => (
              <button key={c} className={`w-5 h-5 win98-inset ${!erase && color === c ? "ring-2 ring-black" : ""}`} style={{ backgroundColor: c }} onClick={() => { setColor(c); setErase(false); }} />
            ))}
            <input type="color" value={color} onChange={e => { setColor(e.target.value); setErase(false); }} />
            <button className={`win98-button px-2 py-0.5 text-xs ${erase ? "shadow-[inset_1px_1px_#808080] border-t-black border-l-black border-r-white border-b-white" : ""}`} onClick={() => setErase(!erase)}>Eraser</button>
            <span className="text-xs ml-1">size</span>
            <input type="range" min={1} max={20} value={width} onChange={e => setWidth(Number(e.target.value))} className="w-16" />
          </div>
          <div className="flex-1 win98-inset bg-white overflow-hidden flex items-center justify-center">
            <canvas ref={canvasRef} width={500} height={360}
              className="w-full h-full bg-white touch-none cursor-crosshair"
              style={{ touchAction: "none" }}
              onPointerDown={onPointerDown} onPointerMove={onPointerMove}
              onPointerUp={onPointerUp} onPointerCancel={onPointerUp} />
          </div>
        </>
      )}

      {tab === "wall" && (
        <div className="flex-1 win98-inset bg-[#a08060] p-2 overflow-auto">
          <div className="text-[10px] text-white/80 mb-1">Sorted by score · upvote your favorites</div>
          {drawings.length === 0 ? (
            <div className="text-white text-xs">No drawings yet. Be the first.</div>
          ) : (
            <div className="grid grid-cols-3 gap-2">
              {drawings.map(d => (
                <div key={d.id} className="bg-white p-1 shadow-md border-4 border-amber-100 hover:scale-105 transition-transform relative group" style={{ transform: `rotate(${(d.id % 5 - 2) * 1.5}deg)` }}>
                  <img src={d.dataUrl} alt="" className="w-full aspect-[4/3] object-contain cursor-zoom-in" onClick={() => showFullscreen(d.dataUrl)} />
                  <div className="text-[10px] flex items-center gap-1 mt-1">
                    <Avatar username={d.author} size={14} />
                    <span className="truncate flex-1">{d.author}</span>
                    <div className="flex items-center gap-0.5 shrink-0">
                      <button
                        className={`win98-button px-1 leading-none text-[11px] ${d.myVote === 1 ? "text-green-700 font-bold shadow-[inset_1px_1px_#808080] border-t-black border-l-black border-r-white border-b-white" : ""}`}
                        title="Upvote"
                        onClick={(e) => { e.stopPropagation(); castVote(d.id, d.myVote, 1); }}
                      >▲</button>
                      <span className={`tabular-nums px-0.5 ${d.score > 0 ? "text-green-700 font-bold" : d.score < 0 ? "text-red-700 font-bold" : "text-gray-700"}`}>{d.score}</span>
                      <button
                        className={`win98-button px-1 leading-none text-[11px] ${d.myVote === -1 ? "text-red-700 font-bold shadow-[inset_1px_1px_#808080] border-t-black border-l-black border-r-white border-b-white" : ""}`}
                        title="Downvote"
                        onClick={(e) => { e.stopPropagation(); castVote(d.id, d.myVote, -1); }}
                      >▼</button>
                    </div>
                  </div>
                  {canDelete && d.author !== "Max8abug" && (
                    <button className="absolute top-1 right-1 win98-button px-1 text-[10px] opacity-0 group-hover:opacity-100" onClick={() => del(d.id)}>x</button>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {tab === "audit" && isAdmin && <ModAuditPanel area="drawing" />}
    </div>
  );
}
