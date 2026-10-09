import { useCallback, useEffect, useMemo, useState } from "react";
import { fetchFeatureArchiveState, setFeatureArchived } from "../lib/api";
import { useAuth } from "../lib/auth-store";
import { FEATURE_CATALOG } from "../lib/feature-catalog";
import { isFeatureTemporarilyDisabled } from "@workspace/feature-registry";

const visibleFeatureCatalog = FEATURE_CATALOG.filter((feature) => !isFeatureTemporarilyDisabled(feature.id));

type View = "all" | "active" | "archived";

export function FeatureArchivePanel() {
  const user = useAuth((s) => s.user);
  const archived = useAuth((s) => s.siteSettings.archivedFeatures);
  const [query, setQuery] = useState("");
  const [view, setView] = useState<View>("all");
  const [loading, setLoading] = useState(true);
  const [loadErr, setLoadErr] = useState<string | null>(null);
  const [savingId, setSavingId] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [status, setStatus] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setLoadErr(null);
    try {
      const s = await fetchFeatureArchiveState();
      if (s) useAuth.getState().setArchivedFeatures(s.archivedFeatures);
    } catch (e: any) {
      setLoadErr(e?.message || "Could not load feature settings.");
    } finally {
      setLoading(false);
    }
  }, []);

  const isAdmin = !!user?.isAdmin;
  useEffect(() => { if (isAdmin) void load(); }, [isAdmin, load]);

  const archivedSet = useMemo(() => new Set(archived), [archived]);
  const rows = useMemo(() => {
    const q = query.trim().toLowerCase();
    return visibleFeatureCatalog.filter((f) => {
      const a = archivedSet.has(f.id);
      if (view === "active" && a) return false;
      if (view === "archived" && !a) return false;
      return !q || f.name.toLowerCase().includes(q) || f.category.toLowerCase().includes(q) || f.id.includes(q);
    });
  }, [query, view, archivedSet]);

  if (!isAdmin) {
    return <div className="p-3 text-sm text-red-700">Only administrators can manage feature archiving.</div>;
  }

  async function toggle(id: string, name: string, next: boolean) {
    setSavingId(id);
    setErr(null);
    setStatus("");
    try {
      const result = await setFeatureArchived(id, next);
      useAuth.getState().setArchivedFeatures(result.archivedFeatures);
      setStatus(`${name} ${next ? "archived" : "restored"}.`);
    } catch (e: any) {
      setErr(e?.message || `Could not ${next ? "archive" : "unarchive"} ${name}.`);
    } finally {
      setSavingId(null);
    }
  }

  const busy = savingId !== null;
  const count = visibleFeatureCatalog.filter((f) => archivedSet.has(f.id)).length;

  return (
    <div className="w-full h-full flex flex-col gap-2 p-3 text-sm overflow-auto">
      <div>
        <div className="font-bold">Feature Archive</div>
        <div className="text-[11px] text-gray-700">
          Archiving only hides a feature's launch entry from every user's Start menu and mobile launcher. Nothing is
          deleted or disabled, all data is kept, and windows that are already open stay open. Unarchive to bring it back.
          Access and settings panels cannot be archived.
        </div>
      </div>

      <div className="flex flex-wrap gap-1 items-center">
        <input
          className="win98-inset px-1 flex-1 min-w-[120px]"
          placeholder="Search features..."
          aria-label="Search features"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        {(["all", "active", "archived"] as View[]).map((v) => (
          <button
            key={v}
            type="button"
            aria-pressed={view === v}
            className={`win98-button px-2 py-0.5 capitalize ${view === v ? "font-bold" : ""}`}
            onClick={() => setView(v)}
          >
            {v}
          </button>
        ))}
        <button type="button" className="win98-button px-2 py-0.5" disabled={loading || busy} onClick={() => void load()}>
          Refresh
        </button>
      </div>

      <div className="text-[11px] text-gray-700">
        {loading ? "Loading..." : `${count} archived, ${visibleFeatureCatalog.length - count} active`}
      </div>

      {loadErr && (
        <div role="alert" className="text-red-700 text-xs flex gap-2 items-center">
          <span>{loadErr}</span>
          <button type="button" className="win98-button px-2 py-0.5" onClick={() => void load()}>Retry</button>
        </div>
      )}
      {err && <div role="alert" className="text-red-700 text-xs">{err}</div>}
      <div aria-live="polite" className="text-green-700 text-xs min-h-[1em]">{status}</div>

      <div className="win98-inset bg-white flex-1 min-h-[120px] overflow-auto">
        {loading ? (
          <div className="p-2 text-gray-600 text-xs">Reading current settings...</div>
        ) : rows.length === 0 ? (
          <div className="p-3 text-gray-600 text-xs text-center">No features match.</div>
        ) : (
          <ul>
            {rows.map((f) => {
              const a = archivedSet.has(f.id);
              return (
                <li key={f.id} className="flex items-center gap-2 px-2 py-1 border-b border-gray-300">
                  <div className="flex-1 min-w-0">
                    <div className={`truncate ${a ? "text-gray-500" : "font-bold"}`}>{f.name}</div>
                    <div className="text-[10px] text-gray-600">
                       {f.category} - {a ? "Archived" : "Active"}
                    </div>
                  </div>
                  <button
                    type="button"
                    className="win98-button px-2 py-0.5 shrink-0"
                     disabled={busy || loading || !!loadErr}
                    onClick={() => void toggle(f.id, f.name, !a)}
                    aria-label={`${a ? "Unarchive" : "Archive"} ${f.name}`}
                  >
                    {savingId === f.id ? "Saving..." : a ? "Unarchive" : "Archive"}
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}
