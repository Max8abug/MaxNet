import { useEffect, useState, useCallback } from "react";
import {
  fetchDiagnosticsErrors,
  clearDiagnosticsErrors,
  runDiagnosticsHealthcheck,
  runDiagnosticsDrawingTest,
  runDiagnosticsSchemaDrift,
  type DiagnosticsError,
  type DiagnosticsHealth,
  type DiagnosticsTestResult,
  type DiagnosticsSchemaDrift,
} from "../lib/api";
import { useAuth } from "../lib/auth-store";

type Tab = "errors" | "health" | "drawing" | "schema";

export function DiagnosticsPanel() {
  const user = useAuth((s) => s.user);
  const [tab, setTab] = useState<Tab>("errors");
  const [errors, setErrors] = useState<DiagnosticsError[]>([]);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [autoRefresh, setAutoRefresh] = useState(true);
  const [expanded, setExpanded] = useState<Set<number>>(new Set());
  const [health, setHealth] = useState<DiagnosticsHealth | null>(null);
  const [healthLoading, setHealthLoading] = useState(false);
  const [healthErr, setHealthErr] = useState<string | null>(null);
  const [drawTest, setDrawTest] = useState<DiagnosticsTestResult | null>(null);
  const [drawLoading, setDrawLoading] = useState(false);
  const [drawErr, setDrawErr] = useState<string | null>(null);
  const [schema, setSchema] = useState<DiagnosticsSchemaDrift | null>(null);
  const [schemaLoading, setSchemaLoading] = useState(false);
  const [schemaErr, setSchemaErr] = useState<string | null>(null);

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

  const runHealth = useCallback(async () => {
    setHealthLoading(true);
    setHealthErr(null);
    try {
      setHealth(await runDiagnosticsHealthcheck());
    } catch (e: any) {
      setHealthErr(e?.message || "Failed");
    } finally {
      setHealthLoading(false);
    }
  }, []);

  const runDrawing = useCallback(async () => {
    setDrawLoading(true);
    setDrawErr(null);
    try {
      setDrawTest(await runDiagnosticsDrawingTest());
    } catch (e: any) {
      setDrawErr(e?.message || "Failed");
    } finally {
      setDrawLoading(false);
    }
  }, []);

  const runSchema = useCallback(async () => {
    setSchemaLoading(true);
    setSchemaErr(null);
    try {
      setSchema(await runDiagnosticsSchemaDrift());
    } catch (e: any) {
      setSchemaErr(e?.message || "Failed");
    } finally {
      setSchemaLoading(false);
    }
  }, []);

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
    <div className="w-full h-full flex flex-col text-xs overflow-hidden">
      <div className="flex items-center gap-0 px-1 pt-1 border-b border-gray-400 bg-gray-200">
        <button
          className={`px-3 py-1 border border-b-0 ${tab === "errors" ? "bg-white border-gray-500 font-bold" : "bg-gray-300 border-gray-400"}`}
          onClick={() => setTab("errors")}
        >
          Errors {errors.length > 0 && `(${errors.length})`}
        </button>
        <button
          className={`px-3 py-1 border border-b-0 ${tab === "health" ? "bg-white border-gray-500 font-bold" : "bg-gray-300 border-gray-400"}`}
          onClick={() => setTab("health")}
        >
          Health Check
        </button>
        <button
          className={`px-3 py-1 border border-b-0 ${tab === "drawing" ? "bg-white border-gray-500 font-bold" : "bg-gray-300 border-gray-400"}`}
          onClick={() => setTab("drawing")}
        >
          Drawing Test
        </button>
        <button
          className={`px-3 py-1 border border-b-0 ${tab === "schema" ? "bg-white border-gray-500 font-bold" : "bg-gray-300 border-gray-400"}`}
          onClick={() => setTab("schema")}
        >
          Schema Drift
          {schema && schema.driftedTables > 0 && ` (${schema.driftedTables})`}
        </button>
      </div>

      {tab === "errors" && (
        <>
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
        </>
      )}

      {tab === "health" && (
        <HealthTab
          health={health}
          loading={healthLoading}
          err={healthErr}
          onRun={() => void runHealth()}
        />
      )}

      {tab === "drawing" && (
        <DrawingTestTab
          result={drawTest}
          loading={drawLoading}
          err={drawErr}
          onRun={() => void runDrawing()}
        />
      )}

      {tab === "schema" && (
        <SchemaDriftTab
          result={schema}
          loading={schemaLoading}
          err={schemaErr}
          onRun={() => void runSchema()}
        />
      )}
    </div>
  );
}

function HealthTab({
  health,
  loading,
  err,
  onRun,
}: {
  health: DiagnosticsHealth | null;
  loading: boolean;
  err: string | null;
  onRun: () => void;
}) {
  return (
    <>
      <div className="flex items-center gap-1 p-1 border-b border-gray-400">
        <button className="win98-button px-2 py-0.5" onClick={onRun} disabled={loading}>
          {loading ? "Running…" : "Run Health Check"}
        </button>
        {health && (
          <span className="ml-2 text-[10px] text-gray-700">
            ran at {new Date(health.ranAt).toLocaleString()} · {health.durationMs}ms
          </span>
        )}
        {health && (
          <span
            className={`ml-auto px-2 py-0.5 text-[10px] font-bold ${health.ok ? "bg-green-200 text-green-900" : "bg-red-200 text-red-900"}`}
          >
            {health.ok ? "ALL OK" : "PROBLEMS FOUND"}
          </span>
        )}
      </div>

      {err && <div className="text-red-700 px-1 py-1">{err}</div>}

      <div className="flex-1 overflow-auto win98-inset bg-white p-2">
        {!health && !loading && !err && (
          <div className="text-gray-600">
            Click <b>Run Health Check</b> to probe the database. This counts rows in every critical table, breaks down active vs expired sessions, and checks the admin user count.
          </div>
        )}

        {health && (
          <div className="flex flex-col gap-2">
            <Section title="Database">
              <Row label="connected" value={health.dbConnected ? "yes" : "NO"} ok={health.dbConnected} />
              {health.dbError && <Row label="error" value={health.dbError} ok={false} />}
              {health.serverTime && <Row label="server time" value={health.serverTime} />}
              {health.postgresVersion && (
                <Row label="postgres" value={health.postgresVersion.split(" on ")[0] || health.postgresVersion} />
              )}
            </Section>

            <Section title="Admin users">
              {health.adminError ? (
                <Row label="error" value={health.adminError} ok={false} />
              ) : (
                <Row
                  label="admin count"
                  value={String(health.adminCount ?? "?")}
                  ok={(health.adminCount ?? 0) > 0}
                />
              )}
            </Section>

            <Section title="Sessions (login persistence)">
              {health.sessions.error ? (
                <Row label="error" value={health.sessions.error} ok={false} />
              ) : (
                <>
                  <Row label="total" value={String(health.sessions.total ?? "?")} />
                  <Row label="active" value={String(health.sessions.active ?? "?")} />
                  <Row label="expired" value={String(health.sessions.expired ?? "?")} />
                </>
              )}
            </Section>

            <Section title="Tables">
              <div className="grid grid-cols-[1fr_auto_auto] gap-x-2 gap-y-0.5">
                {health.tables.map(t => (
                  <div key={t.table} className="contents">
                    <span className="font-mono text-[11px]">{t.label}</span>
                    <span className="font-mono text-[10px] text-gray-500">{t.table}</span>
                    {t.ok ? (
                      <span className="text-right tabular-nums">{t.count?.toLocaleString()}</span>
                    ) : (
                      <span className="text-red-700 text-[10px] truncate" title={t.error || ""}>
                        ERROR
                      </span>
                    )}
                  </div>
                ))}
              </div>
              {health.tables.some(t => !t.ok) && (
                <div className="mt-2 text-[10px]">
                  <div className="font-bold text-red-800">Table errors</div>
                  {health.tables.filter(t => !t.ok).map(t => (
                    <div key={t.table} className="mt-1">
                      <span className="font-mono">{t.table}:</span>{" "}
                      <span className="text-red-700 break-all">{t.error}</span>
                    </div>
                  ))}
                </div>
              )}
            </Section>
          </div>
        )}
      </div>
    </>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="font-bold border-b border-gray-300 mb-1">{title}</div>
      <div className="pl-2">{children}</div>
    </div>
  );
}

function Row({ label, value, ok }: { label: string; value: string; ok?: boolean }) {
  return (
    <div className="flex gap-2">
      <span className="text-gray-700 w-24">{label}</span>
      <span
        className={`flex-1 break-all ${ok === false ? "text-red-700" : ok === true ? "text-green-800" : ""}`}
      >
        {value}
      </span>
    </div>
  );
}

function DrawingTestTab({
  result,
  loading,
  err,
  onRun,
}: {
  result: DiagnosticsTestResult | null;
  loading: boolean;
  err: string | null;
  onRun: () => void;
}) {
  return (
    <>
      <div className="flex items-center gap-1 p-1 border-b border-gray-400">
        <button className="win98-button px-2 py-0.5" onClick={onRun} disabled={loading}>
          {loading ? "Running…" : "Run Drawing Test"}
        </button>
        {result && (
          <span className="ml-2 text-[10px] text-gray-700">
            ran at {new Date(result.ranAt).toLocaleString()} · as "{result.author}"
          </span>
        )}
        {result && (
          <span
            className={`ml-auto px-2 py-0.5 text-[10px] font-bold ${result.ok ? "bg-green-200 text-green-900" : "bg-red-200 text-red-900"}`}
          >
            {result.ok ? "ALL OK" : "FAILED"}
          </span>
        )}
      </div>

      {err && <div className="text-red-700 px-1 py-1">{err}</div>}

      <div className="flex-1 overflow-auto win98-inset bg-white p-2">
        {!result && !loading && !err && (
          <div className="text-gray-600">
            Click <b>Run Drawing Test</b> to simulate a full drawing-pad submit end-to-end as the admin user.
            It mirrors every step of the real <code>POST /drawings</code> route — auth, validation, ban check,
            insert, audit log, read-back — and reports exactly which step fails. The test row is automatically
            cleaned up so it won't appear in the public gallery.
          </div>
        )}

        {result && (
          <div className="flex flex-col gap-1">
            {result.steps.map((s, i) => (
              <div
                key={i}
                className={`border p-1 ${s.skipped ? "border-gray-300 bg-gray-50 opacity-60" : s.ok ? "border-green-400 bg-green-50" : "border-red-500 bg-red-50"}`}
              >
                <div className="flex items-center gap-2">
                  <span className="font-bold w-4 text-center">
                    {s.skipped ? "—" : s.ok ? "✓" : "✗"}
                  </span>
                  <span className="font-bold flex-1">{s.name}</span>
                  {!s.skipped && (
                    <span className="text-[10px] text-gray-600">{s.durationMs}ms</span>
                  )}
                </div>
                {s.detail && (
                  <div className="pl-6 text-[10px] text-gray-700">{s.detail}</div>
                )}
                {s.error && (
                  <pre className="pl-6 text-[10px] text-red-800 whitespace-pre-wrap break-all mt-1">
                    {s.error}
                  </pre>
                )}
                {s.skipped && (
                  <div className="pl-6 text-[10px] text-gray-500 italic">skipped (earlier step failed)</div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </>
  );
}

function SchemaDriftTab({
  result,
  loading,
  err,
  onRun,
}: {
  result: DiagnosticsSchemaDrift | null;
  loading: boolean;
  err: string | null;
  onRun: () => void;
}) {
  return (
    <>
      <div className="flex items-center gap-1 p-1 border-b border-gray-400">
        <button className="win98-button px-2 py-0.5" onClick={onRun} disabled={loading}>
          {loading ? "Checking…" : "Check Schema Drift"}
        </button>
        {result && (
          <span className="ml-2 text-[10px] text-gray-700">
            ran at {new Date(result.ranAt).toLocaleString()} · {result.durationMs}ms · {result.totalTables} tables
          </span>
        )}
        {result && (
          <span
            className={`ml-auto px-2 py-0.5 text-[10px] font-bold ${result.ok ? "bg-green-200 text-green-900" : "bg-red-200 text-red-900"}`}
          >
            {result.ok ? "IN SYNC" : `DRIFT (${result.driftedTables})`}
          </span>
        )}
      </div>

      {err && <div className="text-red-700 px-1 py-1">{err}</div>}

      <div className="flex-1 overflow-auto win98-inset bg-white p-2">
        {!result && !loading && !err && (
          <div className="text-gray-600">
            Click <b>Check Schema Drift</b> to compare every Drizzle-defined table against the live Postgres
            database. Missing tables and missing columns are flagged so you can confirm the self-healing
            <code> ensure-schema</code> bootstrap covers everything the code expects.
          </div>
        )}

        {result && (
          <div className="flex flex-col gap-1">
            {result.tables.length === 0 && (
              <div className="text-gray-600">No Drizzle tables registered.</div>
            )}
            {result.tables.map(t => {
              const status = !t.exists
                ? "MISSING TABLE"
                : t.missingColumns.length > 0
                  ? `${t.missingColumns.length} missing col${t.missingColumns.length === 1 ? "" : "s"}`
                  : "ok";
              const tone = !t.exists
                ? "border-red-500 bg-red-50"
                : t.missingColumns.length > 0
                  ? "border-yellow-500 bg-yellow-50"
                  : "border-green-400 bg-green-50";
              const icon = !t.exists ? "✗" : t.missingColumns.length > 0 ? "!" : "✓";
              return (
                <div key={t.table} className={`border p-1 ${tone}`}>
                  <div className="flex items-center gap-2">
                    <span className="font-bold w-4 text-center">{icon}</span>
                    <span className="font-mono font-bold flex-1">{t.table}</span>
                    <span className="text-[10px] text-gray-700">{status}</span>
                  </div>
                  {t.missingColumns.length > 0 && (
                    <div className="pl-6 mt-1">
                      <div className="text-[10px] font-bold text-red-800">missing columns</div>
                      <div className="grid grid-cols-[auto_auto] gap-x-2 gap-y-0.5 text-[10px]">
                        {t.missingColumns.map(c => (
                          <div key={c.name} className="contents">
                            <span className="font-mono">{c.name}</span>
                            <span className="font-mono text-gray-700">{c.expectedType}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                  {t.extraColumns.length > 0 && (
                    <div className="pl-6 mt-1 text-[10px] text-gray-600">
                      <span className="font-bold">extra columns on DB:</span>{" "}
                      <span className="font-mono">{t.extraColumns.join(", ")}</span>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </>
  );
}
