import { useEffect, useRef, useState } from "react";
import {
  createHostedSite,
  deleteHostedSite,
  deleteHostedSiteFile,
  fetchHostedSite,
  updateHostedSite,
  uploadHostedSiteFile,
  type HostedSiteInfo,
} from "../lib/api";

type Props = { username: string; isOwner: boolean };

const MAX_FILE_BYTES = 6 * 1024 * 1024;

function formatBytes(value: number): string {
  if (value < 1024) return `${value} B`;
  if (value < 1024 ** 2) return `${(value / 1024).toFixed(0)} KB`;
  if (value < 1024 ** 3) return `${(value / 1024 ** 2).toFixed(1)} MB`;
  return `${(value / 1024 ** 3).toFixed(2)} GB`;
}

function safePath(value: string): string {
  return value.split("/")
    .filter(Boolean)
    .map((part) => part.replace(/[^a-zA-Z0-9._-]/g, "-"))
    .filter((part) => part !== "." && part !== "..")
    .join("/");
}

function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      if (!(reader.result instanceof ArrayBuffer)) {
        reject(new Error("Could not read the selected file."));
        return;
      }
      const bytes = new Uint8Array(reader.result);
      let binary = "";
      for (let offset = 0; offset < bytes.length; offset += 0x8000) {
        binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000));
      }
      resolve(btoa(binary));
    };
    reader.onerror = () => reject(new Error("Could not read the selected file."));
    reader.readAsArrayBuffer(file);
  });
}

function hostedPageUrl(username: string, filePath: string): string {
  const encodedPath = filePath.split("/").map(encodeURIComponent).join("/");
  return `/api/custom-sites/${encodeURIComponent(username)}/${encodedPath}`;
}

export function HostedSitePanel({ username, isOwner }: Props) {
  const [site, setSite] = useState<HostedSiteInfo | null>(null);
  const [entryPath, setEntryPath] = useState("index.html");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const folderInput = useRef<HTMLInputElement>(null);

  async function refresh() {
    setLoading(true);
    setError(null);
    try {
      const result = await fetchHostedSite(username);
      setSite(result);
      setEntryPath(result.entryPath || "index.html");
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "The hosted site could not be loaded.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void refresh();
  }, [username]);
  useEffect(() => {
    folderInput.current?.setAttribute("webkitdirectory", "");
  }, []);

  async function createSite() {
    setBusy(true);
    setError(null);
    try {
      setSite(await createHostedSite(username));
      setStatus("Your site is ready for files.");
    } catch (createError) {
      setError(createError instanceof Error ? createError.message : "The site could not be created.");
    } finally {
      setBusy(false);
    }
  }

  async function uploadFiles(files: FileList | null) {
    if (!files?.length) return;
    setBusy(true);
    setError(null);
    setStatus(null);
    const selected = Array.from(files);
    let completed = 0;
    try {
      for (const file of selected) {
        if (file.size > MAX_FILE_BYTES) {
          throw new Error(`${file.name} is larger than the 6 MB per-file limit.`);
        }
        const relativePath = safePath(file.webkitRelativePath || file.name);
        if (!relativePath) throw new Error(`The path for ${file.name} is invalid.`);
        if (/\.(js|mjs)$/i.test(relativePath) && !site?.canRunJs) {
          throw new Error("Your rank does not have the separate permission needed to upload JavaScript.");
        }
        setProgress(`Uploading ${completed + 1} of ${selected.length}: ${relativePath}`);
        await uploadHostedSiteFile(username, relativePath, await fileToBase64(file));
        completed++;
      }
      setStatus(`${completed} file${completed === 1 ? "" : "s"} uploaded.`);
      await refresh();
    } catch (uploadError) {
      setError(uploadError instanceof Error ? uploadError.message : "The file upload failed.");
      if (completed > 0) await refresh();
    } finally {
      setBusy(false);
      setProgress("");
      if (fileInput.current) fileInput.current.value = "";
      if (folderInput.current) folderInput.current.value = "";
    }
  }

  async function publish(active: boolean) {
    setBusy(true);
    setError(null);
    try {
      await updateHostedSite(username, { active, entryPath });
      await refresh();
      setStatus(active ? "Your site is published." : "Your site is offline.");
    } catch (publishError) {
      setError(publishError instanceof Error ? publishError.message : "The site settings could not be saved.");
    } finally {
      setBusy(false);
    }
  }

  async function removeFile(filePath: string) {
    if (!confirm(`Delete ${filePath}?`)) return;
    setBusy(true);
    setError(null);
    try {
      await deleteHostedSiteFile(username, filePath);
      await refresh();
    } catch (deleteError) {
      setError(deleteError instanceof Error ? deleteError.message : "The file could not be deleted.");
    } finally {
      setBusy(false);
    }
  }

  async function removeSite() {
    if (!confirm("Delete this hosted site and all of its files? This cannot be undone.")) return;
    setBusy(true);
    setError(null);
    try {
      await deleteHostedSite(username);
      setSite({ exists: false, active: false, files: [], totalBytes: 0, canCreate: site?.canCreate, canRunJs: site?.canRunJs, quotaBytes: site?.quotaBytes });
      setStatus("The hosted site and its files were deleted.");
    } catch (deleteError) {
      setError(deleteError instanceof Error ? deleteError.message : "The site could not be deleted.");
    } finally {
      setBusy(false);
    }
  }

  const files = site?.files || [];
  const htmlFiles = files.filter((file) => file.contentType.startsWith("text/html"));
  const previewUrl = site?.active ? hostedPageUrl(username, site.entryPath || "index.html") : "";
  const used = site?.totalBytes || 0;
  const quota = site?.quotaBytes || 0;
  const percent = quota > 0 ? Math.min(100, (used / quota) * 100) : 0;

  if (loading) return <div className="p-3 text-xs">Loading HTML site…</div>;

  return (
    <div className="flex h-full min-h-0 flex-col gap-2 overflow-auto bg-[#c0c0c0] p-2 text-xs" data-testid="hosted-site-panel">
      {error && <div role="alert" className="border border-[#800000] bg-[#ffffe1] p-2 text-[#800000]">{error}</div>}
      {status && <div role="status" className="text-[10px] text-[#006000]">{status}</div>}
      {!isOwner && !site?.active ? (
        <div className="win98-inset bg-white p-4 text-center text-gray-600">{username} has not published an HTML site.</div>
      ) : !isOwner ? (
        <div className="flex min-h-0 flex-1 flex-col gap-1">
          <div className="font-bold text-[#000080]">{username}'s HTML site</div>
          <iframe
            title={`${username}'s hosted site`}
            src={previewUrl}
            sandbox="allow-scripts"
            className="win98-inset min-h-[280px] w-full flex-1 bg-white"
            referrerPolicy="no-referrer"
            data-testid="iframe-hosted-site"
          />
        </div>
      ) : !site?.exists ? (
        <div className="win98-inset flex flex-col items-center gap-2 bg-white p-4 text-center">
          <div className="font-bold text-[#000080]">Your small site within the site</div>
          <p className="max-w-lg text-gray-700">
            Upload a static HTML/CSS site with images, video, fonts, and other assets. Files are hosted separately from your profile canvas.
          </p>
          {site?.canCreate ? (
            <button type="button" className="win98-button px-3 py-1" onClick={() => void createSite()} disabled={busy}>Create HTML site</button>
          ) : (
            <div className="border border-[#808080] bg-[#f4f4f4] p-2 text-gray-700">
              Your current rank does not have the <strong>createHtmlPage</strong> permission. Ask an administrator to assign it.
            </div>
          )}
          <div className="text-[10px] text-gray-500">JavaScript is disabled by default and needs its own rank permission. Hosted pages are sandboxed and cannot make network requests.</div>
        </div>
      ) : (
        <>
          <div className="win98-inset bg-white p-2">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <div className="font-bold text-[#000080]">Manage your HTML site</div>
                <div className="mt-0.5 text-[10px] text-gray-600">
                  {formatBytes(used)} used of {formatBytes(quota)} · {site.canRunJs ? "JavaScript permission enabled" : "JavaScript disabled"}
                </div>
              </div>
              <div className="flex flex-wrap gap-1">
                <button type="button" className="win98-button px-2 py-1" onClick={() => fileInput.current?.click()} disabled={busy || !site.canCreate}>Add files</button>
                <button type="button" className="win98-button px-2 py-1" onClick={() => folderInput.current?.click()} disabled={busy || !site.canCreate}>Upload folder</button>
                <input ref={fileInput} className="hidden" type="file" multiple accept=".html,.htm,.css,.js,.mjs,.json,.txt,.png,.jpg,.jpeg,.gif,.webp,.ico,.mp4,.webm,.mp3,.ogg,.woff,.woff2,.ttf,.otf" onChange={(event) => void uploadFiles(event.target.files)} />
                <input ref={folderInput} className="hidden" type="file" multiple accept=".html,.htm,.css,.js,.mjs,.json,.txt,.png,.jpg,.jpeg,.gif,.webp,.ico,.mp4,.webm,.mp3,.ogg,.woff,.woff2,.ttf,.otf" onChange={(event) => void uploadFiles(event.target.files)} />
              </div>
            </div>
            <div className="mt-2 h-3 border border-[#808080] bg-[#eee]">
              <div className="h-full bg-[#008000]" style={{ width: `${percent}%` }} />
            </div>
            {progress && <div className="mt-1 text-[10px] text-gray-600">{progress}</div>}
            <div className="mt-1 text-[10px] text-gray-600">
              Up to 6 MB per file. Allowed types include HTML, CSS, images, video, fonts, JavaScript (rank permission required), JSON, and text. Maximum rank quota is 100 GB.
            </div>
          </div>

          <div className="win98-inset min-h-0 flex-1 overflow-auto bg-white p-2">
            <div className="mb-1 font-bold">Files ({files.length})</div>
            {files.length === 0 ? (
              <div className="p-2 text-gray-600">No files uploaded. Add an index.html file to get started.</div>
            ) : files.map((file) => (
              <div key={file.path} className="flex items-center gap-1 border-t border-[#ddd] py-1">
                <span className="min-w-0 flex-1 truncate font-mono">{file.path}</span>
                <span className="shrink-0 text-[10px] text-gray-600">{formatBytes(file.size)}</span>
                {file.contentType.startsWith("text/html") && (
                  <button type="button" className="win98-button shrink-0 px-1" onClick={() => setEntryPath(file.path)} title="Use as the home page">Home</button>
                )}
                <button type="button" className="win98-button shrink-0 px-1 text-[#800000]" onClick={() => void removeFile(file.path)} disabled={busy} aria-label={`Delete ${file.path}`}>Delete</button>
              </div>
            ))}
          </div>

          <div className="win98-inset flex flex-wrap items-end gap-2 bg-[#e2e2e2] p-2">
            <label className="flex min-w-[180px] flex-1 flex-col gap-1">
              Home page
              <select className="win98-inset bg-white px-1 py-1" value={entryPath} onChange={(event) => setEntryPath(event.target.value)}>
                {htmlFiles.length === 0 && <option value={entryPath}>{entryPath}</option>}
                {htmlFiles.map((file) => <option key={file.path} value={file.path}>{file.path}</option>)}
              </select>
            </label>
            <button type="button" className="win98-button px-3 py-1 font-bold" onClick={() => void publish(!site.active)} disabled={busy || (!site.active && !site.canCreate) || htmlFiles.length === 0}>
              {site.active ? "Take offline" : "Publish"}
            </button>
            {site.active && <a className="win98-button px-2 py-1 text-[#000080] underline" href={previewUrl} target="_blank" rel="noreferrer">Open site</a>}
            <button type="button" className="win98-button px-2 py-1 text-[#800000]" onClick={() => void removeSite()} disabled={busy}>Delete site</button>
          </div>
          <div className="text-[10px] text-gray-600">
            Pages render in an isolated iframe. Even rank-enabled JavaScript cannot access this app, submit forms, or make network requests.
          </div>
        </>
      )}
    </div>
  );
}
