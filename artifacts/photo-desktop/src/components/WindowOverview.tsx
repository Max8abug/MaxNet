import { useEffect, useRef, useState } from "react";
import { useDesktopStore, type WindowData } from "../store";
import { X, ZoomIn, ZoomOut } from "lucide-react";
import { isFeatureHiddenFromLaunchers } from "@workspace/feature-registry";

const EMPTY_WINDOWS: WindowData[] = [];
type Point = { x: number; y: number };

export function WindowOverview({ page, onClose }: { page: string; onClose: () => void }) {
  const storedWindows = useDesktopStore((state) => state.windows[page] ?? EMPTY_WINDOWS);
  const windows = storedWindows.filter((item) => !isFeatureHiddenFromLaunchers(item.type));
  const [stageSize, setStageSize] = useState({ width: 1280, height: 720 });
  const [zoom, setZoom] = useState(100);
  const [dragPoints, setDragPoints] = useState<Record<string, Point>>({});
  const drag = useRef<{ id: string; pointerX: number; pointerY: number; x: number; y: number; width: number; height: number; moved: boolean } | null>(null);

  useEffect(() => {
    const stage = document.querySelector<HTMLElement>(".desktop-surface");
    if (!stage) return;
    const measure = () => setStageSize({ width: stage.clientWidth || 1280, height: stage.clientHeight || 720 });
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(stage);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  const scale = Math.min(1, 920 / stageSize.width, 520 / stageSize.height) * zoom / 100;
  const canvasWidth = stageSize.width * scale;
  const canvasHeight = stageSize.height * scale;
  const geometryFor = (item: WindowData) => {
    const saved = item.state === "max" && item.prev ? { ...item, ...item.prev } : item;
    const width = Math.min(saved.width, Math.max(120, stageSize.width - 8));
    const height = Math.min(saved.height, Math.max(80, stageSize.height - 48));
    return { x: Math.max(0, Math.min(saved.x, stageSize.width - width)), y: Math.max(0, Math.min(saved.y, stageSize.height - height)), width, height };
  };
  const updatePosition = (item: WindowData, point: Point, width: number, height: number) => {
    useDesktopStore.getState().updateWindow(page, item.id, {
      x: point.x, y: point.y, width, height, state: "normal",
    });
  };

  return (
    <div className="fixed inset-0 z-[20000] flex items-center justify-center bg-black/70 p-4" role="presentation"
      onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <section className="w-full max-w-[1100px] max-h-[92dvh] overflow-auto border-2 border-white bg-[#c0c0c0] p-3 text-black shadow-2xl"
        role="dialog" aria-modal="true" aria-labelledby="window-overview-title" data-testid="window-overview">
        <header className="mb-3 flex items-center justify-between gap-4 border-b border-[#808080] pb-2">
          <div>
            <h2 id="window-overview-title" className="text-base font-bold">Desktop overview</h2>
            <p className="mt-1 text-xs">Drag windows to reposition them. Click one to restore it and return to the desktop.</p>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <button type="button" className="win98-button flex h-8 items-center gap-1 px-2 text-xs" onClick={() => setZoom((value) => Math.max(50, value - 10))} aria-label="Zoom out overview" title="Zoom out">
              <ZoomOut className="h-4 w-4" />
            </button>
            <span className="min-w-10 text-center text-xs">{zoom}%</span>
            <button type="button" className="win98-button flex h-8 items-center gap-1 px-2 text-xs" onClick={() => setZoom((value) => Math.min(100, value + 10))} aria-label="Zoom in overview" title="Zoom in">
              <ZoomIn className="h-4 w-4" />
            </button>
            <button type="button" className="win98-button flex h-8 items-center gap-1 px-2 text-xs" onClick={onClose} aria-label="Close desktop overview">
              <X className="h-4 w-4" /> Close
            </button>
          </div>
        </header>
        <div className="flex max-h-[70dvh] min-h-48 items-center justify-center overflow-auto bg-[#404040] p-3">
          <div style={{ width: canvasWidth, height: canvasHeight, flex: "0 0 auto", overflow: "hidden", position: "relative", border: "2px solid #fff" }}>
            <div className="absolute left-0 top-0 origin-top-left bg-[#008080]" style={{ width: stageSize.width, height: stageSize.height, transform: `scale(${scale})` }}>
              {windows.map((item) => {
                const base = geometryFor(item);
                const point = dragPoints[item.id] ?? { x: base.x, y: base.y };
                return (
                  <button key={item.id} type="button" aria-label={`Move or restore ${item.title}`}
                    className="absolute flex flex-col overflow-hidden border-2 border-l-white border-t-white border-r-[#404040] border-b-[#404040] bg-[#c0c0c0] text-left shadow-lg"
                    style={{ left: point.x, top: point.y, width: base.width, height: base.height, touchAction: "none", cursor: "grab" }}
                    onPointerDown={(event) => {
                      event.preventDefault();
                      event.currentTarget.setPointerCapture(event.pointerId);
                      drag.current = { id: item.id, pointerX: event.clientX, pointerY: event.clientY, x: point.x, y: point.y, width: base.width, height: base.height, moved: false };
                    }}
                    onPointerMove={(event) => {
                      const current = drag.current;
                      if (!current || current.id !== item.id) return;
                      const dx = (event.clientX - current.pointerX) / scale;
                      const dy = (event.clientY - current.pointerY) / scale;
                      if (Math.abs(dx) + Math.abs(dy) > 3) current.moved = true;
                      const next = {
                        x: Math.max(0, Math.min(current.x + dx, stageSize.width - current.width)),
                        y: Math.max(0, Math.min(current.y + dy, stageSize.height - current.height)),
                      };
                      setDragPoints((points) => ({ ...points, [item.id]: next }));
                    }}
                    onPointerUp={(event) => {
                      const current = drag.current;
                      if (!current || current.id !== item.id) return;
                      const dx = (event.clientX - current.pointerX) / scale;
                      const dy = (event.clientY - current.pointerY) / scale;
                      const point = {
                        x: Math.max(0, Math.min(current.x + dx, stageSize.width - current.width)),
                        y: Math.max(0, Math.min(current.y + dy, stageSize.height - current.height)),
                      };
                      drag.current = null;
                      updatePosition(item, point, current.width, current.height);
                      if (!current.moved) {
                        useDesktopStore.getState().bringToFront(page, item.id);
                        onClose();
                      }
                    }}
                    onPointerCancel={() => { drag.current = null; }}
                    onKeyDown={(event) => {
                      const offsets: Record<string, Point> = {
                        ArrowLeft: { x: -20, y: 0 }, ArrowRight: { x: 20, y: 0 },
                        ArrowUp: { x: 0, y: -20 }, ArrowDown: { x: 0, y: 20 },
                      };
                      const offset = offsets[event.key];
                      if (!offset) return;
                      event.preventDefault();
                      const next = {
                        x: Math.max(0, Math.min(point.x + offset.x, stageSize.width - base.width)),
                        y: Math.max(0, Math.min(point.y + offset.y, stageSize.height - base.height)),
                      };
                      setDragPoints((points) => ({ ...points, [item.id]: next }));
                      updatePosition(item, next, base.width, base.height);
                    }}
                    onClick={(event) => {
                      if (event.detail !== 0) return;
                      updatePosition(item, point, base.width, base.height);
                      useDesktopStore.getState().bringToFront(page, item.id);
                      onClose();
                    }}>
                    <span className="flex h-7 shrink-0 items-center gap-2 overflow-hidden bg-[#000080] px-2 text-xs font-bold text-white">
                      <span className="h-3 w-3 shrink-0 bg-white/70" /> <span className="truncate">{item.title}</span>
                    </span>
                    <span className="flex-1 bg-white/80 p-2 text-[10px] text-gray-700">{item.type}</span>
                  </button>
                );
              })}
              {!windows.length && <p className="p-8 text-white">There are no windows on this desktop.</p>}
            </div>
          </div>
        </div>
      </section>
    </div>
  );
}
