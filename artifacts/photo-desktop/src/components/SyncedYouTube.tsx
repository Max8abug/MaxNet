import { useEffect, useRef, useState } from "react";
import { getYouTubeSync, setYouTubeSync } from "../lib/api";
import { useAuth } from "../lib/auth-store";

function parseYouTubeId(input: string): string | null {
  if (!input) return null;
  const trimmed = input.trim();
  if (/^[A-Za-z0-9_-]{11}$/.test(trimmed)) return trimmed;
  try {
    const u = new URL(trimmed);
    if (u.hostname.includes("youtu.be")) {
      const id = u.pathname.slice(1).split("/")[0];
      return /^[A-Za-z0-9_-]{11}$/.test(id) ? id : null;
    }
    if (u.hostname.includes("youtube.com")) {
      const v = u.searchParams.get("v");
      if (v && /^[A-Za-z0-9_-]{11}$/.test(v)) return v;
      const parts = u.pathname.split("/").filter(Boolean);
      const idx = parts.findIndex((p) => p === "embed" || p === "shorts");
      if (idx >= 0 && parts[idx + 1] && /^[A-Za-z0-9_-]{11}$/.test(parts[idx + 1])) return parts[idx + 1];
    }
  } catch {}
  return null;
}

export function SyncedYouTube() {
  const [state, setState] = useState<{ videoId: string; startedAt: string; setBy: string } | null>(null);
  const [input, setInput] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const offsetRef = useRef(0); // serverNow - clientNow
  const user = useAuth((s) => s.user);

  async function refresh() {
    try {
      const s = await getYouTubeSync();
      const serverMs = new Date(s.serverNow).getTime();
      offsetRef.current = serverMs - Date.now();
      setState({ videoId: s.videoId, startedAt: s.startedAt, setBy: s.setBy });
    } catch {}
  }
  useEffect(() => { void refresh(); const t = setInterval(refresh, 10000); return () => clearInterval(t); }, []);

  async function applyNew() {
    setErr(null);
    const id = parseYouTubeId(input);
    if (!id) { setErr("Couldn't parse a YouTube URL or ID"); return; }
    try { await setYouTubeSync(id); setInput(""); await refresh(); }
    catch (e: any) { setErr(e?.message || "Failed"); }
  }

  // Compute current offset in seconds based on server start time
  const startMs = state?.startedAt ? new Date(state.startedAt).getTime() : 0;
  const elapsed = state?.videoId
    ? Math.max(0, Math.floor(((Date.now() + offsetRef.current) - startMs) / 1000))
    : 0;

  const src = state?.videoId
    ? `https://www.youtube.com/embed/${state.videoId}?autoplay=1&start=${elapsed}&rel=0`
    : null;

  return (
    <div className="w-full h-full flex flex-col text-sm bg-black">
      <div className="flex-1 bg-black flex items-center justify-center overflow-hidden">
        {src ? (
          <iframe
            key={`${state?.videoId}-${state?.startedAt}`}
            src={src}
            className="w-full h-full"
            allow="autoplay; encrypted-media"
            allowFullScreen
          />
        ) : (
          <div className="text-gray-400 text-xs">No video. {user ? "Set one below." : "Log in to set."}</div>
        )}
      </div>
      <div className="bg-[#c0c0c0] p-1 shrink-0 flex flex-col gap-1">
        {state?.setBy && <div className="text-[10px] text-gray-700">Now playing — set by {state.setBy} (synced for everyone)</div>}
        {user ? (
          <div className="flex gap-1">
            <input
              className="win98-inset px-1 flex-1 text-xs"
              placeholder="Paste YouTube URL or video ID"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") void applyNew(); }}
            />
            <button className="win98-button px-2 text-xs" onClick={applyNew}>Play For All</button>
          </div>
        ) : (
          <div className="text-[10px] text-gray-600">Log in to change the video for everyone.</div>
        )}
        {err && <div className="text-red-700 text-[11px]">{err}</div>}
      </div>
    </div>
  );
}
