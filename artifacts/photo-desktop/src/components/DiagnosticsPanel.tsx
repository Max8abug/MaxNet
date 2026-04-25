import { useEffect, useState, useCallback } from "react";
import { fetchDiagnosticsErrors, clearDiagnosticsErrors, type DiagnosticsError } from "../lib/api";
import { useAuth } from "../lib/auth-store";

export function DiagnosticsPanel() {
  const user = useAuth((s) => s.user);
  const [errors, setErrors] = useState<DiagnosticsError[]>([]);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [autoRefresh, setAutoRefresh] = useState(true);
  const [expanded, setExpanded] = useState<Set<number>>(new Set());

  const refresh = useCallback(async () => {
    setLoading(true);
    setErr(null);
    try {
      setErrors(await fetchDiagnosticsErrors());
    } catch (e: any) {
      setErr(e?.message || "Failed to load");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void refresh(); }, [refresh]);

  useEffect(() => {
    if (!autoRefresh) return;
    const t = setInterval(() => { void refresh(); }, 5000);
    return () => clearInterval(t);
  }, [autoRefresh, refresh]);

  if (!user?.isAdmin) return <div className="p-2 text-xs">Admin only.</div>;

  async function clearAll() {
    if (!confirm("Clear all recorded errors?")) return;
    try { await clearDiagnosticsErrors(); await refresh(); }
    catch (e: any) { alert(e?.message || "Failed"); }
  }

  function toggle(id: number) {
    setExpanded(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }

  function fmtTime(iso: string): string {
    try {
      const d = new Date(iso);
      return d.toLocaleString();
    } catch { return iso; }
  }

  return (
    <div className="w-full h-full flex flex-col text-xs gap-1 overflow-hidden">
      <div className="flex items-center gap-1 p-1 border-b border-gray-400">
        <button className="win98-button px-2 py-0.5" onClick={() => void refresh()} disabled={loading}>
          {loading ? "…" : "Refresh"}
        </button>
        <button className="win98-button px-2 py-0.5" onClick={clearAll} disabled={errors.length === 0}>
          Clear
        </button>
        <label className="flex items-center gap-1 ml-2">
          <input type="checkbox" checked={autoRefresh} onChange={e => setAutoRefresh(e.target.checked)} />
          auto-refresh (5s)
        </label>
        <span className="ml-auto text-[10px] text-gray-700">
          {errors.length} error{errors.length === 1 ? "" : "s"}
        </span>
      </div>

      {err && <div className="text-red-700 px-1">{err}</div>}

      <div className="flex-1 overflow-auto win98-inset bg-white">
        {errors.length === 0 && !loading && (
          <div className="p-2 text-gray-600">
            No errors recorded. Errors are kept in memory and cleared on server restart.
          </div>
        )}
        {errors.map(e => {
          const isOpen = expanded.has(e.id);
          return (
            <div key={e.id} className="border-b border-gray-300">
              <button
                className="w-full text-left p-1 hover:bg-blue-100 flex items-start gap-1"
                onClick={() => toggle(e.id)}
              >
                <span className="text-[10px] text-gray-600 w-32 shrink-0">{fmtTime(e.timestamp)}</span>
                <span className="font-bold text-blue-900 w-12 shrink-0">{e.method}</span>
                <span className="font-mono w-40 shrink-0 truncate">{e.url}</span>
                <span className="flex-1 text-red-800 truncate">{e.message}</span>
                <span className="text-[10px] text-gray-500">{isOpen ? "−" : "+"}</span>
              </button>
              {isOpen && (
                <div className="px-2 pb-2 bg-gray-50">
                  <div className="text-[10px] text-gray-600 mb-1">
                    <span className="font-bold">user:</span> {e.user || "(anonymous)"} · <span className="font-bold">id:</span> #{e.id}
                  </div>
                  <div className="font-bold mb-0.5">message</div>
                  <pre className="whitespace-pre-wrap break-all bg-white border border-gray-300 p-1 mb-1">{e.message}</pre>
                  {e.stack && (
                    <>
                      <div className="font-bold mb-0.5">stack</div>
                      <pre className="whitespace-pre-wrap break-all bg-white border border-gray-300 p-1 max-h-60 overflow-auto text-[10px]">{e.stack}</pre>
                    </>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
