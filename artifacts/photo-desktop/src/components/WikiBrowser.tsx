import { useEffect, useMemo, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import "./WikiBrowser.css";
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
} from "../lib/api";
import { hasPermission, useAuth } from "../lib/auth-store";

function mediaUrl(asset: WikiAsset) {
  return asset.url.startsWith("/") ? asset.url : `/${asset.url}`;
}

function formatBytes(value: number): string {
  if (value < 1024 * 1024) return `${Math.max(1, Math.round(value / 1024))} KB`;
  return `${(value / (1024 * 1024)).toFixed(1)} MB`;
}

export function WikiBrowser() {
  const user = useAuth((state) => state.user);
  const ranks = useAuth((state) => state.ranks);
  const refreshRanks = useAuth((state) => state.refreshRanks);
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
  const [opening, setOpening] = useState(false);
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
    setOpening(true);
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
    } finally {
      setOpening(false);
    }
  }

  useEffect(() => {
    void loadIndex();
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
    <div className="wiki-browser flex h-full min-h-0 flex-col text-xs" data-testid="wiki-browser">
      <header className="wiki-header shrink-0">
        <div className="wiki-brand">
          <div className="wiki-mark" aria-hidden="true"><span>W</span></div>
          <div className="min-w-0">
            <div className="wiki-kicker">Community reference desk</div>
            <div className="wiki-title">Site Wiki</div>
            <p className="wiki-subtitle">Guides, shared knowledge, and notes from the community.</p>
          </div>
        </div>
        <div className="wiki-header-actions">
          <span className="wiki-page-total" aria-live="polite">{pages.length} {pages.length === 1 ? "article" : "articles"}</span>
          {canEdit && (
            <button type="button" className="win98-button wiki-primary-action" onClick={startNewPage} data-testid="button-wiki-new-page">
              <span aria-hidden="true">+</span> New page
            </button>
          )}
        </div>
      </header>

      {(error || status) && (
        <div className="wiki-notices" aria-live="polite">
          {error && <div role="alert" className="wiki-alert"><span className="wiki-notice-mark" aria-hidden="true">!</span><span>{error}</span></div>}
          {status && <div role="status" className="wiki-status"><span className="wiki-notice-mark" aria-hidden="true">OK</span><span>{status}</span></div>}
        </div>
      )}

      <div className="wiki-workspace">
        <aside className="wiki-index" aria-label="Wiki page index">
          <div className="wiki-index-heading">
            <div>
              <div className="wiki-eyebrow">Browse the shelf</div>
              <h2>Page index</h2>
            </div>
            <span className="wiki-index-count">{pages.length.toString().padStart(2, "0")}</span>
          </div>
          <div className="wiki-page-list" aria-label="Pages">
            {loading ? (
              <div className="wiki-loading-list" aria-label="Loading wiki pages">
                {[0, 1, 2, 3].map((item) => <div className="wiki-skeleton" key={item}><i /><b /><span /></div>)}
              </div>
            ) : pages.length === 0 ? (
              <div className="wiki-index-empty">
                <span className="wiki-empty-symbol" aria-hidden="true">—</span>
                <strong>No pages on the shelf yet</strong>
                <span>{canEdit ? "Start a reference the whole community can use." : "Check back when a community guide is ready."}</span>
              </div>
            ) : pages.map((item, index) => (
              <button
                key={item.slug}
                type="button"
                onClick={() => void openPage(item.slug)}
                className={`wiki-page-link ${selectedSlug === item.slug ? "is-selected" : ""}`}
                aria-current={selectedSlug === item.slug ? "page" : undefined}
                data-testid={`wiki-page-${item.slug}`}
              >
                <span className="wiki-page-number">{String(index + 1).padStart(2, "0")}</span>
                <span className="wiki-page-link-copy">
                  <span className="wiki-page-name">{item.title}</span>
                  <span className="wiki-page-excerpt">{item.excerpt || "No description yet."}</span>
                </span>
                <span className="wiki-page-arrow" aria-hidden="true">›</span>
              </button>
            ))}
          </div>
          <div className="wiki-index-foot">
            <span className="wiki-index-note">Shared by members, kept for everyone.</span>
            <button type="button" className="win98-button wiki-refresh" onClick={() => void loadIndex()} disabled={loading} aria-label="Refresh page index">
              <span aria-hidden="true">↻</span> Refresh index
            </button>
          </div>
        </aside>

        <main className="wiki-reading-pane" aria-label="Wiki article">
          {editing ? (
            <section className="wiki-editor" aria-labelledby="wiki-editor-heading">
              <div className="wiki-editor-head">
                <div>
                  <div className="wiki-eyebrow">{isCreating ? "Add to the collection" : "Contributor tools"}</div>
                  <h1 id="wiki-editor-heading">{isCreating ? "Write a new page" : "Edit this page"}</h1>
                  <p>Clear titles and useful details make a good reference.</p>
                </div>
                <span className="wiki-editor-tag">Markdown</span>
              </div>
              <label className="wiki-field">
                <span>Page title</span>
                <input aria-label="Page title" className="wiki-title-input" value={title} maxLength={100} onChange={(event) => setTitle(event.target.value)} />
                <small>{title.length}/100 characters</small>
              </label>
              <label className="wiki-field wiki-content-field">
                <span>Article text <em>Markdown supported</em></span>
                <textarea
                  aria-label="Wiki text (Markdown)"
                  className="wiki-content-input"
                  value={content}
                  maxLength={100_000}
                  onChange={(event) => setContent(event.target.value)}
                  placeholder={"# Overview\n\nWrite a guide or reference here. Use Markdown for headings, links, lists, and tables."}
                />
                <small>{content.length.toLocaleString()} / 100,000 characters</small>
              </label>
              {page && (
                <section className="wiki-media-manage" aria-labelledby="wiki-media-manage-heading">
                  <div className="wiki-media-manage-head">
                    <div>
                      <h2 id="wiki-media-manage-heading">Page media</h2>
                      <p>Attach images or video to this reference.</p>
                    </div>
                    <button type="button" className="win98-button wiki-secondary-action" onClick={() => fileInput.current?.click()} data-testid="button-wiki-upload-media">
                      Add images/videos
                    </button>
                    <input ref={fileInput} className="hidden" type="file" accept="image/png,image/jpeg,image/gif,image/webp,video/mp4,video/webm" multiple onChange={(event) => void uploadFiles(event.target.files)} />
                  </div>
                  <div className="wiki-upload-help">PNG, JPEG, GIF, WebP, MP4, or WebM. Maximum 6 MB per file.</div>
                  {assets.length > 0 ? (
                    <ul className="wiki-asset-list">
                      {assets.map((asset) => (
                        <li key={asset.id}>
                          <span className="wiki-file-type" aria-hidden="true">{asset.contentType.startsWith("video/") ? "VID" : "IMG"}</span>
                          <span className="wiki-asset-name">{asset.fileName}<small>{formatBytes(asset.size)}</small></span>
                          <button type="button" className="wiki-remove-asset" onClick={() => void removeAsset(asset)} aria-label={`Remove ${asset.fileName}`}>Remove</button>
                        </li>
                      ))}
                    </ul>
                  ) : <div className="wiki-no-assets">No media attached to this page.</div>}
                </section>
              )}
              {!page && <p className="wiki-save-first">Save this page before attaching media.</p>}
              <div className="wiki-editor-actions">
                <button type="button" className="win98-button wiki-cancel-action" onClick={() => { setEditing(false); setIsCreating(false); if (selectedSlug) void openPage(selectedSlug); }} disabled={saving}>Cancel</button>
                <button type="button" className="win98-button wiki-save-action" onClick={() => void savePage()} disabled={saving || !title.trim()} data-testid="button-wiki-save">
                  {saving ? "Saving..." : "Save page"}
                </button>
              </div>
            </section>
          ) : page ? (
            <article className="wiki-article">
              <div className="wiki-article-heading">
                <div className="wiki-article-title-group">
                  <div className="wiki-eyebrow">Community guide</div>
                  <h1>{page.title}</h1>
                  <div className="wiki-byline"><span className="wiki-byline-dot" /> Updated by <strong>{page.updatedBy}</strong><span className="wiki-byline-sep">/</span>{new Date(page.updatedAt).toLocaleString()}</div>
                </div>
                {canEdit && (
                  <div className="wiki-article-actions">
                    <button type="button" className="win98-button wiki-secondary-action" onClick={() => { setTitle(page.title); setContent(page.content); setEditing(true); }}>Edit page</button>
                    <button type="button" className="win98-button wiki-delete-action" onClick={() => void removePage()}>Delete</button>
                  </div>
                )}
              </div>
              <div className="wiki-markdown break-words">
                <ReactMarkdown remarkPlugins={[remarkGfm]}>{page.content || "_This page is empty._"}</ReactMarkdown>
              </div>
              {assets.length > 0 && (
                <section className="wiki-article-media" aria-labelledby="wiki-media-heading">
                  <div className="wiki-section-heading">
                    <div>
                      <div className="wiki-eyebrow">Attachments</div>
                      <h2 id="wiki-media-heading">Media <span>{assets.length}</span></h2>
                    </div>
                  </div>
                  <div className="wiki-media-grid">
                    {assets.map((asset) => (
                      <figure key={asset.id} className="wiki-media-item">
                        {asset.contentType.startsWith("image/") ? (
                          <img src={mediaUrl(asset)} alt={asset.fileName} />
                        ) : (
                          <video src={mediaUrl(asset)} controls preload="metadata" aria-label={asset.fileName} />
                        )}
                        <figcaption><span>{asset.fileName}</span><small>{formatBytes(asset.size)}</small></figcaption>
                      </figure>
                    ))}
                  </div>
                </section>
              )}
              <footer className="wiki-article-foot">Last updated {new Date(page.updatedAt).toLocaleString()} by {page.updatedBy}</footer>
            </article>
          ) : opening && selectedSummary ? (
            <div className="wiki-opening" role="status" aria-live="polite">
              <div className="wiki-opening-rule" />
              <span className="wiki-eyebrow">Opening article</span>
              <h1>{selectedSummary.title}</h1>
              <div className="wiki-opening-lines"><i /><i /><i /></div>
            </div>
          ) : error ? (
            <div className="wiki-welcome wiki-error-state">
              <div className="wiki-welcome-mark" aria-hidden="true">!</div>
              <div className="wiki-eyebrow">Something went wrong</div>
              <h1>The shelf is still here.</h1>
              <p>Try loading the page index again, or choose an article to reopen it.</p>
              <button type="button" className="win98-button wiki-secondary-action" onClick={() => void loadIndex()} disabled={loading}>Try again</button>
            </div>
          ) : (
            <div className="wiki-welcome">
              <div className="wiki-welcome-mark" aria-hidden="true">W</div>
              <div className="wiki-eyebrow">{pages.length ? "A little knowledge goes a long way" : "A shared shelf for the community"}</div>
              <h1>{pages.length ? <>Find your<br /><span>next answer.</span></> : "Welcome to the site wiki."}</h1>
              <p>{pages.length ? "Choose an article from the index to read member-written guides, practical tips, and community references." : "This is the community’s home for helpful guides and shared know-how. When someone adds a page, it will be waiting here."}</p>
              <div className="wiki-welcome-rule" />
              {pages.length === 0 && canEdit && <button type="button" className="win98-button wiki-save-action" onClick={startNewPage}>Create the first page</button>}
              {pages.length > 0 && <span className="wiki-welcome-hint">Select a page from the index to begin <span aria-hidden="true">→</span></span>}
            </div>
          )}
        </main>
      </div>
    </div>
  );
}
