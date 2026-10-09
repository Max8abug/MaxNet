import { useEffect, useId, useRef, useState, type PointerEvent, type ReactNode } from "react";
import { createPortal } from "react-dom";

type Geometry = { x: number; y: number; width: number; height: number };

function limits(mobile: boolean) {
  return {
    width: Math.max(1, window.innerWidth - 16),
    height: Math.max(1, window.innerHeight - (mobile ? 16 : 56)),
  };
}

function fit(rect: Geometry, mobile: boolean): Geometry {
  const available = limits(mobile);
  const width = Math.min(available.width, Math.max(Math.min(320, available.width), rect.width));
  const height = Math.min(available.height, Math.max(Math.min(240, available.height), rect.height));
  return {
    width,
    height,
    x: Math.max(8, Math.min(rect.x, available.width + 8 - width)),
    y: Math.max(8, Math.min(rect.y, available.height + 8 - height)),
  };
}

/** Keep profile controls independent of themed ancestors' clipping/containing blocks. */
export function ProfileDialogFrame({
  title, mobile, onClose, children,
}: {
  title: string;
  mobile: boolean;
  onClose: () => void;
  children: ReactNode;
}) {
  const titleId = useId();
  const closeRef = useRef<HTMLButtonElement>(null);
  const gesture = useRef<{ mode: "drag" | "resize"; startX: number; startY: number; rect: Geometry } | null>(null);
  const [rect, setRect] = useState<Geometry>(() => {
    const available = limits(mobile);
    const width = Math.min(440, available.width);
    const height = Math.min(640, available.height);
    return { width, height, x: (window.innerWidth - width) / 2, y: (available.height + 16 - height) / 2 };
  });

  useEffect(() => {
    const refit = () => setRect(previous => fit(previous, mobile));
    refit();
    window.addEventListener("resize", refit);
    closeRef.current?.focus();
    return () => window.removeEventListener("resize", refit);
  }, [mobile]);

  function start(event: PointerEvent<HTMLElement>, mode: "drag" | "resize") {
    if (mobile || event.button !== 0 || (mode === "drag" && (event.target as HTMLElement).closest("button"))) return;
    event.preventDefault();
    event.stopPropagation();
    gesture.current = { mode, startX: event.clientX, startY: event.clientY, rect };
    event.currentTarget.setPointerCapture(event.pointerId);
  }

  function move(event: PointerEvent<HTMLElement>) {
    const active = gesture.current;
    if (!active) return;
    const dx = event.clientX - active.startX;
    const dy = event.clientY - active.startY;
    if (active.mode === "drag") {
      setRect(fit({ ...active.rect, x: active.rect.x + dx, y: active.rect.y + dy }, mobile));
    } else {
      const available = limits(mobile);
      setRect(fit({
        ...active.rect,
        width: Math.min(active.rect.width + dx, available.width + 8 - active.rect.x),
        height: Math.min(active.rect.height + dy, available.height + 8 - active.rect.y),
      }, mobile));
    }
  }

  function end(event: PointerEvent<HTMLElement>) {
    gesture.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
  }

  return createPortal(
    <div className="fixed inset-0 z-[1000] bg-black/30"
      onPointerDown={event => { if (event.target === event.currentTarget) onClose(); }}>
      <div role="dialog" aria-modal="true" aria-labelledby={titleId}
        data-testid="profile-settings-window"
        className={`fixed win98-window flex min-h-0 flex-col overflow-hidden ${mobile ? "mobile-profile-dialog" : ""}`}
        style={{ left: rect.x, top: rect.y, width: rect.width, height: rect.height }}
        onPointerDown={event => event.stopPropagation()}
        onKeyDown={event => {
          if (event.key === "Escape") { event.stopPropagation(); onClose(); }
          if (event.key !== "Tab") return;
          const controls = Array.from(event.currentTarget.querySelectorAll<HTMLElement>(
            'button:not(:disabled), input:not(:disabled):not([type="hidden"]), select:not(:disabled), textarea:not(:disabled), [tabindex="0"]',
          )).filter(element => element.offsetParent !== null);
          const first = controls[0];
          const last = controls[controls.length - 1];
          if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
          if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
        }}>
        <div className={`win98-titlebar shrink-0 flex items-center justify-between gap-2 px-2 py-1 select-none ${mobile ? "" : "cursor-move"}`}
          data-testid="profile-settings-titlebar"
          style={{ touchAction: "none" }}
          onPointerDown={event => start(event, "drag")} onPointerMove={move}
          onPointerUp={end} onPointerCancel={end} onLostPointerCapture={() => { gesture.current = null; }}>
          <span id={titleId} className="min-w-0 truncate text-sm">{title}</span>
          <button ref={closeRef} className="win98-button shrink-0 px-1.5 leading-none"
            aria-label="Close profile settings" onClick={onClose}>x</button>
        </div>
        {children}
        {!mobile && <button type="button" aria-label="Resize profile settings"
          title="Drag to resize, or use arrow keys"
          data-testid="profile-settings-resize"
          className="absolute bottom-0 right-0 h-5 w-5 cursor-se-resize select-none"
          style={{ touchAction: "none", zIndex: 5 }}
          onPointerDown={event => start(event, "resize")} onPointerMove={move}
          onPointerUp={end} onPointerCancel={end} onLostPointerCapture={() => { gesture.current = null; }}
          onKeyDown={event => {
            const delta = { ArrowLeft: [-20, 0], ArrowRight: [20, 0], ArrowUp: [0, -20], ArrowDown: [0, 20] }[event.key];
            if (!delta) return;
            event.preventDefault();
            const available = limits(mobile);
            setRect(previous => fit({
              ...previous,
              width: Math.min(previous.width + delta[0], available.width + 8 - previous.x),
              height: Math.min(previous.height + delta[1], available.height + 8 - previous.y),
            }, mobile));
          }}><span aria-hidden="true">◢</span></button>}
      </div>
    </div>,
    document.body,
  );
}
