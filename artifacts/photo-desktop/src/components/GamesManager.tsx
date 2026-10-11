import { useEffect, useMemo, useState } from "react";
import { Gamepad2, Search, Pencil, Check, X, Clock3 } from "lucide-react";
import { NEW_GAME_PORTS, type NewGamePortId } from "../lib/game-ports";
import { fetchGameIcons, fetchPortedGameApprovals, setGameIcon, uploadGameIcon } from "../lib/api";
import { useAuth } from "../lib/auth-store";
import { useDesktopStore, type WindowType } from "../store";

type Game = { id: string; title: string; type: WindowType; gameId?: NewGamePortId; steamId?: string };
const GAMES: Game[] = [
  { id: "chess", title: "Chess", type: "chess" },
  { id: "blackjack", title: "Blackjack", type: "blackjack" },
  { id: "flappy-bird", title: "Flappy Bird", type: "flappy", steamId: "1536610" },
  { id: "geometry-dash", title: "Geometry Dash", type: "geometry", steamId: "322170" },
  { id: "poker", title: "Poker", type: "poker" },
  { id: "eaglercraft", title: "Eaglercraft", type: "eaglercraft" },
  { id: "new-club-penguin", title: "New Club Penguin", type: "newcp" },
  { id: "terraria", title: "Terraria", type: "terraria", steamId: "105600" },
  { id: "gettingoverit", title: "Getting Over It", type: "gettingoverit", steamId: "240720" },
  { id: "pvz", title: "Plants vs. Zombies", type: "pvz", steamId: "3590" },
  { id: "webfishing", title: "Web Fishing", type: "webfishing" },
  { id: "undertale", title: "Undertale", type: "undertale", steamId: "391540" },
  ...NEW_GAME_PORTS.map(port => ({ id: port.id, title: port.title, type: "portedgame" as const, gameId: port.id, steamId: ({
    amongus: "945360", cuphead: "268910", deltarune: "1671210", gangbeasts: "285900",
    untitledgoose: "837470", oneshot: "420530", nightinthewoods: "481510", tattletail: "568090",
    tabs: "508440", daddygame: "427730", webbalatro: "2379780",
  } as Record<string, string>)[port.id] })),
];

export function GamesManager({ page }: { page: string }) {
  const user = useAuth(state => state.user);
  const addWindow = useDesktopStore(state => state.addWindow);
  const [approved, setApproved] = useState<string[]>([]);
  const [icons, setIcons] = useState<Record<string, string>>({});
  const [brokenIcons, setBrokenIcons] = useState<Record<string, boolean>>({});
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<"all" | "ready" | "pending">("all");
  const [editing, setEditing] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [uploadDataUrl, setUploadDataUrl] = useState("");
  const [uploadFileName, setUploadFileName] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    let live = true;
    Promise.all([fetchPortedGameApprovals(), fetchGameIcons()])
      .then(([approvalResult, iconResult]) => {
        if (!live) return;
        setApproved(approvalResult.approvedGamePorts);
        setIcons(iconResult.gameIcons);
      })
      .catch(() => { if (live) setError("Could not load game settings."); });
    return () => { live = false; };
  }, []);

  const availableGames = useMemo(() => GAMES.filter(game =>
    (!game.gameId || approved.includes(game.id) || user?.isAdmin),
  ), [approved, user?.isAdmin]);
  const pendingCount = availableGames.filter(game => game.gameId && !approved.includes(game.id)).length;
  const visibleGames = availableGames.filter(game => {
    const pending = !!game.gameId && !approved.includes(game.id);
    return game.title.toLowerCase().includes(query.toLowerCase()) &&
      (filter === "all" || (filter === "pending" ? pending : !pending));
  });

  const launch = (game: Game) => {
    addWindow(page, {
      type: game.type,
      ...(game.gameId ? { gameId: game.gameId, gamePreview: user?.isAdmin && !approved.includes(game.id) } : {}),
      title: game.title,
      width: game.type === "terraria" ? 1100 : 1000,
      height: 700,
    });
  };

  const saveIcon = async (gameId: string, url: string | null) => {
    setBusy(gameId);
    setError("");
    try {
      const result = uploadDataUrl
        ? await uploadGameIcon(gameId, uploadDataUrl)
        : await setGameIcon(gameId, url);
      setIcons(result.gameIcons);
      setBrokenIcons(current => {
        const next = { ...current };
        delete next[gameId];
        return next;
      });
      setEditing(null);
      setDraft("");
      setUploadDataUrl("");
      setUploadFileName("");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not save icon.");
    } finally { setBusy(null); }
  };

  const selectIconFile = (file: File | undefined) => {
    setError("");
    setUploadDataUrl("");
    setUploadFileName("");
    if (!file) return;
    if (file.type !== "image/png") {
      setError("Choose a PNG image.");
      return;
    }
    if (file.size > 1_000_000) {
      setError("PNG icons must be 1 MB or smaller.");
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === "string") {
        setUploadDataUrl(reader.result);
        setUploadFileName(file.name);
      } else setError("Could not read this image file.");
    };
    reader.onerror = () => setError("Could not read this image file.");
    reader.readAsDataURL(file);
  };

  const editingGame = GAMES.find(game => game.id === editing);
  return <div className="h-full overflow-auto bg-[#14252b] text-slate-100">
    <header className="relative overflow-hidden bg-gradient-to-br from-[#102c3b] via-[#16495a] to-[#277366] px-5 py-5 text-white">
      <div className="absolute -right-6 -top-12 h-44 w-44 rounded-full border-[24px] border-white/5" />
      <div className="relative flex items-start gap-3">
        <div className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-white/15 shadow-inner ring-1 ring-white/20"><Gamepad2 className="h-6 w-6" /></div>
        <div className="min-w-0 flex-1">
          <p className="text-[10px] font-semibold uppercase tracking-[.2em] text-teal-100">Game library</p>
          <h2 className="text-xl font-bold leading-tight">Games Manager</h2>
          <p className="mt-1 text-xs text-teal-50/85">Browse and launch games from one place.</p>
        </div>
        <div className="rounded-lg border border-white/20 bg-black/10 px-3 py-2 text-right">
          <div className="text-lg font-bold leading-none">{availableGames.length}</div>
          <div className="mt-1 text-[9px] uppercase tracking-wider text-teal-50/80">games</div>
        </div>
      </div>
    </header>
    <div className="space-y-3 p-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
        <label className="flex min-w-0 flex-1 items-center gap-2 rounded-xl border border-[#3d555c] bg-[#20343b] px-3 py-2 shadow-sm focus-within:border-teal-400 focus-within:ring-2 focus-within:ring-teal-400/20">
          <Search className="h-4 w-4 shrink-0 text-slate-400" />
          <input className="min-w-0 flex-1 bg-transparent text-sm text-slate-100 outline-none placeholder:text-slate-400" placeholder="Search games…" value={query} onChange={e => setQuery(e.target.value)} />
          {query && <button type="button" className="text-slate-400 hover:text-white" onClick={() => setQuery("")} aria-label="Clear search"><X className="h-4 w-4" /></button>}
        </label>
        <div className="flex shrink-0 rounded-xl bg-[#0e1e24] p-1" role="tablist" aria-label="Filter games">
          {(["all", "ready", "pending"] as const).filter(tab => tab !== "pending" || !!user?.isAdmin).map(tab => (
            <button key={tab} role="tab" aria-selected={filter === tab} onClick={() => setFilter(tab)} className={`rounded-lg px-3 py-1.5 text-xs font-semibold capitalize transition ${filter === tab ? "bg-[#36756e] text-white shadow-sm" : "text-slate-300 hover:text-white"}`}>
              {tab === "ready" ? "Available" : tab === "pending" ? `Pending ${pendingCount}` : "All"}
            </button>
          ))}
        </div>
      </div>
      {error && <p className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-700" role="alert">{error}</p>}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {visibleGames.map(game => {
          const icon = icons[game.id] || (game.steamId ? `https://cdn.akamai.steamstatic.com/steam/apps/${game.steamId}/header.jpg` : "");
          const pending = !!game.gameId && !approved.includes(game.id);
          return <article key={game.id} aria-label={game.title} className="group relative flex min-w-0 items-center gap-3 rounded-2xl border border-[#395158] bg-[#23383e] p-3 shadow-[0_2px_8px_rgba(0,0,0,.16)] transition hover:-translate-y-0.5 hover:border-teal-400 hover:bg-[#29434a] hover:shadow-md">
            <button type="button" className="relative h-[68px] w-[68px] shrink-0 overflow-hidden rounded-xl bg-gradient-to-br from-teal-100 to-slate-200 ring-1 ring-slate-200" onClick={() => launch(game)} aria-label={`Launch ${game.title}`}>
              {icon && !brokenIcons[game.id]
                ? <img src={icon} alt="" className="h-full w-full object-cover" onError={() => setBrokenIcons(current => ({ ...current, [game.id]: true }))} />
                : <span className="flex h-full items-center justify-center text-lg font-black tracking-tight text-teal-900">{game.title.slice(0, 2).toUpperCase()}</span>}
            </button>
            <div className="min-w-0 flex-1">
              <h3 title={game.title} className="text-[15px] font-bold leading-5 text-white">{game.title}</h3>
              <div className="mt-1 flex items-center gap-1 text-[10px] font-medium">
                {pending
                  ? <><Clock3 className="h-3 w-3 text-amber-600" /><span className="text-amber-700">Pending approval</span></>
                  : <><span className="h-1.5 w-1.5 rounded-full bg-emerald-400" /><span className="text-slate-300">Ready to play</span></>}
              </div>
            </div>
            {user?.isAdmin && <button type="button" title={`Change ${game.title} icon`} className="absolute right-2 top-2 rounded-lg p-1.5 text-slate-300 opacity-0 transition hover:bg-[#3a555b] hover:text-white group-hover:opacity-100 focus:opacity-100" onClick={() => { setEditing(game.id); setDraft(icons[game.id] || ""); }}>
              <Pencil className="h-3.5 w-3.5" />
            </button>}
            <button type="button" className="shrink-0 rounded-lg bg-teal-800 px-3 py-2 text-xs font-bold text-white shadow-sm transition hover:bg-teal-700 focus:outline-none focus:ring-2 focus:ring-teal-500 focus:ring-offset-2" onClick={() => launch(game)}>
              {pending ? "Test" : "Play"}
            </button>
          </article>;
        })}
      </div>
      {visibleGames.length === 0 && <div className="rounded-2xl border border-dashed border-[#496168] bg-[#20343b] px-6 py-12 text-center">
        <Gamepad2 className="mx-auto h-8 w-8 text-slate-500" />
        <p className="mt-2 text-sm font-semibold text-slate-200">No games found</p>
        <p className="mt-1 text-xs text-slate-400">Try another name or filter.</p>
      </div>}
    </div>
    {editingGame && user?.isAdmin && <div className="fixed inset-0 z-[10000] flex items-center justify-center bg-slate-950/55 p-4 backdrop-blur-sm" role="dialog" aria-modal="true" aria-label={`Change ${editingGame.title} icon`}>
      <div className="w-full max-w-md rounded-2xl border border-white/20 bg-[#20343b] p-5 text-slate-100 shadow-2xl">
        <div className="mb-4 flex items-center gap-3">
          <div className="grid h-10 w-10 place-items-center rounded-xl bg-teal-50 text-teal-800"><Pencil className="h-5 w-5" /></div>
          <div><h3 className="font-bold text-white">Change game icon</h3><p className="text-xs text-slate-300">{editingGame.title}</p></div>
        </div>
        <label className="block text-xs font-semibold text-slate-200">Upload a PNG from your device
          <input type="file" accept="image/png,.png" onChange={e => selectIconFile(e.currentTarget.files?.[0])} className="mt-1.5 block w-full rounded-lg border border-[#496168] bg-[#172a30] p-2 text-xs text-slate-200 file:mr-3 file:rounded-md file:border-0 file:bg-teal-700 file:px-3 file:py-1.5 file:text-xs file:font-semibold file:text-white hover:file:bg-teal-600" />
        </label>
        <p className="mt-1 text-xs text-slate-400">PNG only · max 1 MB · maximum dimensions 2048 × 2048</p>
        {uploadFileName && <p className="mt-2 truncate text-xs text-teal-200">Selected: {uploadFileName}</p>}
        <div className="my-4 flex items-center gap-3 text-[10px] font-semibold uppercase tracking-wider text-slate-500"><span className="h-px flex-1 bg-[#496168]" />or use an image link<span className="h-px flex-1 bg-[#496168]" /></div>
        <label className="block text-xs font-semibold text-slate-200">HTTPS image URL
          <input type="url" value={draft} onChange={e => { setDraft(e.target.value); setUploadDataUrl(""); setUploadFileName(""); }} placeholder="https://example.com/icon.png" className="mt-1.5 w-full rounded-lg border border-[#496168] bg-[#172a30] px-3 py-2 text-sm text-white outline-none placeholder:text-slate-500 focus:border-teal-400 focus:ring-2 focus:ring-teal-400/20" />
        </label>
        <p className="mt-2 text-xs leading-relaxed text-slate-400">Leave both fields blank and choose Reset to restore the default artwork.</p>
        <div className="mt-5 flex justify-end gap-2">
          <button className="rounded-lg border border-[#496168] px-3 py-2 text-xs font-semibold text-slate-200 hover:bg-[#2c454c]" onClick={() => setEditing(null)}>Cancel</button>
          <button className="rounded-lg bg-teal-700 px-3 py-2 text-xs font-semibold text-white hover:bg-teal-600 disabled:opacity-50" disabled={busy === editingGame.id || (!uploadDataUrl && !draft.trim())} onClick={() => void saveIcon(editingGame.id, draft.trim() || null)}>
            {busy === editingGame.id ? "Saving…" : uploadDataUrl ? "Upload PNG" : draft.trim() ? <><Check className="mr-1 inline h-3.5 w-3.5" />Save link</> : "Reset icon"}
          </button>
        </div>
      </div>
    </div>}
  </div>;
}
