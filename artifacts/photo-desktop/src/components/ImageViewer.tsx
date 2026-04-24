import { useEffect, useState } from "react";

let setOpen: ((url: string | null) => void) | null = null;

export function showFullscreen(url: string) {
  if (setOpen) setOpen(url);
}

export function ImageViewerHost() {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    setOpen = setUrl;
    return () => { setOpen = null; };
  }, []);
  useEffect(() => {
    if (!url) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setUrl(null); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [url]);
  if (!url) return null;
  return (
    <div className="fixed inset-0 z-[2500] bg-black/90 flex items-center justify-center" onClick={() => setUrl(null)}>
      <img src={url} alt="" className="max-w-[95vw] max-h-[95vh] object-contain" />
      <button className="absolute top-3 right-3 win98-button px-3 py-1" onClick={() => setUrl(null)}>Close</button>
    </div>
  );
}
