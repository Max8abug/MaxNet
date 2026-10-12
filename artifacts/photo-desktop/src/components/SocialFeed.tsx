import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import {
  createSocialPost,
  deleteSocialPost,
  fetchSocialFeed,
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
}: {
  post: SocialPost;
  currentUsername?: string;
  busyLike: boolean;
  busyDelete: boolean;
  canDelete: boolean;
  onLike: (post: SocialPost) => void;
  onDelete: (post: SocialPost) => void;
  onOpenUser: (username: string) => void;
}) {
  const mediaKind = post.mediaType?.toLowerCase().includes("video") || post.mediaUrl?.startsWith("data:video/") ? "video" : "image";
  return (
    <article className="social-post" data-testid={`social-post-${post.id}`}>
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
      </footer>
    </article>
  );
}

export function SocialFeed({ username }: SocialFeedProps) {
  const me = useAuth((state) => state.user);
  const [mode, setMode] = useState<FeedMode>("for-you");
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
  }, [theme]);

  const load = useCallback(async (selectedMode: FeedMode = mode) => {
    setLoading(true);
    setError(null);
    try {
      if (username) {
        if (me?.username === username) {
          try { await migrateLegacyMyPage(); } catch { /* Retry on the next profile refresh. */ }
        }
        const result = await fetchSocialProfile(username);
        setProfile(result || null);
        setPosts(result?.posts || []);
      } else {
        if (me) {
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
  }, [me, mode, username]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => () => {
    if (mediaPreview) URL.revokeObjectURL(mediaPreview);
  }, [mediaPreview]);

  const selectMode = (nextMode: FeedMode) => {
    setMode(nextMode);
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

  const canDelete = (post: SocialPost) => !!me && (me.username === post.author || me.isAdmin);
  const isOwner = !!me && me.username === username;
  const isProfile = !!username;

  return (
    <section className="social-feed" data-theme={theme} data-testid={isProfile ? "social-profile" : "social-feed"}>
      <div className="social-theme-toolbar" role="group" aria-label="Social feed appearance">
        <span>APPEARANCE</span>
        <button type="button" className={theme === "light" ? "is-active" : ""} onClick={() => setTheme("light")} aria-pressed={theme === "light"} data-testid="button-social-theme-light">Light</button>
        <button type="button" className={theme === "dark" ? "is-active" : ""} onClick={() => setTheme("dark")} aria-pressed={theme === "dark"} data-testid="button-social-theme-dark">Dark</button>
      </div>
      {isProfile ? (
        <div className="social-profile-banner" data-testid="social-profile-header">
          <div className="social-profile-identity">
            {profile?.avatarUrl ? <img className="social-profile-avatar" src={profile.avatarUrl} alt={`${username} avatar`} /> : <Avatar username={username} size={54} />}
            <div className="social-profile-name">
              <span className="social-eyebrow">MEMBER PROFILE</span>
              <h2 data-testid="social-profile-username">{profile?.username || username}</h2>
              {profile?.rank && <span className="social-profile-rank" data-testid="social-profile-rank">{profile.rank}</span>}
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
              <h1 data-testid="social-feed-title">A little corner of the web.</h1>
              <p>Posts from people you follow, plus popular and recent finds from everyone.</p>
            </div>
            <div className="social-feed-index" aria-hidden="true"><b>01</b><span> / LIVE</span></div>
          </header>
          <nav className="social-feed-tabs" aria-label="Feed selection" data-testid="social-feed-tabs">
            <button type="button" className={mode === "for-you" ? "is-active" : ""} onClick={() => selectMode("for-you")} data-testid="button-feed-for-you">For You</button>
            <button type="button" className={mode === "following" ? "is-active" : ""} onClick={() => selectMode("following")} data-testid="button-feed-following">Following</button>
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

      <div className="social-timeline" data-testid="social-post-list">
        {loading ? <LoadingPosts /> : error ? (
          <div className="social-state social-state-error" role="alert" data-testid="status-social-error">
            <span className="social-state-mark" aria-hidden="true">!</span>
            <strong>Could not open the wire.</strong>
            <p>{error}</p>
            <button type="button" onClick={() => void load()} data-testid="button-social-retry">Try again</button>
          </div>
        ) : posts.length === 0 ? (
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
          />
        ))}
      </div>
      <footer className="social-feed-footnote" data-testid="social-feed-footnote">
        <span>PHOTO DESKTOP SOCIAL</span>
        <span>{isProfile ? `POSTS BY ${username?.toUpperCase()}` : mode === "following" ? "YOUR PEOPLE" : "FOR YOU"}</span>
      </footer>
    </section>
  );
}
