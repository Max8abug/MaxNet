import { useEffect, useMemo, useState } from "react";
import { Gamepad2, Search, Pencil, Check, X } from "lucide-react";
import { NEW_GAME_PORTS, type NewGamePortId } from "../lib/game-ports";
import { fetchGameIcons, fetchPortedGameApprovals, setGameIcon } from "../lib/api";
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
  const [editing, setEditing] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
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

  const visibleGames = useMemo(() => GAMES.filter(game =>
    (!game.gameId || approved.includes(game.id) || user?.isAdmin) &&
    game.title.toLowerCase().includes(query.toLowerCase()),
  ), [approved, query, user?.isAdmin]);

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
      const result = await setGameIcon(gameId, url);
      setIcons(result.gameIcons);
      setBrokenIcons(current => {
        const next = { ...current };
        delete next[gameId];
        return next;
      });
      setEditing(null);
      setDraft("");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not save icon.");
    } finally { setBusy(null); }
  };

  return <div className="h-full overflow-auto bg-[#eee9d8] p-3 text-[#202b38]">
    <div className="mb-3 flex items-center gap-2">
      <Gamepad2 className="h-5 w-5 text-[#496d61]" />
      <h2 className="text-lg font-bold">Games Manager</h2>
      <span className="ml-auto text-xs text-gray-600">{visibleGames.length} games</span>
    </div>
    <label className="mb-3 flex items-center gap-2 rounded border border-[#a6aa9f] bg-white px-2 py-1.5">
      <Search className="h-4 w-4 text-gray-500" />
      <input className="min-w-0 flex-1 bg-transparent text-sm outline-none" placeholder="Find a game" value={query} onChange={e => setQuery(e.target.value)} />
    </label>
    {error && <p className="mb-2 text-xs text-red-700" role="alert">{error}</p>}
    <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 xl:grid-cols-3">
      {visibleGames.map(game => {
        const icon = icons[game.id] || (game.steamId ? `https://cdn.akamai.steamstatic.com/steam/apps/${game.steamId}/header.jpg` : "");
        const pending = !!game.gameId && !approved.includes(game.id);
        return <article key={game.id} className="flex min-w-0 items-center gap-3 rounded border border-[#a6aa9f] bg-white p-2 shadow-sm">
          <button type="button" className="h-14 w-14 shrink-0 overflow-hidden rounded border border-[#c5c7c0] bg-[#dce6df]" onClick={() => launch(game)} aria-label={`Launch ${game.title}`}>
            {icon && !brokenIcons[game.id]
              ? <img src={icon} alt="" className="h-full w-full object-cover" onError={() => setBrokenIcons(current => ({ ...current, [game.id]: true }))} />
              : <span className="flex h-full items-center justify-center text-xl font-bold text-[#45685d]">{game.title.slice(0, 2).toUpperCase()}</span>}
          </button>
          <div className="min-w-0 flex-1">
            <h3 className="truncate text-sm font-semibold">{game.title}</h3>
            {pending && <p className="text-[10px] text-amber-700">Pending approval · admin preview</p>}
            <button type="button" className="mt-1 rounded border border-[#8a948b] bg-[#e8eee9] px-2 py-0.5 text-xs hover:bg-[#d4e1d7]" onClick={() => launch(game)}>
              {pending ? "Test" : "Play"}
            </button>
          </div>
          {user?.isAdmin && <button
            type="button" title={`Change ${game.title} icon`} className="shrink-0 rounded p-1 hover:bg-gray-100"
            onClick={() => { setEditing(game.id); setDraft(icons[game.id] || ""); }}
          ><Pencil className="h-4 w-4" /></button>}
          {editing === game.id && user?.isAdmin && <div className="fixed inset-0 z-[10000] flex items-center justify-center bg-black/40 p-4" role="dialog" aria-modal="true" aria-label={`Change ${game.title} icon`}>
            <div className="w-full max-w-md rounded border border-gray-500 bg-[#eee9d8] p-4 shadow-xl">
              <h3 className="mb-2 font-bold">Change {game.title} icon</h3>
              <input autoFocus type="url" value={draft} onChange={e => setDraft(e.target.value)} placeholder="https://example.com/icon.png" className="w-full rounded border border-gray-400 bg-white p-2 text-sm" />
              <p className="mt-1 text-xs text-gray-600">Use a direct HTTPS image URL. Leave blank and choose Reset to restore the default.</p>
              <div className="mt-3 flex justify-end gap-2">
                <button className="win98-button px-2 py-1 text-xs" onClick={() => setEditing(null)}><X className="mr-1 inline h-3 w-3" />Cancel</button>
                <button className="win98-button px-2 py-1 text-xs" disabled={busy === game.id} onClick={() => void saveIcon(game.id, draft.trim() || null)}><Check className="mr-1 inline h-3 w-3" />{draft.trim() ? "Save" : "Reset"}</button>
              </div>
            </div>
          </div>}
        </article>;
      })}
    </div>
    {visibleGames.length === 0 && <p className="p-8 text-center text-sm text-gray-600">No matching games.</p>}
  </div>;
}
