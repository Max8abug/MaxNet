import { useEffect, useMemo, useRef, useState } from "react";
import {
  createPlaylist,
  deletePlaylist,
  deleteTrack,
  fetchPlaylists,
  fetchTrackAudio,
  fetchTracks,
  updatePlaylistTracks,
  uploadTrack,
  type MusicPlaylist,
  type Track,
} from "../lib/api";
import { useAuth } from "../lib/auth-store";

function fileToDataUrl(f: File): Promise<string> {
  return new Promise((res, rej) => {
    const r = new FileReader();
    r.onload = () => res(r.result as string);
    r.onerror = rej;
    r.readAsDataURL(f);
  });
}

export function MusicPlayer() {
  const [tracks, setTracks] = useState<Track[]>([]);
  const [playlists, setPlaylists] = useState<MusicPlaylist[]>([]);
  const [selectedPlaylist, setSelectedPlaylist] = useState<number | null>(null);
  const [current, setCurrent] = useState<number>(-1);
  const [src, setSrc] = useState<string>("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [visualizerOn, setVisualizerOn] = useState(false);
  const audioRef = useRef<HTMLAudioElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const sourceRef = useRef<MediaElementAudioSourceNode | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const user = useAuth((s) => s.user);

  async function refresh() {
    try {
      const [nextTracks, nextPlaylists] = await Promise.all([fetchTracks(), fetchPlaylists()]);
      setTracks(nextTracks);
      setPlaylists(nextPlaylists);
    } catch (e: any) {
      setErr(e?.message || "Could not load the music library");
    }
  }
  useEffect(() => { void refresh(); }, []);

  const playlist = playlists.find((item) => item.id === selectedPlaylist) || null;
  const displayTracks = useMemo(() => {
    if (!playlist) return tracks;
    const byId = new Map(tracks.map((track) => [track.id, track]));
    return playlist.trackIds.map((id) => byId.get(id)).filter((track): track is Track => !!track);
  }, [playlist, tracks]);

  async function play(i: number) {
    const t = displayTracks[i];
    if (!t) return;
    setErr(null);
    setCurrent(i);
    setLoading(true);
    try {
      const url = await fetchTrackAudio(t.id);
      setSrc(url);
      await new Promise((r) => setTimeout(r, 80));
      const a = audioRef.current;
      if (a) {
        try { a.load(); } catch {}
        try { await a.play(); } catch { setErr("Tap ▶ once to allow audio"); }
      }
    } catch (e: any) {
      setErr(e?.message || "Failed to load track");
    } finally {
      setLoading(false);
    }
  }

  async function togglePlay() {
    const a = audioRef.current;
    if (!a) return;
    if (current < 0 && displayTracks.length > 0) { await play(0); return; }
    if (a.paused) {
      try { await a.play(); } catch (e: any) { setErr(e?.message || "Cannot play"); }
    } else {
      a.pause();
    }
  }
  async function next() {
    if (!displayTracks.length) return;
    await play(current < 0 ? 0 : (current + 1) % displayTracks.length);
  }
  async function prev() {
    if (!displayTracks.length) return;
    await play(current < 0 ? 0 : (current - 1 + displayTracks.length) % displayTracks.length);
  }

  async function upload(f: File) {
    if (!user) { setErr("Log in to upload"); return; }
    if (f.size > 6_000_000) { setErr("Max ~6MB"); return; }
    setBusy(true); setErr(null);
    try {
      const dataUrl = await fileToDataUrl(f);
      await uploadTrack(f.name.replace(/\.[^.]+$/, "").slice(0, 80), dataUrl);
      await refresh();
    } catch (e: any) { setErr(e?.message || "Failed"); }
    finally { setBusy(false); }
  }

  async function makePlaylist() {
    const name = window.prompt("Playlist name:");
    if (!name?.trim()) return;
    try {
      const created = await createPlaylist(name.trim());
      setPlaylists((items) => [created, ...items]);
      setSelectedPlaylist(created.id);
      setCurrent(-1);
    } catch (e: any) { setErr(e?.message || "Could not create playlist"); }
  }
  async function removeCurrentPlaylist() {
    if (!playlist || !user || (playlist.createdBy !== user.username && !user.isAdmin)) return;
    if (!window.confirm(`Delete playlist "${playlist.name}"?`)) return;
    try {
      await deletePlaylist(playlist.id);
      setSelectedPlaylist(null);
      await refresh();
    } catch (e: any) { setErr(e?.message || "Could not delete playlist"); }
  }
  async function toggleTrackInPlaylist(track: Track) {
    if (!playlist || !user || (playlist.createdBy !== user.username && !user.isAdmin)) return;
    const included = playlist.trackIds.includes(track.id);
    try {
      const nextIds = included
        ? playlist.trackIds.filter((id) => id !== track.id)
        : [...playlist.trackIds, track.id];
      const updated = await updatePlaylistTracks(playlist.id, nextIds);
      setPlaylists((items) => items.map((item) => item.id === updated.id ? updated : item));
    } catch (e: any) { setErr(e?.message || "Could not update playlist"); }
  }
  async function del(id: number) {
    if (!window.confirm("Delete track?")) return;
    try { await deleteTrack(id); await refresh(); } catch (e: any) { setErr(e?.message || "Could not delete track"); }
  }

  useEffect(() => {
    if (!visualizerOn) return;
    const audio = audioRef.current;
    const canvas = canvasRef.current;
    if (!audio || !canvas) return;
    try {
      const AudioContextClass = window.AudioContext || (window as typeof window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!AudioContextClass) return;
      const context = audioContextRef.current || new AudioContextClass();
      audioContextRef.current = context;
      const source = sourceRef.current || context.createMediaElementSource(audio);
      sourceRef.current = source;
      const analyser = analyserRef.current || context.createAnalyser();
      analyserRef.current = analyser;
      analyser.fftSize = 128;
      if (!sourceRef.current || !analyserRef.current) return;
      try { source.disconnect(); } catch {}
      source.connect(analyser);
      analyser.connect(context.destination);
      const data = new Uint8Array(analyser.frequencyBinCount);
      const ctx = canvas.getContext("2d");
      if (!ctx) return;
      let frame = 0;
      const draw = () => {
        analyser.getByteFrequencyData(data);
        ctx.fillStyle = "#050505";
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        const barWidth = canvas.width / data.length;
        data.forEach((value, i) => {
          const height = (value / 255) * canvas.height;
          ctx.fillStyle = `hsl(${115 + i * 2}, 80%, ${35 + value / 6}%)`;
          ctx.fillRect(i * barWidth, canvas.height - height, Math.max(1, barWidth - 1), height);
        });
        frame = requestAnimationFrame(draw);
      };
      void context.resume();
      draw();
      return () => cancelAnimationFrame(frame);
    } catch {
      setErr("The visualizer is not available in this browser.");
    }
    return undefined;
  }, [visualizerOn]);

  const cur = current >= 0 ? displayTracks[current] : null;
  const canEditPlaylist = !!playlist && !!user && (playlist.createdBy === user.username || user.isAdmin);

  return (
    <div className="w-full h-full flex flex-col text-xs gap-1">
      <div className="bg-black text-green-400 font-mono p-2 win98-inset">
        <div className="truncate">♪ {cur?.title || (displayTracks.length ? "(click a track to play)" : "(no tracks)")}</div>
        <div className="text-[10px] opacity-70">by {cur?.uploader || "—"} {loading && "· loading..."}</div>
      </div>
      {visualizerOn && <canvas ref={canvasRef} width={320} height={56} className="w-full h-14 bg-black win98-inset" aria-label="Music visualizer" />}
      <audio ref={audioRef} src={src} controls className="w-full" preload="auto" onEnded={next} />
      <div className="flex gap-1 flex-wrap">
        <button className="win98-button px-2" onClick={prev} disabled={!displayTracks.length}>⏮</button>
        <button className="win98-button px-2" onClick={togglePlay} disabled={!displayTracks.length}>▶/⏸</button>
        <button className="win98-button px-2" onClick={next} disabled={!displayTracks.length}>⏭</button>
        <button className={`win98-button px-2 ${visualizerOn ? "bg-[#d0e8ff]" : ""}`} onClick={() => setVisualizerOn((value) => !value)}>
          {visualizerOn ? "Hide visualizer" : "Visualizer"}
        </button>
        <div className="flex-1" />
        {user && (
          <>
            <input ref={fileRef} type="file" accept="audio/*" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) void upload(f); e.target.value = ""; }} />
            <button className="win98-button px-2" disabled={busy} onClick={() => fileRef.current?.click()}>+ Upload</button>
          </>
        )}
      </div>
      <div className="flex gap-1 items-center">
        <span className="font-bold">Library:</span>
        <select className="win98-inset flex-1 min-w-0 px-1" value={selectedPlaylist ?? ""} onChange={(e) => { setSelectedPlaylist(e.target.value ? Number(e.target.value) : null); setCurrent(-1); }}>
          <option value="">All uploaded tracks</option>
          {playlists.map((item) => <option key={item.id} value={item.id}>{item.name} ({item.trackIds.length})</option>)}
        </select>
        {user && <button className="win98-button px-1" onClick={() => void makePlaylist()}>+ Playlist</button>}
        {canEditPlaylist && <button className="win98-button px-1 text-red-700" onClick={() => void removeCurrentPlaylist()}>Delete</button>}
      </div>
      {playlist && <div className="text-[10px] text-gray-600">Playlist by {playlist.createdBy}{canEditPlaylist ? " — click + or − to manage tracks" : ""}</div>}
      {err && <div className="text-red-700 text-[11px]">{err}</div>}
      <div className="flex-1 win98-inset bg-white overflow-auto">
        {!displayTracks.length ? <div className="text-gray-500 p-2">{playlist ? "This playlist is empty." : "No tracks yet."}</div> :
          displayTracks.map((t, i) => (
            <div key={t.id} className={`flex items-center gap-1 px-1 py-0.5 cursor-pointer hover:bg-blue-100 ${i === current ? "bg-blue-200" : ""}`} onClick={() => void play(i)}>
              <span className="text-gray-500 w-5 text-right">{i + 1}.</span>
              <span className="flex-1 truncate">{t.title}</span>
              <span className="text-gray-500">{t.uploader}</span>
              {canEditPlaylist && (
                <button className="win98-button px-1 text-[10px]" onClick={(e) => { e.stopPropagation(); void toggleTrackInPlaylist(t); }}>
                  {playlist?.trackIds.includes(t.id) ? "−" : "+"}
                </button>
              )}
              {(user?.isAdmin || user?.username === t.uploader) && (
                <button className="win98-button px-1 text-[10px]" onClick={(e) => { e.stopPropagation(); void del(t.id); }}>x</button>
              )}
            </div>
          ))}
      </div>
    </div>
  );
}