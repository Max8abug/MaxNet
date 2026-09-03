import { useEffect, useRef, useState } from "react";
import { fetchTracks, fetchTrackAudio, uploadTrack, deleteTrack, type Track } from "../lib/api";
import { useAuth } from "../lib/auth-store";

function fileToDataUrl(f: File): Promise<string> {
  return new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(r.result as string); r.onerror = rej; r.readAsDataURL(f); });
}

export function MusicPlayer() {
  const [tracks, setTracks] = useState<Track[]>([]);
  const [current, setCurrent] = useState<number>(-1);
  const [src, setSrc] = useState<string>("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const audioRef = useRef<HTMLAudioElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const user = useAuth((s) => s.user);

  async function refresh() { try { setTracks(await fetchTracks()); } catch {} }
  useEffect(() => { void refresh(); }, []);

  async function play(i: number) {
    const t = tracks[i]; if (!t) return;
    setErr(null);
    setCurrent(i);
    setLoading(true);
    try {
      const url = await fetchTrackAudio(t.id);
      setSrc(url);
      // Wait a tick for the audio element to receive the new src, then play
      await new Promise(r => setTimeout(r, 80));
      const a = audioRef.current;
      if (a) {
        try { a.load(); } catch {}
        try { await a.play(); } catch (e: any) { setErr("Tap ▶ once to allow audio"); }
      }
    } catch (e: any) { setErr(e?.message || "Failed to load track"); }
    finally { setLoading(false); }
  }

  async function togglePlay() {
    const a = audioRef.current;
    if (!a) return;
    if (current < 0 && tracks.length > 0) { await play(0); return; }
    if (a.paused) {
      try { await a.play(); } catch (e: any) { setErr(e?.message || "Cannot play"); }
    } else {
      a.pause();
    }
  }

  async function next() {
    if (tracks.length === 0) return;
    const ni = current < 0 ? 0 : (current + 1) % tracks.length;
    await play(ni);
  }
  async function prev() {
    if (tracks.length === 0) return;
    const pi = current < 0 ? 0 : (current - 1 + tracks.length) % tracks.length;
    await play(pi);
  }

  async function upload(f: File) {
    if (!user) { setErr("Log in to upload"); return; }
    if (f.size > 6_000_000) { setErr("Max ~6MB"); return; }
    setBusy(true); setErr(null);
    try {
      const dataUrl = await fileToDataUrl(f);
      const title = f.name.replace(/\.[^.]+$/, "").slice(0, 80);
      await uploadTrack(title, dataUrl);
      await refresh();
    } catch (e: any) { setErr(e?.message || "Failed"); }
    finally { setBusy(false); }
  }

  async function del(id: number) {
    if (!confirm("Delete track?")) return;
    try { await deleteTrack(id); await refresh(); } catch {}
  }

  const cur = current >= 0 ? tracks[current] : null;

  return (
    <div className="w-full h-full flex flex-col text-xs gap-1">
      <div className="bg-black text-green-400 font-mono p-2 win98-inset">
        <div className="truncate">♪ {cur?.title || (tracks.length ? "(click a track to play)" : "(no tracks)")}</div>
        <div className="text-[10px] opacity-70">by {cur?.uploader || "—"} {loading && "· loading..."}</div>
      </div>
      <audio ref={audioRef} src={src} controls className="w-full" preload="auto" onEnded={next} />
      <div className="flex gap-1">
        <button className="win98-button px-2" onClick={prev} disabled={tracks.length === 0}>⏮</button>
        <button className="win98-button px-2" onClick={togglePlay} disabled={tracks.length === 0}>▶/⏸</button>
        <button className="win98-button px-2" onClick={next} disabled={tracks.length === 0}>⏭</button>
        <div className="flex-1" />
        {user && (
          <>
            <input ref={fileRef} type="file" accept="audio/*" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) void upload(f); e.target.value = ""; }} />
            <button className="win98-button px-2" disabled={busy} onClick={() => fileRef.current?.click()}>+ Upload</button>
          </>
        )}
      </div>
      {err && <div className="text-red-700 text-[11px]">{err}</div>}
      <div className="flex-1 win98-inset bg-white overflow-auto">
        {tracks.length === 0 ? <div className="text-gray-500 p-2">No tracks yet.</div> :
          tracks.map((t, i) => (
            <div key={t.id} className={`flex items-center gap-1 px-1 py-0.5 cursor-pointer hover:bg-blue-100 ${i === current ? "bg-blue-200" : ""}`} onClick={() => play(i)}>
              <span className="text-gray-500 w-5 text-right">{i + 1}.</span>
              <span className="flex-1 truncate">{t.title}</span>
              <span className="text-gray-500">{t.uploader}</span>
              {(user?.isAdmin || user?.username === t.uploader) && (
                <button className="win98-button px-1 text-[10px]" onClick={(e) => { e.stopPropagation(); del(t.id); }}>x</button>
              )}
            </div>
          ))}
      </div>
    </div>
  );
}
