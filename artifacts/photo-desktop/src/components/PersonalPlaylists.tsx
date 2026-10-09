import { useCallback, useEffect, useRef, useState } from "react";
import {
  addPersonalPlaylistLinks,
  createPersonalPlaylist,
  deletePersonalPlaylist,
  fetchPersonalPlaylists,
  updatePersonalPlaylist,
  type PersonalYouTubePlaylist,
  type PersonalYouTubeTrack,
} from "../lib/personal-playlists-api";
import { useAuth } from "../lib/auth-store";
import { PersonalYouTubePlayer } from "./PersonalYouTubePlayer";
import { stepShuffle, type ShuffleSession } from "../lib/playlist-shuffle";

const MAX_LINKS = 100;
const MAX_TRACKS = 200;

interface Playing { playlistId: number; trackId: string; videoId: string }
interface Feedback { added: number; duplicates: number; rejected: string[] }

function PersonalPlaylistsInner({ username }: { username: string }) {
  const [playlists, setPlaylists] = useState<PersonalYouTubePlaylist[]>([]);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [newName, setNewName] = useState("");
  const [renameDraft, setRenameDraft] = useState("");
  const [linkText, setLinkText] = useState("");
  const [feedback, setFeedback] = useState<Feedback | null>(null);
  const [playing, setPlaying] = useState<Playing | null>(null);
  const [playRequest, setPlayRequest] = useState(0);
  const [shuffle, setShuffle] = useState(false);
  const shuffleSession = useRef<ShuffleSession | null>(null);

  const alive = useRef(true);
  const mutationVersion = useRef(0);
  const savingRef = useRef(false);
  const selectedRef = useRef<number | null>(null);
  selectedRef.current = selectedId;
  const latest = useRef({ playlists, playing, shuffle });
  latest.current = { playlists, playing, shuffle };

  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);

  const load = useCallback(async (silent: boolean) => {
    if (savingRef.current) return;
    const version = mutationVersion.current;
    if (!silent) { setLoading(true); setLoadError(null); }
    try {
      const data = await fetchPersonalPlaylists();
      if (!alive.current || version !== mutationVersion.current || savingRef.current) return;
      setPlaylists(data);
      setLoadError(null);
      setSelectedId((cur) => (cur !== null && data.some((p) => p.id === cur) ? cur : data[0]?.id ?? null));
    } catch (e) {
      if (!alive.current) return;
      if (!silent) setLoadError(e instanceof Error ? e.message : "Could not load your playlists.");
    } finally {
      if (alive.current && !silent) setLoading(false);
    }
  }, []);

  useEffect(() => { void load(false); }, [load]);
  useEffect(() => {
    const t = setInterval(() => { if (document.visibilityState !== "hidden") void load(true); }, 30_000);
    return () => clearInterval(t);
  }, [load]);

  const selected = playlists.find((p) => p.id === selectedId) ?? null;
  useEffect(() => {
    if (!playing) return;
    const playlist = playlists.find(p => p.id === playing.playlistId);
    if (playlist?.tracks.some(track => track.id === playing.trackId)) return;
    const first = playlist?.tracks[0];
    setPlaying(first ? { playlistId: playlist!.id, trackId: first.id, videoId: first.videoId } : null);
    setPlayRequest(0);
  }, [playlists, playing]);
  useEffect(() => {
    const p = latest.current.playlists.find((x) => x.id === selectedId);
    setRenameDraft(p?.name ?? "");
    setFeedback(null);
    setActionError(null);
  }, [selectedId]);

  async function mutate<T>(fn: () => Promise<T>): Promise<T | null> {
    if (savingRef.current) return null;
    savingRef.current = true; mutationVersion.current++;
    setSaving(true); setActionError(null);
    try {
      const r = await fn();
      return alive.current ? r : null;
    } catch (e) {
      if (alive.current) setActionError(e instanceof Error ? e.message : "Could not save changes.");
      return null;
    } finally {
      savingRef.current = false; mutationVersion.current++;
      if (alive.current) setSaving(false);
    }
  }
  const replace = (pl: PersonalYouTubePlaylist) =>
    setPlaylists((list) => list.map((p) => (p.id === pl.id ? pl : p)));

  function playTrack(pl: PersonalYouTubePlaylist, t: PersonalYouTubeTrack, keepShuffle = false) {
    if (!keepShuffle) shuffleSession.current = null;
    const next = { playlistId: pl.id, trackId: t.id, videoId: t.videoId };
    latest.current.playing = next;
    setPlaying(next);
    setPlayRequest((n) => n + 1);
  }
  function step(dir: 1 | -1, auto: boolean) {
    const { playlists: lists, playing: cur } = latest.current;
    const pl = lists.find((p) => p.id === (cur?.playlistId ?? selectedRef.current));
    if (!pl || !pl.tracks.length) return;
    if (latest.current.shuffle) {
      const result = stepShuffle(shuffleSession.current, pl.id, pl.tracks.map(t => t.id), cur?.trackId ?? null, dir, auto);
      shuffleSession.current = result.session;
      const next = pl.tracks.find(t => t.id === result.trackId);
      if (next) playTrack(pl, next, true);
      return;
    }
    const idx = cur ? pl.tracks.findIndex((t) => t.id === cur.trackId) : -1;
    let n = idx + dir;
    if (idx < 0) n = dir === 1 ? 0 : pl.tracks.length - 1;
    if (n >= pl.tracks.length || n < 0) { if (auto) return; n = (n + pl.tracks.length) % pl.tracks.length; }
    playTrack(pl, pl.tracks[n]);
  }
  const onEnded = () => step(1, true);

  async function create() {
    const name = newName.trim();
    if (!name) return;
    const pl = await mutate(() => createPersonalPlaylist(name));
    if (pl) { setPlaylists((l) => [pl, ...l.filter((p) => p.id !== pl.id)]); setSelectedId(pl.id); setNewName(""); }
  }
  async function rename() {
    if (!selected) return;
    const name = renameDraft.trim();
    if (!name || name === selected.name) return;
    const pl = await mutate(() => updatePersonalPlaylist(selected.id, { name, revision: selected.revision }));
    if (pl) replace(pl);
  }
  async function remove() {
    if (!selected || !window.confirm(`Delete playlist "${selected.name}" and its ${selected.tracks.length} tracks? This cannot be undone.`)) return;
    const id = selected.id;
    const ok = await mutate(() => deletePersonalPlaylist(id));
    if (ok) {
      const rest = latest.current.playlists.filter((p) => p.id !== id);
      setPlaylists(rest);
      setSelectedId(rest[0]?.id ?? null);
      if (latest.current.playing?.playlistId === id) { setPlaying(null); setPlayRequest(0); }
    }
  }
  async function addLinks() {
    if (!selected || !linkText.trim()) return;
    const count = linkText.split(/[\s,]+/).filter(Boolean).length;
    if (count > MAX_LINKS) { setActionError(`Too many links: ${count}. Paste at most ${MAX_LINKS} at a time.`); return; }
    const id = selected.id;
    const r = await mutate(() => addPersonalPlaylistLinks(id, linkText));
    if (r) {
      replace(r.playlist);
      setFeedback({ added: r.added, duplicates: r.duplicates, rejected: r.rejected });
      setLinkText(r.rejected.join("\n"));
    }
  }
  async function saveOrder(pl: PersonalYouTubePlaylist, tracks: PersonalYouTubeTrack[], removedId?: string) {
    const updated = await mutate(() => updatePersonalPlaylist(pl.id, { trackIds: tracks.map((t) => t.id), revision: pl.revision }));
    if (!updated) return;
    replace(updated);
    const cur = latest.current.playing;
    if (removedId && cur && cur.playlistId === pl.id && cur.trackId === removedId) {
      const first = updated.tracks[0];
      setPlaying(first ? { playlistId: pl.id, trackId: first.id, videoId: first.videoId } : null);
      setPlayRequest(0);
    }
  }
  function move(i: number, d: number) {
    if (!selected) return;
    const t = [...selected.tracks];
    const j = i + d;
    if (j < 0 || j >= t.length) return;
    [t[i], t[j]] = [t[j], t[i]];
    void saveOrder(selected, t);
  }
  function removeTrack(i: number) {
    if (!selected) return;
    const t = selected.tracks.filter((_, k) => k !== i);
    void saveOrder(selected, t, selected.tracks[i].id);
  }

  const linkCount = linkText.split(/[\s,]+/).filter(Boolean).length;
  const full = !!selected && selected.tracks.length >= MAX_TRACKS;

  return (
    <div className="w-full h-full flex flex-col text-xs gap-1 overflow-auto p-0.5" data-testid="personal-playlists">
      <div className="text-[10px] text-gray-600">
        Private library for {username}. Only you can see these playlists. Playback stays on this device.
      </div>

      <PersonalYouTubePlayer videoId={playing?.videoId ?? null} playRequest={playRequest} onEnded={onEnded} />

      <div className="flex gap-1 flex-wrap">
        <button type="button" className="win98-button px-2" onClick={() => step(-1, false)} disabled={!selected?.tracks.length && !playing} data-testid="button-prev">Previous</button>
        <button type="button" className="win98-button px-2" onClick={() => step(1, false)} disabled={!selected?.tracks.length && !playing} data-testid="button-next">Next</button>
        <button type="button" className="win98-button px-2" aria-pressed={shuffle}
          title="Play in random order without changing your saved playlist"
          onClick={() => {
            shuffleSession.current = null;
            latest.current.shuffle = !latest.current.shuffle;
            setShuffle(latest.current.shuffle);
          }} data-testid="button-shuffle">Shuffle: {shuffle ? "On" : "Off"}</button>
        <button type="button" className="win98-button px-2 ml-auto" onClick={() => void load(false)} disabled={loading || saving} data-testid="button-refresh">Refresh</button>
      </div>

      {loadError && (
        <div role="alert" className="text-red-800 bg-yellow-50 p-1">
          {loadError} <button type="button" className="win98-button px-2" onClick={() => void load(false)}>Retry</button>
        </div>
      )}
      {actionError && <div role="alert" className="text-red-800 bg-yellow-50 p-1" data-testid="text-action-error">{actionError}</div>}
      {saving && <div className="text-[10px] text-blue-800" role="status">Saving...</div>}

      <div className="flex gap-1 items-center">
        <select className="win98-inset flex-1 min-w-0 px-1 py-0.5" value={selectedId ?? ""} disabled={loading && !playlists.length}
          onChange={(e) => setSelectedId(e.target.value ? Number(e.target.value) : null)} aria-label="Playlist" data-testid="select-playlist">
          {!playlists.length && <option value="">{loading ? "Loading..." : "No playlists yet"}</option>}
          {playlists.map((p) => <option key={p.id} value={p.id}>{p.name} ({p.tracks.length})</option>)}
        </select>
      </div>
      <form className="flex gap-1" onSubmit={(e) => { e.preventDefault(); void create(); }}>
        <input className="win98-inset flex-1 min-w-0 px-1 py-0.5" placeholder="New playlist name" maxLength={80} value={newName}
          onChange={(e) => setNewName(e.target.value)} aria-label="New playlist name" data-testid="input-new-playlist" />
        <button type="submit" className="win98-button px-2" disabled={saving || !newName.trim()} data-testid="button-create-playlist">Create</button>
      </form>

      {loading && !playlists.length && !loadError && (
        <div className="win98-inset bg-white p-2 text-gray-500" role="status">Loading your playlists...</div>
      )}
      {!loading && !loadError && !playlists.length && (
        <div className="win98-inset bg-white p-2 text-gray-600">No playlists yet. Name one above and press Create, then paste YouTube links into it.</div>
      )}

      {selected && (
        <>
          <form className="flex gap-1" onSubmit={(e) => { e.preventDefault(); void rename(); }}>
            <input className="win98-inset flex-1 min-w-0 px-1 py-0.5" value={renameDraft} maxLength={80}
              onChange={(e) => setRenameDraft(e.target.value)} aria-label="Rename playlist" data-testid="input-rename-playlist" />
            <button type="submit" className="win98-button px-2" disabled={saving || !renameDraft.trim() || renameDraft.trim() === selected.name}>Rename</button>
            <button type="button" className="win98-button px-2 text-red-700" disabled={saving} onClick={() => void remove()} data-testid="button-delete-playlist">Delete</button>
          </form>

          <div className="flex flex-col gap-1">
            <textarea className="win98-inset w-full min-h-[56px] px-1 py-0.5 font-mono text-[11px]" value={linkText}
              placeholder="Paste YouTube links, one per line or separated by spaces"
              onChange={(e) => setLinkText(e.target.value)} aria-label="YouTube links" data-testid="input-links" />
            <div className="flex gap-1 items-center flex-wrap">
              <button type="button" className="win98-button px-2" disabled={saving || !linkText.trim() || full} onClick={() => void addLinks()} data-testid="button-add-links">Add links</button>
              <span className={`text-[10px] ${linkCount > MAX_LINKS ? "text-red-700" : "text-gray-600"}`}>
                {linkCount}/{MAX_LINKS} links per paste, {selected.tracks.length}/{MAX_TRACKS} tracks
              </span>
            </div>
            {full && <div className="text-red-800 text-[10px]">This playlist is full. Remove tracks to add more.</div>}
            {feedback && (
              <div className="bg-yellow-50 p-1 text-[11px]" role="status" data-testid="text-link-feedback">
                Added {feedback.added}. Skipped {feedback.duplicates} duplicate{feedback.duplicates === 1 ? "" : "s"}. Rejected {feedback.rejected.length} invalid link{feedback.rejected.length === 1 ? "" : "s"}.
                {feedback.rejected.length > 0 && (
                  <div className="text-red-800 mt-0.5">Not recognised as YouTube videos (left in the box so you can fix them):
                    <ul className="font-mono text-[10px] break-all max-h-16 overflow-auto">{feedback.rejected.map((r, i) => <li key={i}>{r}</li>)}</ul>
                  </div>
                )}
              </div>
            )}
          </div>

          <div className="win98-inset bg-white overflow-auto min-h-[80px] max-h-[220px]" data-testid="list-tracks">
            {!selected.tracks.length ? (
              <div className="text-gray-500 p-2">This playlist is empty. Paste some links above.</div>
            ) : selected.tracks.map((t, i) => {
              const active = playing?.playlistId === selected.id && playing.trackId === t.id;
              return (
                <div key={t.id} className={`flex items-center gap-1 px-1 py-0.5 ${active ? "bg-blue-200" : "hover:bg-blue-100"}`}>
                  <button type="button" className="flex-1 min-w-0 flex gap-1 text-left" onClick={() => playTrack(selected, t)} title={t.title} data-testid={`button-play-${i}`}>
                    <span className="text-gray-500 w-6 text-right shrink-0">{i + 1}.</span>
                    <span className="truncate">{active ? "> " : ""}{t.title}</span>
                  </button>
                  <button type="button" className="win98-button px-1 text-[10px]" disabled={saving || i === 0} onClick={() => move(i, -1)} aria-label={`Move ${t.title} up`}>Up</button>
                  <button type="button" className="win98-button px-1 text-[10px]" disabled={saving || i === selected.tracks.length - 1} onClick={() => move(i, 1)} aria-label={`Move ${t.title} down`}>Dn</button>
                  <button type="button" className="win98-button px-1 text-[10px] text-red-700" disabled={saving} onClick={() => removeTrack(i)} aria-label={`Remove ${t.title}`}>X</button>
                </div>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}

export function PersonalPlaylists() {
  const user = useAuth((s) => s.user);
  const authLoading = useAuth((s) => s.loading);
  if (!user) {
    return (
      <div className="w-full h-full p-3 text-xs" data-testid="personal-playlists-signed-out">
        <div className="win98-inset bg-white p-3">
          <div className="font-bold mb-1">{authLoading ? "Checking your account..." : "Sign in to use your playlists"}</div>
          <p className="text-gray-600">Your saved YouTube library is private to your account. Log in to create playlists and play them here.</p>
        </div>
      </div>
    );
  }
  return <PersonalPlaylistsInner key={user.username} username={user.username} />;
}
