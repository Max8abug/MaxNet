import { useEffect, useMemo, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import {
  createWikiPage,
  deleteWikiAsset,
  deleteWikiPage,
  fetchWikiPage,
  fetchWikiPages,
  updateWikiPage,
  uploadWikiAsset,
  type WikiAsset,
  type WikiPageRecord,
  type WikiPageSummary,
} from "./_preview-api";
import { hasPermission, usePreviewWikiAuth } from "./_preview-auth";

function mediaUrl(asset: WikiAsset) {
  return asset.url.startsWith("/") ? asset.url : `/${asset.url}`;
}

function formatBytes(value: number): string {
  if (value < 1024 * 1024) return `${Math.max(1, Math.round(value / 1024))} KB`;
  return `${(value / (1024 * 1024)).toFixed(1)} MB`;
}

function WikiBrowserCurrent() {
  const user = usePreviewWikiAuth((state) => state.user);
  const ranks = usePreviewWikiAuth((state) => state.ranks);
  const refreshRanks = usePreviewWikiAuth((state) => state.refreshRanks);
  const canEdit = hasPermission(user, "editWiki", ranks);
  const [pages, setPages] = useState<WikiPageSummary[]>([]);
  const [selectedSlug, setSelectedSlug] = useState<string | null>(null);
  const [page, setPage] = useState<WikiPageRecord | null>(null);
  const [assets, setAssets] = useState<WikiAsset[]>([]);
  const [title, setTitle] = useState("");
  const [content, setContent] = useState("");
  const [isCreating, setIsCreating] = useState(false);
  const [editing, setEditing] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  const selectedSummary = useMemo(
    () => pages.find((item) => item.slug === selectedSlug) || null,
    [pages, selectedSlug],
  );

  async function loadIndex() {
    setLoading(true);
    setError(null);
    try {
      const result = await fetchWikiPages();
      setPages(result);
      if (selectedSlug && !result.some((item) => item.slug === selectedSlug)) {
        setSelectedSlug(null);
        setPage(null);
        setAssets([]);
      }
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "The wiki could not be loaded.");
    } finally {
      setLoading(false);
    }
  }

  async function openPage(slug: string) {
    setSelectedSlug(slug);
    setIsCreating(false);
    setEditing(false);
    setError(null);
    setStatus(null);
    try {
      const result = await fetchWikiPage(slug);
      setPage(result.page);
      setAssets(result.assets);
      setTitle(result.page.title);
      setContent(result.page.content);
    } catch (loadError) {
      setPage(null);
      setAssets([]);
      setError(loadError instanceof Error ? loadError.message : "That wiki page could not be opened.");
    }
  }

  useEffect(() => {
    void loadIndex().then(() => void openPage("getting-started"));
  }, []);
  useEffect(() => {
    void refreshRanks();
  }, [refreshRanks]);

  async function savePage() {
    setSaving(true);
    setError(null);
    setStatus(null);
    try {
      if (isCreating) {
        const result = await createWikiPage(title, content);
        setPage(result.page);
        setAssets(result.assets);
        setSelectedSlug(result.page.slug);
      } else if (page) {
        const result = await updateWikiPage(page.slug, title, content);
        setPage(result.page);
        setAssets(result.assets);
      }
      setIsCreating(false);
      setEditing(false);
      setStatus("Page saved.");
      await loadIndex();
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "The page could not be saved.");
    } finally {
      setSaving(false);
    }
  }

  async function uploadFiles(files: FileList | null) {
    if (!page || !files?.length) return;
    setStatus(null);
    setError(null);
    const selected = Array.from(files);
    let uploaded = 0;
    for (const file of selected) {
      if (file.size > 6 * 1024 * 1024) {
        setError(`${file.name} is larger than the 6 MB per-file limit.`);
        continue;
      }
      if (!/^(image\/(png|jpeg|gif|webp)|video\/(mp4|webm))$/.test(file.type)) {
        setError(`${file.name} is not a supported image or video.`);
        continue;
      }
      try {
        const dataUrl = await new Promise<string>((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = () => typeof reader.result === "string" ? resolve(reader.result) : reject(new Error("Could not read file."));
          reader.onerror = () => reject(new Error("Could not read file."));
          reader.readAsDataURL(file);
        });
        await uploadWikiAsset(page.slug, file.name, dataUrl);
        uploaded++;
      } catch (uploadError) {
        setError(uploadError instanceof Error ? uploadError.message : `Could not upload ${file.name}.`);
        break;
      }
    }
    if (fileInput.current) fileInput.current.value = "";
    try {
      const result = await fetchWikiPage(page.slug);
      setAssets(result.assets);
      if (uploaded) setStatus(`${uploaded} media file${uploaded === 1 ? "" : "s"} uploaded.`);
    } catch (refreshError) {
      setError(refreshError instanceof Error ? refreshError.message : "Could not refresh the media list. Reopen the page to see uploaded files.");
    }
  }

  async function removeAsset(asset: WikiAsset) {
    if (!confirm(`Remove ${asset.fileName} from this page?`)) return;
    try {
      await deleteWikiAsset(asset.id);
      setAssets((current) => current.filter((item) => item.id !== asset.id));
    } catch (removeError) {
      setError(removeError instanceof Error ? removeError.message : "The media could not be removed.");
    }
  }

  async function removePage() {
    if (!page || !confirm(`Delete "${page.title}" and its uploaded media?`)) return;
    try {
      await deleteWikiPage(page.slug);
      setPage(null);
      setAssets([]);
      setSelectedSlug(null);
      setTitle("");
      setContent("");
      await loadIndex();
    } catch (removeError) {
      setError(removeError instanceof Error ? removeError.message : "The wiki page could not be deleted.");
    }
  }

  function startNewPage() {
    setPage(null);
    setAssets([]);
    setSelectedSlug(null);
    setTitle("");
    setContent("");
    setIsCreating(true);
    setEditing(true);
    setError(null);
    setStatus(null);
  }

  return (
    <div className="flex h-full min-h-0 flex-col bg-[#c0c0c0] text-xs text-black" data-testid="wiki-browser">
      <div className="flex shrink-0 items-center justify-between border-b border-[#808080] bg-[#d8d8d8] p-2">
        <div className="min-w-0">
          <div className="text-base font-bold text-[#000080]">Site Wiki</div>
          <div className="text-[10px] text-gray-700">Community pages, guides, and references.</div>
        </div>
        {canEdit && (
          <button type="button" className="win98-button shrink-0 px-2 py-1" onClick={startNewPage} data-testid="button-wiki-new-page">
            New page
          </button>
        )}
      </div>

      {error && <div role="alert" className="m-2 border border-[#800000] bg-[#ffffe1] p-2 text-[#800000]">{error}</div>}
      {status && <div role="status" className="mx-2 mt-1 text-[10px] text-[#006000]">{status}</div>}

      <div className="flex min-h-0 flex-1">
        <aside className="flex w-[34%] min-w-[140px] shrink-0 flex-col border-r border-[#808080] bg-[#e2e2e2]">
          <div className="border-b border-[#aaa] px-2 py-1 font-bold text-[#000080]">Pages ({pages.length})</div>
          <div className="min-h-0 flex-1 overflow-auto p-1">
            {loading ? (
              <div className="p-2 text-gray-600">Loading pages...</div>
            ) : pages.length === 0 ? (
              <div className="p-2 text-gray-600">No pages yet.{canEdit ? " Create the first page." : ""}</div>
            ) : pages.map((item) => (
              <button
                key={item.slug}
                type="button"
                onClick={() => void openPage(item.slug)}
                className={`mb-1 block w-full border px-2 py-1.5 text-left ${selectedSlug === item.slug ? "border-[#000080] bg-[#dcecff]" : "border-transparent bg-white hover:bg-[#f3f7ff]"}`}
                data-testid={`wiki-page-${item.slug}`}
              >
                <span className="block truncate font-bold text-[#000080]">{item.title}</span>
                <span className="mt-0.5 block line-clamp-2 text-[10px] text-gray-600">{item.excerpt || "No description yet."}</span>
              </button>
            ))}
          </div>
          <button type="button" className="win98-button m-1 px-2 py-1" onClick={() => void loadIndex()} disabled={loading}>Refresh index</button>
        </aside>

        <main className="min-w-0 flex-1 overflow-auto bg-white">
          {editing ? (
            <div className="flex min-h-full flex-col gap-2 p-3">
              <label className="flex flex-col gap-1 font-bold">
                Page title
                <input className="win98-inset w-full bg-white px-2 py-1 font-normal" value={title} maxLength={100} onChange={(event) => setTitle(event.target.value)} />
              </label>
              <label className="flex min-h-[220px] flex-1 flex-col gap-1 font-bold">
                Wiki text (Markdown)
                <textarea
                  className="win98-inset min-h-[200px] flex-1 resize-y bg-white p-2 font-mono text-[11px] font-normal"
                  value={content}
                  maxLength={100_000}
                  onChange={(event) => setContent(event.target.value)}
                  placeholder={"# Overview\n\nWrite a guide or reference here. Use Markdown for headings, links, lists, and tables."}
                />
              </label>
              {page && (
                <div className="win98-inset bg-[#f2f2f2] p-2">
                  <div className="mb-1 flex flex-wrap items-center justify-between gap-1">
                    <strong>Page media</strong>
                    <button type="button" className="win98-button px-2 py-0.5" onClick={() => fileInput.current?.click()} data-testid="button-wiki-upload-media">
                      Add images/videos
                    </button>
                    <input ref={fileInput} className="hidden" type="file" accept="image/png,image/jpeg,image/gif,image/webp,video/mp4,video/webm" multiple onChange={(event) => void uploadFiles(event.target.files)} />
                  </div>
                  <div className="text-[10px] text-gray-600">PNG, JPEG, GIF, WebP, MP4, or WebM; 6 MB per file.</div>
                  {assets.map((asset) => (
                    <div key={asset.id} className="mt-1 flex items-center gap-1 border-t border-[#ccc] pt-1">
                      <span className="min-w-0 flex-1 truncate">{asset.fileName} · {formatBytes(asset.size)}</span>
                      <button type="button" className="win98-button px-1" onClick={() => void removeAsset(asset)} aria-label={`Remove ${asset.fileName}`}>Remove</button>
                    </div>
                  ))}
                </div>
              )}
              {!page && <div className="text-[10px] text-gray-600">Save this page before attaching media.</div>}
              <div className="flex justify-end gap-1">
                <button type="button" className="win98-button px-3 py-1" onClick={() => { setEditing(false); setIsCreating(false); if (selectedSlug) void openPage(selectedSlug); }} disabled={saving}>Cancel</button>
                <button type="button" className="win98-button px-3 py-1 font-bold" onClick={() => void savePage()} disabled={saving || !title.trim()} data-testid="button-wiki-save">
                  {saving ? "Saving..." : "Save page"}
                </button>
              </div>
            </div>
          ) : page ? (
            <article className="p-4">
              <div className="flex flex-wrap items-start justify-between gap-2 border-b border-[#ccc] pb-2">
                <div>
                  <h1 className="text-xl font-bold text-[#000080]">{page.title}</h1>
                  <div className="mt-1 text-[10px] text-gray-500">Updated by {page.updatedBy} · {new Date(page.updatedAt).toLocaleString()}</div>
                </div>
                {canEdit && (
                  <div className="flex gap-1">
                    <button type="button" className="win98-button px-2 py-1" onClick={() => { setTitle(page.title); setContent(page.content); setEditing(true); }}>Edit</button>
                    <button type="button" className="win98-button px-2 py-1 text-[#800000]" onClick={() => void removePage()}>Delete</button>
                  </div>
                )}
              </div>
              <div className="wiki-markdown mt-3 break-words text-sm leading-6">
                <ReactMarkdown remarkPlugins={[remarkGfm]}>{page.content || "_This page is empty._"}</ReactMarkdown>
              </div>
              {assets.length > 0 && (
                <section className="mt-5 border-t border-[#ccc] pt-3">
                  <h2 className="mb-2 text-sm font-bold text-[#000080]">Media ({assets.length})</h2>
                  <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                    {assets.map((asset) => (
                      <div key={asset.id} className="win98-inset bg-[#f2f2f2] p-1">
                        {asset.contentType.startsWith("image/") ? (
                          <img src={mediaUrl(asset)} alt={asset.fileName} className="max-h-72 w-full bg-black object-contain" />
                        ) : (
                          <video src={mediaUrl(asset)} controls preload="metadata" className="max-h-72 w-full bg-black" />
                        )}
                        <div className="px-1 py-1 text-[10px] text-gray-700">{asset.fileName} · {formatBytes(asset.size)}</div>
                      </div>
                    ))}
                  </div>
                </section>
              )}
              <div className="mt-4 border-t border-[#ddd] pt-2 text-[10px] text-gray-500">
                Last updated {new Date(page.updatedAt).toLocaleString()} by {page.updatedBy}
              </div>
            </article>
          ) : selectedSummary ? (
            <div className="p-4 text-gray-600">Opening {selectedSummary.title}…</div>
          ) : (
            <div className="flex h-full min-h-[220px] flex-col items-center justify-center p-6 text-center">
              <div className="text-lg font-bold text-[#000080]">Welcome to the site wiki</div>
              <p className="mt-2 max-w-sm text-gray-600">Choose a page from the index to read community guides and references.</p>
              {pages.length === 0 && canEdit && <button type="button" className="win98-button mt-3 px-3 py-1" onClick={startNewPage}>Create the first page</button>}
            </div>
          )}
        </main>
      </div>
    </div>
  );
}


export function Current() {
  return <div className="h-screen w-full overflow-hidden"><WikiBrowserCurrent /></div>;
}
