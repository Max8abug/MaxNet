import { useCallback, useEffect, useState } from "react";
import { ExternalLink } from "lucide-react";
import { useAuth } from "../lib/auth-store";
import { fetchPortedGameApprovals, setPortedGameApproved } from "../lib/api";
import { NEW_GAME_PORTS } from "../lib/game-ports";
import { useDesktopStore } from "../store";

type GameAssetManifest = {
  games?: Record<string, { installed?: boolean }>;
};

export function GamePortReview({ page }: { page: string }) {
  const user = useAuth(state => state.user);
  const addWindow = useDesktopStore(state => state.addWindow);
  const [approved, setApproved] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [status, setStatus] = useState("");
  const [installedAssets, setInstalledAssets] = useState<string[]>([]);
  const [assetCheckError, setAssetCheckError] = useState("");
  const [assetsChecked, setAssetsChecked] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    setAssetCheckError("");
    setAssetsChecked(false);
    try {
      const result = await fetchPortedGameApprovals();
      setApproved(result.approvedGamePorts);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not load pending game ports.");
    }
    try {
      const response = await fetch("/ported-games/asset-manifest.json", { cache: "no-store" });
      if (!response.ok) throw new Error(`Asset manifest request failed (${response.status}).`);
      const manifest = await response.json() as GameAssetManifest;
      setInstalledAssets(Object.entries(manifest.games ?? {})
        .filter(([, info]) => info?.installed === true)
        .map(([id]) => id));
      setAssetsChecked(true);
    } catch (cause) {
      setAssetCheckError(cause instanceof Error ? cause.message : "Could not check installed game files.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (user?.isAdmin) void load();
  }, [load, user?.isAdmin]);

  if (!user?.isAdmin) {
    return <div className="p-3 text-sm text-red-700">Only administrators can review game ports.</div>;
  }

  async function toggle(gameId: string, title: string) {
    const next = !approved.includes(gameId);
    setBusyId(gameId);
    setError("");
    setStatus("");
    try {
      const result = await setPortedGameApproved(gameId, next);
      setApproved(result.approvedGamePorts);
      setStatus(next ? `${title} is now visible in Games.` : `${title} was hidden from Games.`);
      window.dispatchEvent(new Event("game-port-approvals-changed"));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not update this game.");
    } finally {
      setBusyId(null);
    }
  }

  const missingPorts = assetsChecked
    ? NEW_GAME_PORTS.filter(port => !installedAssets.includes(port.assetId))
    : NEW_GAME_PORTS;

  return (
    <div className="flex h-full min-h-0 flex-col gap-2 overflow-auto p-3 text-sm">
      <div>
        <h2 className="font-bold">Pending Game Ports</h2>
        <p className="text-[11px] text-gray-700">
          These ports stay out of the public Games menu until you approve them. Approval makes a game visible to everyone;
          it does not change the self-hosted game files.
        </p>
      </div>
      <div className="flex items-center justify-between gap-2 text-[11px] text-gray-700">
        <span>{loading ? "Loading…" : `${approved.length} approved · ${NEW_GAME_PORTS.length - approved.length} pending`}</span>
        <button className="win98-button px-2 py-0.5" type="button" disabled={loading || busyId !== null} onClick={() => void load()}>
          Refresh
        </button>
      </div>
      {error && <p role="alert" className="text-xs text-red-700">{error}</p>}
      <p aria-live="polite" className="min-h-[1em] text-xs text-green-700">{status}</p>
      <section className="win98-inset shrink-0 bg-[#fffdf4] p-2">
        <div className="flex items-baseline justify-between gap-2">
          <h3 className="font-bold">Files to find</h3>
          <span className="text-[10px] text-gray-600">
            {assetsChecked ? `${missingPorts.length} missing` : `${NEW_GAME_PORTS.length} to check`}
          </span>
        </div>
        <p className="mb-2 text-[10px] text-gray-700">
          These games are in the review queue, but their browser files are not installed on this server yet.
        </p>
        {assetCheckError && <p role="status" className="mb-2 text-[11px] text-amber-800">
          Could not verify which files are installed ({assetCheckError}); showing every source to check.
        </p>}
        {!assetsChecked && !assetCheckError
          ? <p className="text-[11px] text-gray-600">Checking installed files…</p>
          : assetsChecked && missingPorts.length === 0
            ? <p className="text-[11px] text-green-800">All review games have installed files.</p>
            : <ul className="max-h-32 space-y-1 overflow-auto">
              {missingPorts.map(port => (
                <li key={port.id} className="flex items-center justify-between gap-2 text-[11px]">
                  <span className="truncate font-semibold">{port.title}</span>
                  <a className="win98-button inline-flex shrink-0 items-center gap-1 px-2 py-0.5"
                    href={port.repository} target="_blank" rel="noopener noreferrer">
                    <ExternalLink className="h-3 w-3" aria-hidden="true" /> Find files
                  </a>
                </li>
              ))}
            </ul>}
      </section>
      <ul className="win98-inset min-h-0 flex-1 overflow-auto bg-white">
        {NEW_GAME_PORTS.map(port => {
          const isApproved = approved.includes(port.id);
          const hasFiles = assetsChecked && installedAssets.includes(port.assetId);
          return (
            <li key={port.id} className="flex items-center gap-2 border-b border-gray-300 px-2 py-2">
              <div className="min-w-0 flex-1">
                <div className="truncate font-bold">{port.title}</div>
                <div className="text-[10px] text-gray-600">
                  {isApproved ? "Approved · visible to users" : "Pending · admin-only"}
                  {assetsChecked && !hasFiles ? " · files missing" : ""}
                </div>
              </div>
              <a className="win98-button inline-flex shrink-0 items-center gap-1 px-2 py-1 text-[10px]"
                href={port.repository} target="_blank" rel="noopener noreferrer" aria-label={`View ${port.title} source`}>
                <ExternalLink className="h-3 w-3" aria-hidden="true" /> Source
              </a>
              {!isApproved && <button type="button" className="win98-button shrink-0 px-2 py-1 text-[10px]"
                title={hasFiles ? undefined : "Install the game files before testing."}
                disabled={loading || busyId !== null || !hasFiles}
                onClick={() => addWindow(page, {
                  type: "portedgame",
                  title: `Admin test: ${port.title}`,
                  gameId: port.id,
                  gamePreview: true,
                  width: 800,
                  height: 600,
                })}>
                Test
              </button>}
              <button type="button" className="win98-button shrink-0 px-2 py-1 text-[10px]"
                title={!isApproved && !hasFiles ? "Install the game files before approving." : undefined}
                disabled={loading || busyId !== null || (!isApproved && !hasFiles)} onClick={() => void toggle(port.id, port.title)}>
                {busyId === port.id ? "Saving…" : isApproved ? "Hide" : "Approve"}
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
