import { useRef, useState } from "react";
import { useAuth } from "../lib/auth-store";

const BASE = "/api";

// Target byte size for each /admin/import/rows chunk. Picked well below
// any plausible edge-proxy body limit (Replit's deployment edge, the dev
// preview proxy, etc.) so the upload always lands. The server caps each
// chunk at 16MB and we leave headroom for JSON envelope overhead.
const CHUNK_TARGET_BYTES = 2 * 1024 * 1024; // 2MB

// Sentinel thrown from a chunk-flush helper to bail out of a single table's
// upload loop without aborting the entire restore. The catch handler in
// importNow continues with the next table.
class ChunkRejected extends Error {
  readonly table: string;
  constructor(table: string) {
    super(`chunk rejected for ${table}`);
    this.table = table;
  }
}

// Read the response body in a way that NEVER throws on HTML/empty responses.
// When an upstream proxy returns an HTML error page (e.g. 413 Payload Too
// Large or 502 Bad Gateway) the original `await r.json()` blew up with
// "Unexpected token '<', '<html><hea'... is not valid JSON" and the user
// had no idea what actually went wrong. This helper returns either the
// parsed JSON or a synthetic object describing what came back so the UI
// can show a useful message.
async function readResponse(r: Response): Promise<any> {
  const text = await r.text();
  if (!text) return {};
  try {
    return JSON.parse(text);
  } catch {
    // The server we control always replies with JSON, so a non-JSON body
    // means an intermediary proxy intercepted the request. Surface the
    // status and a short snippet so the operator can diagnose.
    const snippet = text.replace(/\s+/g, " ").trim().slice(0, 160);
    return {
      __nonJson: true,
      error: `Server returned a non-JSON response (HTTP ${r.status}). This usually means an upstream proxy rejected the request — most often a body-size limit. Snippet: ${snippet}`,
    };
  }
}

export function SiteBackup() {
  const me = useAuth((s) => s.user);
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [summary, setSummary] = useState<{ tableCount: number; rowCount: number; exportedAt?: string } | null>(null);
  const [pendingPayload, setPendingPayload] = useState<any>(null);
  // Live progress text shown during a chunked import so the user can see
  // the upload is actually advancing instead of staring at a frozen button.
  const [progress, setProgress] = useState<string | null>(null);
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

  function clearMessages() { setMsg(null); setErr(null); setImportReport(null); setProgress(null); }

  async function exportNow() {
    clearMessages();
    setBusy("export");
    try {
      const r = await fetch(`${BASE}/admin/export`, { credentials: "include" });
      if (!r.ok) {
        // Try to surface the server's JSON error detail before falling
        // back to the generic status code, so admins see "duplicate key
        // value violates ..." instead of just "500".
        const j = await readResponse(r).catch(() => ({} as any));
        throw new Error(j?.error ? `Export failed (${r.status}): ${j.error}` : `Export failed: ${r.status}`);
      }
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
    if (!confirm("Restore from backup?\n\nThis ERASES the current site database and replaces it with the backup contents. Sessions stay valid (you won't be logged out), but everything else — users, posts, photos, drawings, ranks, settings — is overwritten.\n\nIf the upload is interrupted partway through, your site will be left in a partial state — keep this backup file and re-run the import to recover. This cannot be undone unless you exported a backup first.")) return;
    clearMessages();
    setBusy("import");
    setProgress("Starting…");

    // Pull the tables map out of the parsed file. Old exports nested it
    // under `.data`; the streaming exporter writes it at the top level.
    const tables: Record<string, any[]> = (pendingPayload?.tables) || (pendingPayload?.data?.tables) || {};

    try {
      // ---- Phase 1: BEGIN — server truncates and creates a session ----
      setProgress("Preparing database (TRUNCATE)…");
      const beginR = await fetch(`${BASE}/admin/import/begin`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ confirm: true }),
      });
      const beginJ = await readResponse(beginR);
      if (!beginR.ok || !beginJ?.sessionId) {
        setImportReport({ healWarning: beginJ?.healWarning, stage: "begin" });
        throw new Error(beginJ?.error || `Could not begin import (HTTP ${beginR.status}).`);
      }
      const sessionId: string = beginJ.sessionId;
      const initialHealWarning: string | null = beginJ?.healWarning ?? null;

      // ---- Phase 2: ROWS — upload each table in size-bounded chunks ----
      // Fixed insertion order to satisfy foreign-key constraints (parents
      // before children). Tables not in this list are uploaded last in
      // whatever order they appear in the file.
      const ORDER = [
        "users", "ranks", "site_settings", "user_pages", "banned_users",
        "user_ips", "ip_bans", "drawings", "chat_messages",
        "guestbook_entries", "photos", "news_posts", "polls", "tracks",
        "dms", "chess_lobbies", "cafe_settings", "cafe_rooms",
        "cafe_objects", "cafe_presence", "cafe_chat", "forum_threads",
        "forum_posts", "youtube_sync", "blackjack_tables",
        "flappy_players", "flappy_scores", "visit_counter", "chat_audit_log",
      ];
      const seen = new Set(ORDER);
      const remaining = Object.keys(tables).filter((t) => !seen.has(t));
      const orderedTableNames = [...ORDER, ...remaining].filter((t) => Array.isArray(tables[t]) && tables[t].length > 0);

      const perTableUploaded: Record<string, number> = {};
      const perTableSkipped: { table: string; error: string }[] = [];
      let totalUploaded = 0;
      const totalToUpload = orderedTableNames.reduce((s, name) => s + tables[name].length, 0);

      for (const tableName of orderedTableNames) {
        const rows = tables[tableName] as any[];
        // Pack rows into chunks until either the byte budget or a soft
        // row-count cap is hit. Per-row JSON.stringify is unavoidable here
        // — we need to know each row's size to bound the chunk. Cost is
        // bounded by the file we already loaded into memory.
        let buf: any[] = [];
        let bufBytes = 2; // for the surrounding []
        let chunkIndex = 0;

        const flush = async (): Promise<void> => {
          if (buf.length === 0) return;
          chunkIndex++;
          setProgress(`Uploading ${tableName} chunk ${chunkIndex} (${perTableUploaded[tableName] ?? 0}/${rows.length} rows so far · ${totalUploaded}/${totalToUpload} total)…`);
          const r = await fetch(`${BASE}/admin/import/rows`, {
            method: "POST",
            credentials: "include",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ sessionId, table: tableName, rows: buf }),
          });
          const j = await readResponse(r);
          if (!r.ok) {
            // The chunk was rejected. Record the failure and stop sending
            // more rows for THIS table, but keep going on subsequent
            // tables — one failed table shouldn't sink the whole restore.
            perTableSkipped.push({ table: tableName, error: j?.error || `chunk failed (HTTP ${r.status})` });
            // Skip rest of this table by clearing buf and breaking out
            // of the outer loop via a sentinel. We use a thrown marker
            // so we can unwind cleanly from inside flush().
            throw new ChunkRejected(tableName);
          }
          // Server returns { accepted } — credit it (treat 0 as "skipped"
          // when the table didn't exist on the live DB).
          const accepted: number = typeof j?.accepted === "number" ? j.accepted : buf.length;
          perTableUploaded[tableName] = (perTableUploaded[tableName] ?? 0) + accepted;
          totalUploaded += accepted;
          if (accepted === 0 && j?.reason) {
            // Table doesn't exist on live DB — record once and stop sending
            // more chunks for it.
            perTableSkipped.push({ table: tableName, error: j.reason });
            throw new ChunkRejected(tableName);
          }
          buf = [];
          bufBytes = 2;
        };

        try {
          for (const row of rows) {
            const rowJson = JSON.stringify(row);
            const rowBytes = rowJson.length + 1; // +1 for joining comma
            // Flush BEFORE adding when this row would push us over the
            // budget (and we already have at least one row buffered).
            if (buf.length > 0 && bufBytes + rowBytes > CHUNK_TARGET_BYTES) {
              await flush();
            }
            buf.push(row);
            bufBytes += rowBytes;
            // If a single row alone exceeds the budget, send it on its
            // own — better than truncating data. The server's 16MB cap
            // catches truly oversized rows the proxy would also reject.
            if (bufBytes > CHUNK_TARGET_BYTES) {
              await flush();
            }
          }
          await flush();
        } catch (e: any) {
          if (e instanceof ChunkRejected) {
            // Table-level failure: continue with the next table.
            continue;
          }
          throw e;
        }
      }

      // ---- Phase 3: COMMIT — server resets sequences and finalises ----
      setProgress("Finalising (resetting sequences)…");
      const commitR = await fetch(`${BASE}/admin/import/commit`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sessionId }),
      });
      const commitJ = await readResponse(commitR);
      if (!commitR.ok) {
        setImportReport({
          healWarning: initialHealWarning ?? commitJ?.healWarning,
          skipped: [...perTableSkipped, ...(commitJ?.skipped ?? [])],
          stage: "commit",
        });
        throw new Error(commitJ?.error || `Commit failed (HTTP ${commitR.status}).`);
      }

      const allSkipped = [
        ...perTableSkipped,
        ...((commitJ?.skipped ?? []) as { table: string; error: string }[])
          .filter((s) => !perTableSkipped.find((p) => p.table === s.table && p.error === s.error)),
      ];
      const importedCount = (commitJ?.imported ?? Object.keys(perTableUploaded)).length;
      const totalRows = commitJ?.totalRows ?? totalUploaded;
      setMsg(`Restore complete. Imported ${totalRows} rows across ${importedCount} tables. The site may need a refresh to show the new data.`);
      setImportReport({
        healWarning: initialHealWarning ?? commitJ?.healWarning,
        skipped: allSkipped,
        tableRowCounts: commitJ?.tableRowCounts ?? perTableUploaded,
      });
      setPendingPayload(null); setSummary(null);
    } catch (e: any) {
      setErr(e?.message || "Failed to import");
    } finally {
      setBusy(null);
      setProgress(null);
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

      {progress && <div className="text-blue-800 text-xs win98-inset bg-white p-2">{progress}</div>}
      {err && <div className="text-red-700 text-xs win98-inset bg-white p-2 break-words whitespace-pre-wrap">{err}</div>}
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
