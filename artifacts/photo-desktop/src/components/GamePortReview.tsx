import { useCallback, useEffect, useState } from "react";
import { ExternalLink } from "lucide-react";
import { useAuth } from "../lib/auth-store";
import { fetchPortedGameApprovals, setPortedGameApproved } from "../lib/api";
import { NEW_GAME_PORTS } from "../lib/game-ports";

export function GamePortReview() {
  const user = useAuth(state => state.user);
  const [approved, setApproved] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [status, setStatus] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const result = await fetchPortedGameApprovals();
      setApproved(result.approvedGamePorts);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not load pending game ports.");
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
      <ul className="win98-inset min-h-0 flex-1 overflow-auto bg-white">
        {NEW_GAME_PORTS.map(port => {
          const isApproved = approved.includes(port.id);
          return (
            <li key={port.id} className="flex items-center gap-2 border-b border-gray-300 px-2 py-2">
              <div className="min-w-0 flex-1">
                <div className="truncate font-bold">{port.title}</div>
                <div className="text-[10px] text-gray-600">{isApproved ? "Approved · visible to users" : "Pending · admin-only"}</div>
              </div>
              <a className="win98-button inline-flex shrink-0 items-center gap-1 px-2 py-1 text-[10px]"
                href={port.repository} target="_blank" rel="noopener noreferrer" aria-label={`View ${port.title} source`}>
                <ExternalLink className="h-3 w-3" aria-hidden="true" /> Source
              </a>
              <button type="button" className="win98-button shrink-0 px-2 py-1 text-[10px]"
                disabled={loading || busyId !== null} onClick={() => void toggle(port.id, port.title)}>
                {busyId === port.id ? "Saving…" : isApproved ? "Hide" : "Approve"}
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
