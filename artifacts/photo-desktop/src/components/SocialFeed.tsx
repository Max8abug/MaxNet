import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import {
  createSocialPost,
  deleteSocialPost,
  fetchSocialFeed,
  fetchSocialSearch,
  fetchLikedSocialPosts,
  fetchSocialNotifications,
  fetchSocialTrending,
  fetchNews,
  fetchSocialComments,
  createSocialComment,
  toggleSocialRepost,
  type SocialNotification,
  type TrendingTag,
  type NewsPost,
  fetchSocialProfile,
  migrateLegacyMyPage,
  toggleSocialFollow,
  toggleSocialPostLike,
  type SocialPost,
  type SocialProfile,
} from "../lib/api";
import { useAuth } from "../lib/auth-store";
import { Avatar } from "./Avatar";
import { useDesktopStore } from "../store";
import "./SocialFeed.css";

type SocialFeedProps = { username?: string };
type FeedMode = "for-you" | "following";
type FeedTheme = "light" | "dark";
type NetworkView = "for-you" | "following" | "search" | "notifications" | "liked" | "profile";
const MAX_MEDIA_BYTES = 6 * 1024 * 1024;
const MAX_BODY_LENGTH = 500;

function formatPostTime(value: string): string {
  const time = new Date(value);
  if (Number.isNaN(time.getTime())) return "Time unknown";
  const elapsed = Math.max(0, Date.now() - time.getTime());
  if (elapsed < 60_000) return "Just now";
  if (elapsed < 3_600_000) return `${Math.floor(elapsed / 60_000)}m ago`;
  if (elapsed < 86_400_000) return `${Math.floor(elapsed / 3_600_000)}h ago`;
  return new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric", year: time.getFullYear() !== new Date().getFullYear() ? "numeric" : undefined }).format(time);
}

function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => typeof reader.result === "string" ? resolve(reader.result) : reject(new Error("This file could not be read."));
    reader.onerror = () => reject(new Error("This file could not be read."));
    reader.readAsDataURL(file);
  });
}

function LoadingPosts() {
  return (
    <div className="social-loading-list" aria-label="Loading posts" data-testid="social-loading">
      {[0, 1, 2].map((item) => (
        <div className="social-skeleton" key={item} data-testid={`social-skeleton-${item}`}>
          <div className="social-skeleton-head"><span /><i /><b /></div>
          <div className="social-skeleton-line" />
          <div className="social-skeleton-line social-skeleton-line-short" />
        </div>
      ))}
    </div>
  );
}

function PostCard({
  post,
  currentUsername,
  busyLike,
  busyDelete,
  canDelete,
  onLike,
  onDelete,
  onOpenUser,
  onComment,
  onRepost,
  onFollow,
}: {
  post: SocialPost;
  currentUsername?: string;
  busyLike: boolean;
  busyDelete: boolean;
  canDelete: boolean;
  onLike: (post: SocialPost) => void;
  onDelete: (post: SocialPost) => void;
  onOpenUser: (username: string) => void;
  onComment: (post: SocialPost) => void;
  onRepost: (post: SocialPost) => void;
  onFollow: (username: string, isFollowing: boolean) => void;
}) {
  const mediaKind = post.mediaType?.toLowerCase().includes("video") || post.mediaUrl?.startsWith("data:video/") ? "video" : "image";
  return (
    <article className="social-post" data-testid={`social-post-${post.id}`}>
      {post.repostedBy && <div className="network-repost-note">↻ <b>{post.repostedBy}</b> reposted</div>}
      <header className="social-post-header">
        <Avatar username={post.author} size={38} />
        <div className="social-author-copy">
          <button
            type="button"
            onClick={() => onOpenUser(post.author)}
            aria-label={`Open ${post.author}'s profile to follow or view posts`}
            title={`Open ${post.author}'s profile`}
            data-testid={`social-post-author-${post.id}`}
          >
            {post.author}
          </button>
          {currentUsername && currentUsername !== post.author && <button type="button" className="network-inline-follow" onClick={() => onFollow(post.author, post.authorFollowed)} data-testid={`button-follow-${post.id}`}>{post.authorFollowed ? "Following" : "Follow"}</button>}
          <time dateTime={post.createdAt} data-testid={`social-post-time-${post.id}`}>{formatPostTime(post.createdAt)}</time>
        </div>
        {canDelete && (
          <button
            type="button"
            className="social-delete"
            onClick={() => onDelete(post)}
            disabled={busyDelete}
            aria-label={`Delete post by ${post.author}`}
            title={busyDelete ? "Deleting post" : "Delete post"}
            data-testid={`button-delete-social-post-${post.id}`}
          >
            {busyDelete ? "…" : "Delete"}
          </button>
        )}
      </header>
      {post.body && <p className="social-post-body" data-testid={`social-post-body-${post.id}`}>{post.body}</p>}
      {post.mediaUrl && (
        <div className="social-post-media" data-testid={`social-post-media-${post.id}`}>
          {mediaKind === "video" ? (
            <video src={post.mediaUrl} controls preload="metadata" aria-label={`Video posted by ${post.author}`} />
          ) : (
            <img src={post.mediaUrl} alt={`Posted by ${post.author}`} />
          )}
        </div>
      )}
      <footer className="social-post-footer">
        <span className="social-post-stamp">{currentUsername === post.author ? "Your update" : "Community post"}</span>
        <button
          type="button"
          className={`social-like ${post.myLike ? "is-liked" : ""}`}
          onClick={() => onLike(post)}
          disabled={busyLike || !currentUsername}
          aria-pressed={post.myLike}
          aria-label={`${post.myLike ? "Unlike" : "Like"} post by ${post.author}; ${post.likes} likes`}
          title={currentUsername ? (post.myLike ? "Remove your like" : "Like this post") : "Sign in to like posts"}
          data-testid={`button-like-social-post-${post.id}`}
        >
          <span aria-hidden="true" className="social-like-mark">{post.myLike ? "♥" : "♡"}</span>
          <span>{post.likes}</span>
        </button>
        <button type="button" className="network-action" onClick={() => onComment(post)} data-testid={`button-comment-${post.id}`}>Comment · {post.comments}</button>
        <button type="button" className={`network-action ${post.myRepost ? "is-active" : ""}`} disabled={!currentUsername} onClick={() => onRepost(post)} data-testid={`button-repost-${post.id}`}>{post.myRepost ? "Reposted" : "Repost"} · {post.reposts}</button>
      </footer>
    </article>
  );
}

export function SocialFeed({ username }: SocialFeedProps) {
  const me = useAuth((state) => state.user);
  const signedInUsername = me?.username;
  const [mode, setMode] = useState<FeedMode>("for-you");
  const [view, setView] = useState<NetworkView>("for-you");
  const [searchQuery, setSearchQuery] = useState("");
  const [notifications, setNotifications] = useState<SocialNotification[]>([]);
  const [trending, setTrending] = useState<TrendingTag[]>([]);
  const [siteNews, setSiteNews] = useState<NewsPost[]>([]);
  const [networkNews, setNetworkNews] = useState<SocialPost[]>([]);
  const [newestAvailable, setNewestAvailable] = useState(false);
  const postsRef = useRef<SocialPost[]>([]);
  const [theme, setTheme] = useState<FeedTheme>(() => {
    try {
      return localStorage.getItem("photo-desktop-social-theme") === "dark" ? "dark" : "light";
    } catch {
      return "light";
    }
  });
  const [posts, setPosts] = useState<SocialPost[]>([]);
  const [profile, setProfile] = useState<SocialProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [body, setBody] = useState("");
  const [mediaFile, setMediaFile] = useState<File | null>(null);
  const [mediaPreview, setMediaPreview] = useState<string | null>(null);
  const [validation, setValidation] = useState<string | null>(null);
  const [posting, setPosting] = useState(false);
  const [followingBusy, setFollowingBusy] = useState(false);
  const [busyLikes, setBusyLikes] = useState<number[]>([]);
  const [busyDeletes, setBusyDeletes] = useState<number[]>([]);
  const [actionError, setActionError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const addWindow = useDesktopStore((state) => state.addWindow);
  const activePage = useDesktopStore((state) => state.activePage);

  useEffect(() => {
    try { localStorage.setItem("photo-desktop-social-theme", theme); } catch { /* Use the current session preference. */ }
    window.dispatchEvent(new CustomEvent("photo-desktop-social-theme-change", { detail: theme }));
  }, [theme]);

  const load = useCallback(async (selectedMode: FeedMode = mode) => {
    setLoading(true);
    setError(null);
    try {
      const profileName = username || (view === "profile" ? signedInUsername : undefined);
      if (view === "notifications") {
        setNotifications(await fetchSocialNotifications());
        setPosts([]);
      } else if (view === "search") {
        setPosts(searchQuery.trim() ? await fetchSocialSearch(searchQuery.trim()) : []);
        setProfile(null);
      } else if (view === "liked") {
        setPosts(await fetchLikedSocialPosts());
        setProfile(null);
      } else if (profileName) {
        if (signedInUsername === profileName) {
          try { await migrateLegacyMyPage(); } catch { /* Retry on the next profile refresh. */ }
        }
        const result = await fetchSocialProfile(profileName);
        setProfile(result || null);
        setPosts(result?.posts || []);
      } else {
        if (signedInUsername) {
          try { await migrateLegacyMyPage(); } catch { /* Retry on the next feed refresh. */ }
        }
        setProfile(null);
        setPosts(await fetchSocialFeed(selectedMode));
      }
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "The social feed could not be loaded.");
    } finally {
      setLoading(false);
    }
  }, [signedInUsername, mode, username, view, searchQuery]);

  useEffect(() => {
    void load();
  }, [load]);
  useEffect(() => { postsRef.current = posts; }, [posts]);
  useEffect(() => {
    if (username || (view !== "for-you" && view !== "following")) return;
    const checkForNewPosts = async () => {
      if (document.visibilityState !== "visible") return;
      try {
        const latest = await fetchSocialFeed(view === "following" ? "following" : "for-you");
        const existingIds = new Set(postsRef.current.map((post) => post.id));
        if (latest.some((post) => !existingIds.has(post.id))) setNewestAvailable(true);
      } catch { /* Keep the current feed usable if a background check fails. */ }
    };
    const timer = window.setInterval(() => void checkForNewPosts(), 2 * 60 * 1000);
    return () => window.clearInterval(timer);
  }, [username, view]);
  useEffect(() => {
    void Promise.all([fetchSocialTrending(), fetchNews(), fetchSocialFeed("for-you")]).then(([tags, news, latest]) => {
      setTrending(tags); setSiteNews(news.slice(0, 4)); setNetworkNews(latest.slice(0, 4));
    }).catch(() => { setTrending([]); setSiteNews([]); });
  }, []);

  useEffect(() => () => {
    if (mediaPreview) URL.revokeObjectURL(mediaPreview);
  }, [mediaPreview]);

  const selectMode = (nextMode: FeedMode) => {
    setMode(nextMode);
    setView(nextMode);
    setNewestAvailable(false);
  };
  const loadNewestPosts = async () => {
    await load(mode);
    setNewestAvailable(false);
  };

  const chooseMedia = (file?: File) => {
    setValidation(null);
    if (!file) return;
    if (!file.type.startsWith("image/") && !file.type.startsWith("video/")) {
      setValidation("Choose an image or video file.");
      return;
    }
    if (file.size > MAX_MEDIA_BYTES) {
      setValidation("Media must be 6 MiB or smaller.");
      return;
    }
    if (mediaPreview) URL.revokeObjectURL(mediaPreview);
    setMediaFile(file);
    setMediaPreview(URL.createObjectURL(file));
  };

  const clearMedia = () => {
    if (mediaPreview) URL.revokeObjectURL(mediaPreview);
    setMediaFile(null);
    setMediaPreview(null);
    if (fileRef.current) fileRef.current.value = "";
  };

  const submitPost = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const trimmedBody = body.trim();
    if (!trimmedBody && !mediaFile) {
      setValidation("Write an update or attach an image or video first.");
      return;
    }
    if (mediaFile && mediaFile.size > MAX_MEDIA_BYTES) {
      setValidation("Media must be 6 MiB or smaller.");
      return;
    }
    setPosting(true);
    setActionError(null);
    setValidation(null);
    try {
      const mediaDataUrl = mediaFile ? await readFileAsDataUrl(mediaFile) : undefined;
      const created = await createSocialPost(trimmedBody, mediaDataUrl);
      setPosts((current) => [created, ...current]);
      setProfile((current) => current ? { ...current, posts: [created, ...current.posts] } : current);
      setBody("");
      clearMedia();
    } catch (postError) {
      setActionError(postError instanceof Error ? postError.message : "Your update could not be posted.");
    } finally {
      setPosting(false);
    }
  };

  const toggleLike = async (post: SocialPost) => {
    if (!me || busyLikes.includes(post.id)) return;
    setBusyLikes((current) => [...current, post.id]);
    setActionError(null);
    try {
      await toggleSocialPostLike(post.id);
      setPosts((current) => current.map((item) => item.id === post.id ? {
        ...item,
        likes: Math.max(0, item.likes + (item.myLike ? -1 : 1)),
        myLike: !item.myLike,
      } : item));
      setProfile((current) => current ? {
        ...current,
        posts: current.posts.map((item) => item.id === post.id ? {
          ...item,
          likes: Math.max(0, item.likes + (item.myLike ? -1 : 1)),
          myLike: !item.myLike,
        } : item),
      } : current);
    } catch (likeError) {
      setActionError(likeError instanceof Error ? likeError.message : "That like could not be saved.");
    } finally {
      setBusyLikes((current) => current.filter((id) => id !== post.id));
    }
  };

  const deletePost = async (post: SocialPost) => {
    if (!window.confirm("Delete this post? This cannot be undone.")) return;
    setBusyDeletes((current) => [...current, post.id]);
    setActionError(null);
    try {
      await deleteSocialPost(post.id);
      setPosts((current) => current.filter((item) => item.id !== post.id));
      setProfile((current) => current ? { ...current, posts: current.posts.filter((item) => item.id !== post.id) } : current);
    } catch (deleteError) {
      setActionError(deleteError instanceof Error ? deleteError.message : "This post could not be deleted.");
    } finally {
      setBusyDeletes((current) => current.filter((id) => id !== post.id));
    }
  };

  const toggleFollow = async () => {
    if (!profile || !me || followingBusy) return;
    const shouldFollow = !profile.isFollowing;
    setFollowingBusy(true);
    setActionError(null);
    try {
      await toggleSocialFollow(username!, shouldFollow);
      setProfile((current) => current ? {
        ...current,
        isFollowing: shouldFollow,
        followers: Math.max(0, current.followers + (shouldFollow ? 1 : -1)),
      } : current);
    } catch (followError) {
      setActionError(followError instanceof Error ? followError.message : "Your follow setting could not be changed.");
    } finally {
      setFollowingBusy(false);
    }
  };

  const addComment = async (post: SocialPost) => {
    if (!me) return;
    const current = await fetchSocialComments(post.id).catch(() => []);
    const recent = current.slice(0, 5).map((comment) => `${comment.author}: ${comment.body}`).join("\n");
    const body = window.prompt(`${recent ? `Recent comments:\n${recent}\n\n` : "No comments yet.\n\n"}Write a comment (up to 500 characters):`)?.trim();
    if (!body) return;
    try { await createSocialComment(post.id, body.slice(0, 500)); await load(); }
    catch (error) { setActionError(error instanceof Error ? error.message : "Comment could not be posted."); }
  };
  const repost = async (post: SocialPost) => {
    if (!me) return;
    try { await toggleSocialRepost(post.id); await load(); }
    catch (error) { setActionError(error instanceof Error ? error.message : "Repost could not be saved."); }
  };
  const followAuthor = async (author: string, isFollowing: boolean) => {
    if (!me || me.username === author) return;
    try { await toggleSocialFollow(author, !isFollowing); await load(); }
    catch (error) { setActionError(error instanceof Error ? error.message : "Follow could not be saved."); }
  };

  const canDelete = (post: SocialPost) => !!me && (me.username === post.author || me.isAdmin);
  const profileUsername = username || (view === "profile" ? me?.username : undefined);
  const isOwner = !!me && me.username === profileUsername;
  const isProfile = !!profileUsername;

  return (
    <section className="social-feed" data-theme={theme} data-testid={isProfile ? "social-profile" : "social-feed"}>
      <div className="network-shell">
      <aside className="network-left" aria-label="Network navigation">
        <div className="network-brand"><span className="network-brand-mark">N</span><strong>the Network</strong></div>
        <form className="network-search" onSubmit={(event) => { event.preventDefault(); setView("search"); }}>
          <input value={searchQuery} onChange={(event) => setSearchQuery(event.target.value)} placeholder="Search posts" aria-label="Search posts" data-testid="input-network-search" />
          <button type="submit" aria-label="Submit post search" data-testid="button-network-search">⌕</button>
        </form>
        {([
          ["for-you", "⌂", "Home"],
          ["following", "◎", "Following"],
          ["notifications", "♧", "Notifications"],
          ["liked", "♥", "Liked posts"],
          ["profile", "◉", "Profile"],
        ] as const).map(([key, icon, label]) => (
          <button key={key} type="button" className={`network-nav-item ${view === key ? "is-active" : ""}`} onClick={() => { setView(key); if (key === "for-you" || key === "following") setMode(key); }} data-testid={`button-network-${key}`}>
            <span aria-hidden="true">{icon}</span>{label}
          </button>
        ))}
        <div className="network-left-bottom">
          <span>{me ? `Signed in as ${me.username}` : "Sign in to post, follow, and like."}</span>
          <button type="button" onClick={() => setTheme(theme === "dark" ? "light" : "dark")} data-testid="button-network-theme">Switch to {theme === "dark" ? "light" : "dark"} mode</button>
        </div>
      </aside>
      <main className="network-main">
      <div className="social-theme-toolbar" role="group" aria-label="Social feed appearance">
        <span>APPEARANCE</span>
        <button type="button" className={theme === "light" ? "is-active" : ""} onClick={() => setTheme("light")} aria-pressed={theme === "light"} data-testid="button-social-theme-light">Light</button>
        <button type="button" className={theme === "dark" ? "is-active" : ""} onClick={() => setTheme("dark")} aria-pressed={theme === "dark"} data-testid="button-social-theme-dark">Dark</button>
      </div>
      {isProfile ? (
        <div className="social-profile-banner" data-testid="social-profile-header">
          <div className="social-profile-identity">
            {profile?.avatarUrl ? <img className="social-profile-avatar" src={profile.avatarUrl} alt={`${profileUsername} avatar`} /> : <Avatar username={profileUsername!} size={54} />}
            <div className="social-profile-name">
              <span className="social-eyebrow">MEMBER PROFILE</span>
              <h2 data-testid="social-profile-username">{profile?.username || profileUsername}</h2>
              {profile?.rank && <span className="social-profile-rank" data-testid="social-profile-rank">{profile.rank}</span>}
              {profile?.bio && <p className="social-profile-bio" data-testid="social-profile-bio">{profile.bio}</p>}
            </div>
          </div>
          <div className="social-profile-stats" data-testid="social-profile-stats">
            <span><b>{profile?.followers ?? "—"}</b> followers</span>
            <span><b>{profile?.following ?? "—"}</b> following</span>
          </div>
          {!isOwner && me && profile && (
            <button
              className={`social-follow-button ${profile.isFollowing ? "is-following" : ""}`}
              type="button"
              onClick={() => void toggleFollow()}
              disabled={followingBusy}
              data-testid="button-social-follow"
            >
              {followingBusy ? "Saving…" : profile.isFollowing ? "Following" : "Follow"}
            </button>
          )}
        </div>
      ) : (
        <>
          <header className="social-feed-heading">
            <div>
              <span className="social-eyebrow">THE COMMUNITY WIRE</span>
              <h1 data-testid="social-feed-title">{view === "following" ? "Following" : view === "liked" ? "Liked posts" : view === "search" ? "Search results" : view === "notifications" ? "Notifications" : view === "profile" ? "Your profile" : "For you"}</h1>
              <p>Posts from people you follow, plus popular and recent finds from everyone.</p>
            </div>
            <div className="social-feed-index" aria-hidden="true"><b>01</b><span> / LIVE</span></div>
          </header>
          <nav className="social-feed-tabs" aria-label="Feed selection" data-testid="social-feed-tabs">
            <button type="button" className={view === "for-you" ? "is-active" : ""} onClick={() => selectMode("for-you")} data-testid="button-feed-for-you">For You</button>
            <button type="button" className={view === "following" ? "is-active" : ""} onClick={() => selectMode("following")} data-testid="button-feed-following">Following</button>
            <span className="social-tab-note">SITE-WIDE / NEW & NOTABLE</span>
          </nav>
        </>
      )}

      {isProfile && profile && !isOwner && !me && (
        <div className="social-signin-note" data-testid="social-signin-note">Sign in to follow members and leave a like.</div>
      )}

      {!isProfile && me && (
        <form className="social-composer" onSubmit={submitPost} data-testid="social-composer">
          <div className="social-composer-top">
            <Avatar username={me.username} size={38} />
            <label className="social-compose-label" htmlFor="social-compose-body">
              <span className="social-compose-prompt">What’s happening on your side?</span>
              <textarea
                id="social-compose-body"
                value={body}
                onChange={(event) => { setBody(event.target.value.slice(0, MAX_BODY_LENGTH)); setValidation(null); }}
                placeholder="A thought, a discovery, a tiny update…"
                maxLength={MAX_BODY_LENGTH}
                rows={3}
                data-testid="input-social-compose"
              />
            </label>
          </div>
          {mediaPreview && (
            <div className="social-compose-preview" data-testid="social-compose-preview">
              {mediaFile?.type.startsWith("video/") ? <video src={mediaPreview} controls aria-label="Selected video preview" /> : <img src={mediaPreview} alt="Selected image preview" />}
              <button type="button" onClick={clearMedia} aria-label="Remove attached media" data-testid="button-remove-social-media">Remove media</button>
            </div>
          )}
          {(validation || actionError) && <div className="social-inline-error" role="alert" data-testid="status-social-compose-error">{validation || actionError}</div>}
          <div className="social-composer-actions">
            <div className="social-composer-tools">
              <label className="social-attach-button" htmlFor="social-media-file" data-testid="label-social-media">
                <span aria-hidden="true" className="social-attach-symbol">+</span>
                <span>Attach media</span>
              </label>
              <input
                ref={fileRef}
                id="social-media-file"
                className="social-file-input"
                type="file"
                accept="image/*,video/*"
                onChange={(event) => { chooseMedia(event.currentTarget.files?.[0]); event.currentTarget.value = ""; }}
                aria-label="Choose an image or video, up to 6 MiB"
                data-testid="input-social-media"
              />
              <span className="social-compose-hint">{mediaFile ? `${(mediaFile.size / (1024 * 1024)).toFixed(1)} MiB selected` : `${MAX_BODY_LENGTH - body.length} characters left`}</span>
            </div>
            <button className="social-publish-button" type="submit" disabled={posting} data-testid="button-social-publish">
              {posting ? "Posting…" : "Post update"}
              <span aria-hidden="true">↗</span>
            </button>
          </div>
        </form>
      )}

      {isProfile && actionError && <div className="social-inline-error social-action-error" role="alert" data-testid="status-social-action-error">{actionError}</div>}
      {!isProfile && actionError && me && <div className="social-inline-error social-action-error" role="alert" data-testid="status-social-action-error">{actionError}</div>}

      {newestAvailable && (view === "for-you" || view === "following") && (
        <div className="network-new-posts-wrap" role="status" aria-live="polite">
          <button type="button" className="network-new-posts" onClick={() => void loadNewestPosts()} data-testid="button-load-newest-posts">
            <span aria-hidden="true">↓</span> Load newest posts
          </button>
        </div>
      )}
      <div className="social-timeline" data-testid="social-post-list">
        {loading ? <LoadingPosts /> : error ? (
          <div className="social-state social-state-error" role="alert" data-testid="status-social-error">
            <span className="social-state-mark" aria-hidden="true">!</span>
            <strong>Could not open the wire.</strong>
            <p>{error}</p>
            <button type="button" onClick={() => void load()} data-testid="button-social-retry">Try again</button>
          </div>
        ) : view === "notifications" ? notifications.length === 0 ? <div className="social-state">You’re all caught up.</div> : notifications.map((item) => <div className="network-notification" key={item.id}><b>{item.actor}</b> {item.kind === "follow" ? "followed you" : item.kind === "like" ? "liked your post" : item.kind === "comment" ? "commented on your post" : "reposted your post"}<time>{formatPostTime(item.createdAt)}</time></div>) : posts.length === 0 ? (
          <div className="social-state" data-testid="status-social-empty">
            <span className="social-state-mark" aria-hidden="true">—</span>
            <strong>{isProfile ? "No updates here yet." : mode === "following" ? "Your following feed is quiet." : "The wire is quiet for now."}</strong>
            <p>{isProfile ? "When this member posts, it will show up here." : mode === "following" ? "Follow a few members and their new posts will land here." : "Start the conversation with a small update."}</p>
          </div>
        ) : posts.map((post) => (
          <PostCard
            key={post.id}
            post={post}
            currentUsername={me?.username}
            busyLike={busyLikes.includes(post.id)}
            busyDelete={busyDeletes.includes(post.id)}
            canDelete={canDelete(post)}
            onLike={(item) => void toggleLike(item)}
            onDelete={(item) => void deletePost(item)}
            onOpenUser={(author) => addWindow(activePage, { type: "userpage", title: `${author}'s posts`, username: author, width: 520, height: 460 })}
            onComment={(item) => void addComment(item)}
            onRepost={(item) => void repost(item)}
            onFollow={(author, followed) => void followAuthor(author, followed)}
          />
        ))}
      </div>
      <footer className="social-feed-footnote" data-testid="social-feed-footnote">
        <span>PHOTO DESKTOP SOCIAL</span>
        <span>{isProfile ? `POSTS BY ${profileUsername?.toUpperCase()}` : view.toUpperCase()}</span>
      </footer>
      </main>
      <aside className="network-right" aria-label="Network news and trends">
        <section className="network-side-card"><h2>Site news</h2>{siteNews.length ? siteNews.map((news) => <article key={news.id}><b>{news.title}</b><small>{news.author} · {formatPostTime(news.createdAt)}</small></article>) : <p>No recent site news.</p>}</section>
        <section className="network-side-card"><h2>Network news</h2>{networkNews.map((post) => <article key={post.id}><b>@{post.author}</b><small>{post.body.slice(0, 90) || "Shared media"} · {formatPostTime(post.createdAt)}</small></article>)}</section>
        <section className="network-side-card"><h2>Trending this week</h2>{trending.length ? trending.map((tag) => <button key={tag.tag} type="button" onClick={() => { setSearchQuery(tag.tag); setView("search"); }} data-testid={`button-trending-${tag.tag.slice(1)}`}><b>{tag.tag}</b><small>{tag.count} posts</small></button>) : <p>No hashtags have reached the trend threshold yet.</p>}</section>
      </aside>
      </div>
    </section>
  );
}
