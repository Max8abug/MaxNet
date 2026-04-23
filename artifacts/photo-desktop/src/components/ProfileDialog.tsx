import { useRef, useState } from "react";
import { useAuth } from "../lib/auth-store";

interface Props { onClose: () => void; }

function fileToDataUrl(file: File, maxSize = 512): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const img = new Image();
      img.onload = () => {
        const canvas = document.createElement("canvas");
        const scale = Math.min(1, maxSize / Math.max(img.width, img.height));
        canvas.width = Math.round(img.width * scale);
        canvas.height = Math.round(img.height * scale);
        const ctx = canvas.getContext("2d")!;
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
        resolve(canvas.toDataURL("image/jpeg", 0.85));
      };
      img.onerror = reject;
      img.src = reader.result as string;
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

function fileToDataUrlRaw(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

export function ProfileDialog({ onClose }: Props) {
  const { user, updateProfile } = useAuth();
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [color, setColor] = useState(user?.backgroundColor || "#008080");
  const avatarRef = useRef<HTMLInputElement>(null);
  const bgRef = useRef<HTMLInputElement>(null);

  if (!user) return null;

  async function pickAvatar(file: File) {
    setBusy(true); setErr(null);
    try {
      const dataUrl = await fileToDataUrl(file, 256);
      await updateProfile({ avatarUrl: dataUrl });
    } catch (e: any) { setErr(e?.message || "Failed"); }
    finally { setBusy(false); }
  }

  async function pickBg(file: File) {
    setBusy(true); setErr(null);
    try {
      const dataUrl = await fileToDataUrl(file, 1600);
      await updateProfile({ backgroundUrl: dataUrl, backgroundColor: null });
    } catch (e: any) { setErr(e?.message || "Failed"); }
    finally { setBusy(false); }
  }

  async function applyColor() {
    setBusy(true); setErr(null);
    try { await updateProfile({ backgroundColor: color, backgroundUrl: null }); }
    catch (e: any) { setErr(e?.message || "Failed"); }
    finally { setBusy(false); }
  }

  async function clearAvatar() {
    setBusy(true);
    try { await updateProfile({ avatarUrl: null }); }
    finally { setBusy(false); }
  }

  async function clearBg() {
    setBusy(true);
    try { await updateProfile({ backgroundUrl: null, backgroundColor: null }); }
    finally { setBusy(false); }
  }

  return (
    <div
      className="fixed inset-0 z-[1000] flex items-center justify-center bg-black/30"
      onPointerDown={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="win98-window bg-[#c0c0c0] w-[360px] flex flex-col" onPointerDown={(e) => e.stopPropagation()}>
        <div className="bg-[#000080] text-white px-2 py-1 flex items-center justify-between text-sm">
          <span>Profile Settings — {user.username}</span>
          <button className="win98-button px-1.5 leading-none" onClick={onClose}>x</button>
        </div>
        <div className="p-3 flex flex-col gap-3 text-sm">
          <div className="flex items-center gap-3">
            {user.avatarUrl
              ? <img src={user.avatarUrl} alt="" className="w-16 h-16 win98-inset object-cover" />
              : <div className="w-16 h-16 win98-inset bg-gray-300 flex items-center justify-center text-2xl">?</div>}
            <div className="flex flex-col gap-1 flex-1">
              <button className="win98-button px-2 py-0.5" disabled={busy} onClick={() => avatarRef.current?.click()}>
                Change Avatar...
              </button>
              <button className="win98-button px-2 py-0.5 text-xs" disabled={busy} onClick={clearAvatar}>
                Remove Avatar
              </button>
            </div>
            <input ref={avatarRef} type="file" accept="image/*" className="hidden"
              onChange={(e) => { const f = e.target.files?.[0]; if (f) void pickAvatar(f); e.target.value = ""; }} />
          </div>

          <div className="border-t border-gray-400 pt-2">
            <div className="font-bold mb-1">Desktop Background</div>
            <div className="flex flex-col gap-1">
              <button className="win98-button px-2 py-0.5" disabled={busy} onClick={() => bgRef.current?.click()}>
                Upload Background Image...
              </button>
              <input ref={bgRef} type="file" accept="image/*" className="hidden"
                onChange={(e) => { const f = e.target.files?.[0]; if (f) void pickBg(f); e.target.value = ""; }} />
              <div className="flex items-center gap-2 mt-1">
                <span>Solid color:</span>
                <input type="color" value={color} onChange={(e) => setColor(e.target.value)} className="win98-inset" />
                <button className="win98-button px-2 py-0.5" disabled={busy} onClick={applyColor}>Apply</button>
              </div>
              <button className="win98-button px-2 py-0.5 text-xs self-start" disabled={busy} onClick={clearBg}>
                Reset to Default
              </button>
            </div>
          </div>
          {err && <div className="text-red-700 text-xs">{err}</div>}
        </div>
      </div>
    </div>
  );
}
