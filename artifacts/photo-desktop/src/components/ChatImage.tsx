import { useEffect, useState } from "react";
import { useAuth } from "../lib/auth-store";
import { resolveChatGif } from "../lib/chat-gif";

export function ChatImage({ src, onOpen }: { src: string; onOpen: (url: string) => void }) {
  const username = useAuth(state => state.user?.username);
  const [resolved, setResolved] = useState<string | null>(src);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let alive = true;
    setFailed(false);
    let sharePage = false;
    try { sharePage = ["tenor.com", "www.tenor.com", "m.tenor.com", "tenor.co", "www.tenor.co"].includes(new URL(src).hostname); } catch { /* Uploaded data image. */ }
    if (!sharePage) { setResolved(src); return; }
    setResolved(null);
    if (!username) { setFailed(true); return; }
    void resolveChatGif(src).then(url => { if (alive) setResolved(url); })
      .catch(() => { if (alive) setFailed(true); });
    return () => { alive = false; };
  }, [src, username]);
  if (failed) return <a href={src} target="_blank" rel="noreferrer" className="text-xs underline text-blue-800"
    onClick={event => event.stopPropagation()}>Image unavailable — open attachment</a>;
  if (!resolved) return <span className="text-xs text-gray-600">Loading GIF…</span>;
  return <img src={resolved} alt="Chat attachment" referrerPolicy="no-referrer"
    className="max-w-[260px] max-h-[200px] win98-inset cursor-zoom-in"
    onError={() => setFailed(true)} onClick={event => { event.stopPropagation(); onOpen(resolved); }} />;
}
