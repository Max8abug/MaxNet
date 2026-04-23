import { useEffect, useRef, useState } from "react";
import { fetchDrawings, submitDrawing, type Drawing } from "../lib/api";

export function DrawingPad() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const drawing = useRef(false);
  const last = useRef<{ x: number; y: number } | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [drawings, setDrawings] = useState<Drawing[]>([]);
  const [index, setIndex] = useState(0);
  const [mode, setMode] = useState<"draw" | "view">("draw");
  const [author, setAuthor] = useState("anon");

  useEffect(() => {
    void refresh();
  }, []);

  useEffect(() => {
    if (mode !== "view" || drawings.length < 2) return;
    const t = setInterval(() => setIndex((i) => (i + 1) % drawings.length), 2500);
    return () => clearInterval(t);
  }, [mode, drawings.length]);

  async function refresh() {
    try {
      const d = await fetchDrawings();
      setDrawings(d);
    } catch {
      // ignore
    }
  }

  function clearCanvas() {
    const c = canvasRef.current;
    if (!c) return;
    const ctx = c.getContext("2d");
    if (!ctx) return;
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, c.width, c.height);
  }

  useEffect(() => {
    if (mode === "draw") {
      // Initialize canvas background once when entering draw mode
      const c = canvasRef.current;
      if (!c) return;
      const ctx = c.getContext("2d");
      if (!ctx) return;
      // Only paint white if currently transparent
      const img = ctx.getImageData(0, 0, 1, 1).data;
      if (img[3] === 0) {
        ctx.fillStyle = "#ffffff";
        ctx.fillRect(0, 0, c.width, c.height);
      }
    }
  }, [mode]);

  function getPos(e: React.PointerEvent) {
    const c = canvasRef.current!;
    const rect = c.getBoundingClientRect();
    return {
      x: ((e.clientX - rect.left) / rect.width) * c.width,
      y: ((e.clientY - rect.top) / rect.height) * c.height,
    };
  }

  function onPointerDown(e: React.PointerEvent) {
    e.preventDefault();
    e.stopPropagation();
    drawing.current = true;
    last.current = getPos(e);
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
  }
  function onPointerMove(e: React.PointerEvent) {
    if (!drawing.current) return;
    e.stopPropagation();
    const c = canvasRef.current!;
    const ctx = c.getContext("2d")!;
    const p = getPos(e);
    ctx.strokeStyle = "#111";
    ctx.lineWidth = 3;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.beginPath();
    ctx.moveTo(last.current!.x, last.current!.y);
    ctx.lineTo(p.x, p.y);
    ctx.stroke();
    last.current = p;
  }
  function onPointerUp(e: React.PointerEvent) {
    drawing.current = false;
    last.current = null;
    try { (e.target as HTMLElement).releasePointerCapture(e.pointerId); } catch {}
  }

  async function handleSubmit() {
    const c = canvasRef.current;
    if (!c) return;
    setSubmitting(true);
    try {
      const dataUrl = c.toDataURL("image/png");
      await submitDrawing(dataUrl, author);
      clearCanvas();
      await refresh();
      setMode("view");
    } catch {
      // ignore
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="w-full h-full flex flex-col gap-1 text-sm">
      <div className="flex gap-1 shrink-0">
        <button
          className={`win98-button px-2 py-0.5 ${mode === "draw" ? "shadow-[inset_1px_1px_#808080] border-t-black border-l-black border-r-white border-b-white" : ""}`}
          onClick={() => setMode("draw")}
        >
          Draw
        </button>
        <button
          className={`win98-button px-2 py-0.5 ${mode === "view" ? "shadow-[inset_1px_1px_#808080] border-t-black border-l-black border-r-white border-b-white" : ""}`}
          onClick={() => { setMode("view"); void refresh(); }}
        >
          Gallery ({drawings.length})
        </button>
        <div className="flex-1" />
        {mode === "draw" && (
          <>
            <button className="win98-button px-2 py-0.5" onClick={clearCanvas}>Clear</button>
            <button className="win98-button px-2 py-0.5 font-bold" disabled={submitting} onClick={handleSubmit}>
              {submitting ? "..." : "Submit"}
            </button>
          </>
        )}
      </div>

      {mode === "draw" && (
        <>
          <div className="flex-1 win98-inset bg-white overflow-hidden flex items-center justify-center">
            <canvas
              ref={canvasRef}
              width={400}
              height={300}
              className="w-full h-full bg-white touch-none cursor-crosshair"
              style={{ touchAction: "none" }}
              onPointerDown={onPointerDown}
              onPointerMove={onPointerMove}
              onPointerUp={onPointerUp}
              onPointerCancel={onPointerUp}
            />
          </div>
          <input
            type="text"
            placeholder="your name (optional)"
            value={author}
            onChange={(e) => setAuthor(e.target.value)}
            className="win98-inset px-1 shrink-0"
          />
        </>
      )}

      {mode === "view" && (
        <div className="flex-1 win98-inset bg-white flex flex-col items-center justify-center overflow-hidden p-1">
          {drawings.length === 0 ? (
            <div className="text-gray-500 text-xs">No drawings yet. Be the first.</div>
          ) : (
            <>
              <img
                src={drawings[index]?.dataUrl}
                alt="Visitor drawing"
                className="max-w-full max-h-full object-contain"
                draggable={false}
              />
              <div className="text-xs mt-1 truncate w-full text-center">
                by {drawings[index]?.author} — {index + 1}/{drawings.length}
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}
