import { useEffect, useRef, useState } from "react";
import { fetchTracks, fetchTrackAudio, uploadTrack, deleteTrack, fetchPlaylists, createPlaylist, addPlaylistTrack, removePlaylistTrack, deletePlaylist, type Track, type Playlist } from "../lib/api";
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
  const [visualizer, setVisualizer] = useState(false);
  const [playlists, setPlaylists] = useState<Playlist[]>([]);
  const [selectedPlaylist, setSelectedPlaylist] = useState<number | null>(null);
  const audioRef = useRef<HTMLAudioElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const sourceRef = useRef<MediaElementAudioSourceNode | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const user = useAuth((s) => s.user);
  const activeTracks = selectedPlaylist
    ? playlists.find((playlist) => playlist.id === selectedPlaylist)?.tracks || []
    : tracks;

  async function refresh() { try { setTracks(await fetchTracks()); setPlaylists(await fetchPlaylists()); } catch {} }
  useEffect(() => { void refresh(); }, []);
  useEffect(() => {
    if (!visualizer) return;
    const audio = audioRef.current, canvas = canvasRef.current;
    if (!audio || !canvas || !("AudioContext" in window || "webkitAudioContext" in (window as any))) return;
    try {
      const Ctx = (window.AudioContext || (window as any).webkitAudioContext) as typeof AudioContext;
      const ctx = audioCtxRef.current || new Ctx();
      audioCtxRef.current = ctx;
      if (!sourceRef.current) {
        sourceRef.current = ctx.createMediaElementSource(audio);
        analyserRef.current = ctx.createAnalyser();
        analyserRef.current.fftSize = 64;
        sourceRef.current.connect(analyserRef.current);
        analyserRef.current.connect(ctx.destination);
      }
      const analyser = analyserRef.current, c = canvas.getContext("2d");
      if (!analyser || !c) return;
      const data = new Uint8Array(analyser.frequencyBinCount);
      let frame = 0;
      const draw = () => {
        analyser.getByteFrequencyData(data);
        c.fillStyle = "#05051b"; c.fillRect(0, 0, canvas.width, canvas.height);
        const bar = canvas.width / data.length;
        data.forEach((v, i) => { const h = (v / 255) * canvas.height; c.fillStyle = `hsl(${190 + i * 4},100%,${45 + v / 5}%)`; c.fillRect(i * bar, canvas.height - h, Math.max(1, bar - 1), h); });
        frame = requestAnimationFrame(draw);
      };
      void ctx.resume().catch(() => {});
      draw();
      return () => cancelAnimationFrame(frame);
    } catch {
      /* Unsupported browsers keep ordinary audio playback. */
      return undefined;
    }
  }, [visualizer]);

  async function play(i: number) {
    const t = activeTracks[i]; if (!t) return;
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
    if (current < 0 && activeTracks.length > 0) { await play(0); return; }
    if (a.paused) {
      try { await a.play(); } catch (e: any) { setErr(e?.message || "Cannot play"); }
    } else {
      a.pause();
    }
  }

  async function next() {
    if (activeTracks.length === 0) return;
    const ni = current < 0 ? 0 : (current + 1) % activeTracks.length;
    await play(ni);
  }
  async function prev() {
    if (activeTracks.length === 0) return;
    const pi = current < 0 ? 0 : (current - 1 + activeTracks.length) % activeTracks.length;
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
  async function newPlaylist() {
    const name = window.prompt("Playlist name");
    if (!name?.trim()) return;
    try { const p = await createPlaylist(name.trim()); setPlaylists(v => [p, ...v]); setSelectedPlaylist(p.id); } catch (e: any) { setErr(e?.message || "Could not create playlist"); }
  }
  async function addToPlaylist(trackId: number) {
    if (!selectedPlaylist) return;
    try { await addPlaylistTrack(selectedPlaylist, trackId); await refresh(); } catch (e: any) { setErr(e?.message || "Could not add track"); }
  }

  const cur = current >= 0 ? activeTracks[current] : null;

  return (
    <div className="w-full h-full flex flex-col text-xs gap-1">
      <div className="bg-black text-green-400 font-mono p-2 win98-inset">
        <div className="truncate">♪ {cur?.title || (tracks.length ? "(click a track to play)" : "(no tracks)")}</div>
        <div className="text-[10px] opacity-70">by {cur?.uploader || "—"} {loading && "· loading..."}</div>
      </div>
       <audio ref={audioRef} src={src} controls className="w-full" preload="auto" onEnded={next} />
       <div className="flex items-center gap-2">
         <button className="win98-button px-2" onClick={() => setVisualizer(v => !v)}>{visualizer ? "Hide Visualizer" : "♪ Visualizer"}</button>
         {visualizer && <canvas ref={canvasRef} width={320} height={52} className="flex-1 bg-[#05051b] win98-inset" aria-label="Music visualizer" />}
       </div>
      <div className="flex gap-1">
         <button className="win98-button px-2" onClick={prev} disabled={activeTracks.length === 0}>⏮</button>
         <button className="win98-button px-2" onClick={togglePlay} disabled={activeTracks.length === 0}>▶/⏸</button>
         <button className="win98-button px-2" onClick={next} disabled={activeTracks.length === 0}>⏭</button>
        <div className="flex-1" />
        {user && (
          <>
            <input ref={fileRef} type="file" accept="audio/*" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) void upload(f); e.target.value = ""; }} />
            <button className="win98-button px-2" disabled={busy} onClick={() => fileRef.current?.click()}>+ Upload</button>
          </>
        )}
         {user && <button className="win98-button px-2" onClick={() => void newPlaylist()}>+ Playlist</button>}
      </div>
       {playlists.length > 0 && <div className="flex gap-1 items-center">
         <select className="win98-inset flex-1 px-1" value={selectedPlaylist ?? ""} onChange={e => { setSelectedPlaylist(Number(e.target.value) || null); setCurrent(-1); }}>
           <option value="">All tracks</option>
           {playlists.map(p => <option key={p.id} value={p.id}>{p.name} ({p.tracks.length})</option>)}
         </select>
         {selectedPlaylist && user && playlists.find(p => p.id === selectedPlaylist)?.owner === user.username &&
           <button className="win98-button px-1" onClick={() => { const p = playlists.find(x => x.id === selectedPlaylist); if (p) void (async () => { try { await deletePlaylist(p.id); setPlaylists(v => v.filter(x => x.id !== p.id)); setSelectedPlaylist(null); } catch {} })(); }}>Delete</button>}
       </div>}
      {err && <div className="text-red-700 text-[11px]">{err}</div>}
      <div className="flex-1 win98-inset bg-white overflow-auto">
          {activeTracks.length === 0 ? <div className="text-gray-500 p-2">{selectedPlaylist ? "This playlist is empty." : "No tracks yet."}</div> :
            activeTracks.map((t, i) => (
            <div key={t.id} className={`flex items-center gap-1 px-1 py-0.5 cursor-pointer hover:bg-blue-100 ${i === current ? "bg-blue-200" : ""}`} onClick={() => play(i)}>
              <span className="text-gray-500 w-5 text-right">{i + 1}.</span>
              <span className="flex-1 truncate">{t.title}</span>
              <span className="text-gray-500">{t.uploader}</span>
              {(user?.isAdmin || user?.username === t.uploader) && (
                <button className="win98-button px-1 text-[10px]" onClick={(e) => { e.stopPropagation(); del(t.id); }}>x</button>
              )}
               {selectedPlaylist && user?.username === playlists.find(p => p.id === selectedPlaylist)?.owner && <button className="win98-button px-1 text-[10px]" onClick={(e) => { e.stopPropagation(); void removePlaylistTrack(selectedPlaylist, t.id).then(refresh); }}>−</button>}
               {!selectedPlaylist && user && playlists.some(p => p.owner === user.username) && <button className="win98-button px-1 text-[10px]" onClick={(e) => { e.stopPropagation(); void addToPlaylist(t.id); }}>＋</button>}
            </div>
          ))}
      </div>
    </div>
  );
}
