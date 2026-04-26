import { useRef, useState } from "react";
import { useAuth } from "../lib/auth-store";

const BASE = "/api";

export function SiteBackup() {
  const me = useAuth((s) => s.user);
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [summary, setSummary] = useState<{ tableCount: number; rowCount: number; exportedAt?: string } | null>(null);
  const [pendingPayload, setPendingPayload] = useState<any>(null);
  // Detail blocks shown after an import attempt — separate from `msg`/`err`
  // so a partially-successful restore can show both the success summary and
  // the per-table problems that were skipped.
  const [importReport, setImportReport] = useState<{
    healWarning?: string | null;
    skipped?: { table: string; error: string }[];
    tableRowCounts?: Record<string, number>;
    stage?: string;
  } | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  if (!me?.isAdmin) {
    return <div className="p-3 text-sm text-red-700">Only the site owner can use the backup tool.</div>;
  }

  function clearMessages() { setMsg(null); setErr(null); setImportReport(null); }

  async function exportNow() {
    clearMessages();
    setBusy("export");
    try {
      const r = await fetch(`${BASE}/admin/export`, { credentials: "include" });
      if (!r.ok) throw new Error(`Export failed: ${r.status}`);
      const blob = await r.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `site-backup-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-")}.json`;
      document.body.appendChild(a); a.click(); document.body.removeChild(a);
      setTimeout(() => URL.revokeObjectURL(url), 5_000);
      setMsg("Backup downloaded. Save it somewhere safe — keep multiple copies for important sites.");
    } catch (e: any) {
      setErr(e?.message || "Failed to export");
    } finally {
      setBusy(null);
    }
  }

  async function pickFile(file: File) {
    clearMessages();
    setSummary(null); setPendingPayload(null);
    try {
      const text = await file.text();
      const parsed = JSON.parse(text);
      const tables = (parsed && parsed.tables) || (parsed && parsed.data && parsed.data.tables);
      if (!tables || typeof tables !== "object") {
        throw new Error("This file doesn't look like a site backup (missing `tables`).");
      }
      const tableCount = Object.keys(tables).length;
      const rowCount = Object.values(tables).reduce((s: number, rows: any) => s + (Array.isArray(rows) ? rows.length : 0), 0);
      setSummary({ tableCount, rowCount, exportedAt: parsed.exportedAt });
      setPendingPayload(parsed);
    } catch (e: any) {
      setErr(e?.message || "Could not read backup file");
    }
  }

  async function importNow() {
    if (!pendingPayload) return;
    if (!confirm("Restore from backup?\n\nThis ERASES the current site database and replaces it with the backup contents. Sessions stay valid (you won't be logged out), but everything else — users, posts, photos, drawings, ranks, settings — is overwritten.\n\nThis cannot be undone unless you exported a backup first.")) return;
    clearMessages();
    setBusy("import");
    try {
      const r = await fetch(`${BASE}/admin/import`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ confirm: true, data: pendingPayload }),
      });
      const j = await r.json();
      if (!r.ok) {
        // Surface the per-stage detail the new server returns so the user
        // can see *what* failed (e.g. TRUNCATE vs INSERT into users) and
        // whether ensureSchema warned about anything beforehand.
        setImportReport({
          healWarning: j?.healWarning,
          skipped: j?.errors,
          stage: j?.stage,
        });
        throw new Error(j?.error || `Import failed: ${r.status}`);
      }
      setMsg(`Restore complete. Imported ${j.totalRows} rows across ${j.imported.length} tables. The site may need a refresh to show the new data.`);
      setImportReport({
        healWarning: j?.healWarning,
        skipped: j?.skipped,
        tableRowCounts: j?.tableRowCounts,
      });
      setPendingPayload(null); setSummary(null);
    } catch (e: any) {
      setErr(e?.message || "Failed to import");
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="w-full h-full flex flex-col gap-2 p-3 text-sm overflow-auto">
      <section className="win98-inset bg-[#f4f4f4] p-2">
        <div className="font-bold mb-1">Export Database</div>
        <div className="text-[11px] text-gray-700 mb-2">
          Downloads the entire site database as a single JSON file. This includes users, ranks, chat history, drawings, the cafe, the forum, photos, news, settings — everything except active login sessions.
        </div>
        <button className="win98-button px-3 py-0.5 font-bold" disabled={busy === "export"} onClick={exportNow}>
          {busy === "export" ? "Exporting…" : "Export & Download Backup"}
        </button>
      </section>

      <section className="win98-inset bg-[#f4f4f4] p-2">
        <div className="font-bold mb-1">Import / Restore</div>
        <div className="text-[11px] text-gray-700 mb-2">
          Replaces all current site data with the contents of a backup file. Make a fresh export first if you want to be able to undo this.
        </div>
        <input
          ref={fileRef}
          type="file"
          accept="application/json,.json"
          className="hidden"
          onChange={(e) => { const f = e.target.files?.[0]; if (f) void pickFile(f); e.target.value = ""; }}
        />
        <div className="flex gap-1 items-center flex-wrap">
          <button className="win98-button px-2 py-0.5" disabled={busy === "import"} onClick={() => fileRef.current?.click()}>Choose Backup File…</button>
          {summary && (
            <button className="win98-button px-3 py-0.5 font-bold text-red-700" disabled={busy === "import"} onClick={importNow}>
              {busy === "import" ? "Restoring…" : `Restore ${summary.rowCount} rows`}
            </button>
          )}
          {summary && (
            <button className="win98-button px-2 py-0.5" disabled={busy === "import"} onClick={() => { setSummary(null); setPendingPayload(null); clearMessages(); }}>Cancel</button>
          )}
        </div>
        {summary && (
          <div className="mt-2 text-[11px] text-gray-800 win98-inset bg-white p-1">
            Loaded backup with <b>{summary.tableCount}</b> tables and <b>{summary.rowCount}</b> total rows
            {summary.exportedAt ? <> (exported {new Date(summary.exportedAt).toLocaleString()})</> : null}.
            Click <b>Restore</b> to apply, or pick a different file.
          </div>
        )}
      </section>

      {err && <div className="text-red-700 text-xs win98-inset bg-white p-2">{err}</div>}
      {msg && <div className="text-green-700 text-xs win98-inset bg-white p-2">{msg}</div>}

      {importReport && (importReport.healWarning || (importReport.skipped && importReport.skipped.length > 0) || importReport.stage) && (
        <div className="win98-inset bg-white p-2 text-[11px] flex flex-col gap-1">
          <div className="font-bold">Import details</div>
          {importReport.stage && (
            <div><span className="text-gray-700">stopped at stage:</span> <span className="font-mono">{importReport.stage}</span></div>
          )}
          {importReport.healWarning && (
            <div className="text-yellow-800">
              <span className="font-bold">Schema heal warning:</span> {importReport.healWarning}
            </div>
          )}
          {importReport.skipped && importReport.skipped.length > 0 && (
            <div>
              <div className="font-bold text-red-800">Skipped / failed tables</div>
              <ul className="pl-3 list-disc">
                {importReport.skipped.map((s) => (
                  <li key={s.table}>
                    <span className="font-mono">{s.table}</span>: <span className="text-red-700">{s.error}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
