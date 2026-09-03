import { useEffect, useRef, useState } from "react";
import { fetchPhotos, uploadPhoto, deletePhoto, type SharedPhoto } from "../lib/api";
import { useAuth } from "../lib/auth-store";

export function SharedPhotos() {
  const [photos, setPhotos] = useState<SharedPhoto[]>([]);
  const [active, setActive] = useState<number>(0);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [caption, setCaption] = useState("");
  const fileRef = useRef<HTMLInputElement>(null);
  const user = useAuth((s) => s.user);

  async function refresh() {
    try { const p = await fetchPhotos(); setPhotos(p); if (active >= p.length) setActive(0); }
    catch {}
  }
  useEffect(() => { void refresh(); }, []);

  async function handleFile(file: File) {
    setBusy(true); setErr(null);
    try {
      const dataUrl = await fileToDataUrl(file);
      await uploadPhoto(dataUrl, caption);
      setCaption("");
      await refresh();
    } catch (e: any) {
      setErr(e?.message || "Upload failed");
    } finally { setBusy(false); }
  }

  async function handleDelete(id: number) {
    if (!confirm("Delete this photo for everyone?")) return;
    try { await deletePhoto(id); await refresh(); } catch {}
  }

  const current = photos[active];

  return (
    <div className="w-full h-full flex flex-col text-sm">
      <div className="flex-1 win98-inset bg-black flex items-center justify-center overflow-hidden">
        {current ? (
          <img src={current.dataUrl} alt={current.caption} className="max-w-full max-h-full object-contain" draggable={false} />
        ) : (
          <div className="text-gray-400 text-xs">No photos uploaded yet.</div>
        )}
      </div>
      {current?.caption && (
        <div className="text-center text-xs italic mt-1 truncate" style={{ fontFamily: "Georgia, serif" }}>
          {current.caption}
        </div>
      )}
      <div className="flex gap-1 mt-1 items-center shrink-0">
        <button className="win98-button px-2" disabled={photos.length < 2} onClick={() => setActive((i) => (i - 1 + photos.length) % photos.length)}>&lt;</button>
        <div className="text-xs flex-1 text-center">
          {photos.length === 0 ? "0 / 0" : `${active + 1} / ${photos.length}`}
        </div>
        <button className="win98-button px-2" disabled={photos.length < 2} onClick={() => setActive((i) => (i + 1) % photos.length)}>&gt;</button>
        {user?.isAdmin && current && (
          <button className="win98-button px-2 text-red-700" onClick={() => handleDelete(current.id)}>Delete</button>
        )}
      </div>
      {user?.isAdmin ? (
        <div className="mt-1 flex flex-col gap-1 shrink-0 border-t border-gray-400 pt-1">
          <input
            className="win98-inset px-1"
            placeholder="Caption (optional)"
            value={caption}
            onChange={(e) => setCaption(e.target.value)}
          />
          <div className="flex gap-1">
            <input
              ref={fileRef}
              type="file"
              accept="image/*"
              className="hidden"
              onChange={(e) => { const f = e.target.files?.[0]; if (f) void handleFile(f); e.target.value = ""; }}
            />
            <button className="win98-button px-2 py-0.5 flex-1" disabled={busy} onClick={() => fileRef.current?.click()}>
              {busy ? "Uploading..." : "Upload Photo"}
            </button>
          </div>
          {err && <div className="text-red-700 text-xs">{err}</div>}
        </div>
      ) : (
        <div className="mt-1 text-[11px] text-gray-600 text-center shrink-0 border-t border-gray-400 pt-1">
          Only the site owner can upload photos.
        </div>
      )}
    </div>
  );
}

function fileToDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(new Error("Read failed"));
    reader.readAsDataURL(file);
  });
}
