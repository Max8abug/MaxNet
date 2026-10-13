import { useCallback, useEffect, useMemo, useState } from "react";
import { fetchUsers, voteUserPage, type PublicUser } from "../lib/api";
import { useAuth } from "../lib/auth-store";
import { useDesktopStore } from "../store";
import { Avatar } from "./Avatar";
import { WikiBrowser } from "./WikiBrowser";
import { SocialFeed } from "./SocialFeed";
import "./UserBrowser.css";

type UserBrowserProps = {
  page?: string;
};

function displayActivity(lastSeen: string | null | undefined): string {
  if (!lastSeen) return "No recent activity";

  const timestamp = new Date(lastSeen).getTime();
  if (Number.isNaN(timestamp)) return "Activity unknown";

  const minutes = Math.max(0, Math.floor((Date.now() - timestamp) / 60_000));
  if (minutes < 2) return "Active just now";
  if (minutes < 60) return `Active ${minutes} minutes ago`;

  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `Active ${hours} hours ago`;

  const days = Math.floor(hours / 24);
  if (days === 1) return "Active yesterday";
  if (days < 30) return `Active ${days} days ago`;

  return `Last visited ${new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
  }).format(new Date(timestamp))}`;
}

function UserCard({
  user,
  onOpen,
  onVote,
  canVote,
}: {
  user: PublicUser;
  onOpen: (username: string) => void;
  onVote: (username: string, vote: boolean) => void;
  canVote: boolean;
}) {
  const hasPersonalContent = !!user.hasPage || !!user.hasHostedSite;
  return (
    <div
      role="button"
      tabIndex={0}
      className="group flex min-h-[158px] w-full flex-col text-left"
      onClick={() => onOpen(user.username)}
      onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); onOpen(user.username); } }}
      data-testid={`card-user-${user.username}`}
      title={`Open ${user.username}'s personal page`}
    >
      <span className="people-directory-card flex h-full w-full flex-col overflow-hidden rounded-xl border border-[#dce3e7] bg-white shadow-[0_2px_8px_rgba(35,59,76,.05)] transition duration-150 group-hover:-translate-y-0.5 group-hover:border-[#a9c9ca] group-hover:shadow-[0_8px_20px_rgba(35,59,76,.1)]">
        <span className="people-directory-card-head flex items-center gap-3 bg-[#f7faf9] px-3 py-3">
          <span className="relative shrink-0">
            <Avatar username={user.username} size={44} />
            <span className={`absolute -bottom-0.5 -right-0.5 h-3 w-3 rounded-full border-2 border-white ${
              user.lastSeen ? "bg-[#35a878]" : "bg-[#aab3b8]"
            }`} title={user.lastSeen ? "Has recent activity" : "No recent activity"} />
          </span>
          <span className="min-w-0 flex-1">
            <span
              className={`people-directory-user-name block truncate text-sm font-bold ${user.isAdmin ? "is-admin text-[#9b3944]" : "text-[#203844]"}`}
              data-testid={`text-username-${user.username}`}
            >
              {user.username}
            </span>
            <span className="people-directory-rank mt-0.5 block truncate text-[10px] text-[#70818a]">
              {user.isAdmin ? "Site administrator" : user.rank || "Directory member"}
            </span>
          </span>
          <span className="text-[#9aabb2]" aria-hidden="true">↗</span>
        </span>
        <span className="flex min-h-0 flex-1 flex-col justify-between px-3 py-2.5 text-[10px]">
          <span className="people-directory-activity text-[#76868d]">{hasPersonalContent ? displayActivity(user.lastSeen) : "No personal page yet"}</span>
          <span className="mt-2 flex items-center justify-between gap-2 border-t border-[#edf0f1] pt-2">
            <span className="people-directory-profile-link text-[11px] font-semibold text-[#287078] group-hover:underline">
              {hasPersonalContent ? "Open personal page →" : "View profile →"}
            </span>
            <span className="flex shrink-0 items-center gap-1.5">
            {user.hasHostedSite && <span className="people-directory-site-badge rounded-full bg-[#e8f2ef] px-2 py-1 text-[9px] font-semibold text-[#42776a]">HTML site</span>}
            {user.hasPage && (
              <button
                type="button"
                className={`people-directory-vote rounded-full border border-[#d9e2e5] px-2.5 py-1 text-[10px] font-semibold text-[#375f65] hover:bg-[#eaf4f1] ${user.myVote ? "bg-[#dcefeb]" : "bg-[#f7faf9]"}`}
                disabled={!canVote}
                onClick={(event) => {
                  event.stopPropagation();
                  if (canVote) onVote(user.username, !user.myVote);
                }}
                title={canVote ? (user.myVote ? "Remove your upvote" : "Upvote this page") : "Log in to upvote"}
              >
                ▲ {user.upvotes || 0}
              </button>
            )}
            </span>
          </span>
        </span>
      </span>
    </div>
  );
}

function LoadingCard({ index }: { index: number }) {
  return (
    <div
      className="min-h-[158px] w-full animate-pulse rounded-xl border border-[#dce3e7] bg-white p-3 shadow-[0_2px_8px_rgba(35,59,76,.05)]"
      data-testid={`skeleton-user-${index}`}
      aria-label="Loading user"
    >
      <div className="flex items-center gap-3 border-b border-[#edf0f1] bg-[#f7faf9] px-1 py-1.5">
        <div className="h-11 w-11 shrink-0 rounded-full bg-[#e5ecea]" />
        <div className="flex-1 space-y-1">
          <div className="h-3 w-3/5 rounded bg-[#e3eae8]" />
          <div className="h-2 w-2/5 rounded bg-[#edf1f0]" />
        </div>
      </div>
      <div className="space-y-2 px-1.5 py-3">
        <div className="h-2 w-4/5 rounded bg-[#e8eeec]" />
        <div className="h-2 w-2/5 rounded bg-[#eef2f1]" />
      </div>
    </div>
  );
}

export function UserBrowser({ page = "/" }: UserBrowserProps) {
  const [users, setUsers] = useState<PublicUser[]>([]);
  const [query, setQuery] = useState("");
  const [sortMode, setSortMode] = useState<"popular" | "alphabetical">("popular");
  const [activeView, setActiveView] = useState<"feed" | "people" | "wiki">("feed");
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [voting, setVoting] = useState<string | null>(null);
  const [directoryTheme, setDirectoryTheme] = useState<"light" | "dark">(() => {
    try {
      return localStorage.getItem("photo-desktop-social-theme") === "dark" ? "dark" : "light";
    } catch {
      return "light";
    }
  });
  const me = useAuth((state) => state.user);
  const addWindow = useDesktopStore((state) => state.addWindow);

  useEffect(() => {
    const onThemeChange = (event: Event) => {
      const nextTheme = (event as CustomEvent<unknown>).detail;
      if (nextTheme === "light" || nextTheme === "dark") setDirectoryTheme(nextTheme);
    };
    const onStorage = (event: StorageEvent) => {
      if (event.key === "photo-desktop-social-theme") {
        setDirectoryTheme(event.newValue === "dark" ? "dark" : "light");
      }
    };
    window.addEventListener("photo-desktop-social-theme-change", onThemeChange);
    window.addEventListener("storage", onStorage);
    return () => {
      window.removeEventListener("photo-desktop-social-theme-change", onThemeChange);
      window.removeEventListener("storage", onStorage);
    };
  }, []);

  const loadUsers = useCallback(async (isRefresh = false) => {
    if (isRefresh) setRefreshing(true);
    else setLoading(true);
    setError(null);

    try {
      setUsers(await fetchUsers());
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "The directory could not be loaded.");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    void loadUsers();
  }, [loadUsers]);

  const visibleUsers = useMemo(() => {
    const normalizedQuery = query.trim().toLocaleLowerCase();
    return [...users].sort((first, second) => sortMode === "popular"
      ? Number(!!second.hasPage || !!second.hasHostedSite) - Number(!!first.hasPage || !!first.hasHostedSite)
        || (second.upvotes || 0) - (first.upvotes || 0)
        || first.username.localeCompare(second.username)
      : first.username.localeCompare(second.username))
      .filter((user) => !normalizedQuery || user.username.toLocaleLowerCase().includes(normalizedQuery));
  }, [query, sortMode, users]);

  const votePage = useCallback(async (username: string, vote: boolean) => {
    if (!me || voting) return;
    setVoting(username);
    try {
      const result = await voteUserPage(username, vote);
      setUsers((current) => current.map((user) => user.username === username
        ? { ...user, upvotes: result.upvotes, myVote: result.myVote }
        : user));
    } catch (voteError) {
      setError(voteError instanceof Error ? voteError.message : "The vote could not be saved.");
    } finally {
      setVoting(null);
    }
  }, [me, voting]);

  const openUserPage = useCallback(
    (username: string) => {
      addWindow(page, {
        type: "userpage",
        username,
        title: `Web Browser - ${username}`,
        width: 520,
        height: 460,
      });
    },
    [addWindow, page],
  );

  return (
    <div
      className="user-browser flex h-full min-h-0 w-full flex-col bg-[#f3f6f4] text-xs text-[#203844]"
      data-testid="user-browser"
      data-theme={directoryTheme}
    >
      <div className="flex shrink-0 flex-wrap items-center gap-1 border-b border-[#808080] bg-[#c0c0c0] p-1">
        <span className="px-1 font-bold text-[#000080]">Web</span>
        <button
          type="button"
          className={`win98-button px-2 ${activeView === "wiki" ? "font-bold" : ""}`}
          onClick={() => setActiveView("wiki")}
          data-testid="button-browser-wiki"
        >
          Wiki
        </button>
        <button
          type="button"
          className={`win98-button px-2 ${activeView === "feed" ? "font-bold" : ""}`}
          onClick={() => setActiveView("feed")}
          data-testid="button-browser-for-you"
        >
          For You
        </button>
        <button
          type="button"
          className={`win98-button px-2 ${activeView === "people" ? "font-bold" : ""}`}
          onClick={() => setActiveView("people")}
          data-testid="button-browser-people"
        >
          People
        </button>
        <button
          type="button"
          className="win98-button px-2"
          onClick={() => void loadUsers(true)}
          disabled={loading || refreshing}
          data-testid="button-refresh-users"
          title="Refresh the user directory"
        >
          {refreshing ? "Refreshing..." : "Refresh"}
        </button>
        <span className="mx-1 hidden h-5 w-px bg-[#808080] sm:block" aria-hidden="true" />
        <label className="flex min-w-[190px] flex-1 items-center gap-1" htmlFor="user-browser-address">
          <span className="font-bold">Address</span>
          <input
            id="user-browser-address"
            className="win98-inset min-w-0 flex-1 bg-white px-1 py-0.5 text-[11px]"
            value={`http://photo.local/${activeView === "wiki" ? "wiki/" : activeView === "people" ? "users/" : "feed/"}`}
            readOnly
            data-testid="input-browser-address"
            aria-label={activeView === "wiki" ? "Wiki address" : activeView === "people" ? "Directory address" : "For You feed address"}
          />
        </label>
      </div>

      {activeView === "wiki" ? <WikiBrowser /> : activeView === "feed" ? <SocialFeed /> : <>
      <div className="people-directory-header flex shrink-0 flex-wrap items-center justify-between gap-3 border-b border-[#dce4e3] bg-white px-4 py-3">
        <div>
          <div className="text-[10px] font-bold uppercase tracking-[.16em] text-[#57827c]">Community</div>
          <div className="people-directory-heading mt-1 text-lg font-bold tracking-tight text-[#203844]">People</div>
          <div className="people-directory-muted mt-0.5 text-[10px] text-[#718188]">
            Find the people behind the posts and personal sites.
          </div>
        </div>
        {me && (
          <button
            type="button"
            className="people-directory-open-button shrink-0 rounded-lg bg-[#286b70] px-3 py-2 text-[11px] font-semibold text-white shadow-sm hover:bg-[#20585d]"
            onClick={() => openUserPage(me.username)}
            data-testid="button-open-my-page"
            title={`Open ${me.username}'s personal page`}
          >
            Open my page
          </button>
        )}
      </div>

      <div className="people-directory-toolbar flex shrink-0 flex-wrap items-center gap-2 border-b border-[#e4e9e7] px-4 py-3" role="search">
        <label className="font-bold" htmlFor="user-browser-search">
          <span className="sr-only">Find</span>
        </label>
        <div className="people-directory-search flex min-w-[180px] flex-1 items-center gap-2 rounded-lg border border-[#dbe3e2] bg-white px-3 py-2 text-[#6c7e83]">
          <span aria-hidden="true">⌕</span>
          <input id="user-browser-search" type="search" className="min-w-0 flex-1 bg-transparent text-[11px] text-[#203844] outline-none placeholder:text-[#91a0a4]" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search people" data-testid="input-search-users" aria-label="Search usernames" />
        </div>
        {query && (
          <button
            type="button"
            className="rounded-lg border border-[#dbe3e2] bg-white px-3 py-2 text-[10px] font-semibold text-[#60747a]"
            onClick={() => setQuery("")}
            data-testid="button-clear-user-search"
          >
            Clear
          </button>
        )}
        <label className="people-directory-sort flex items-center gap-2 rounded-lg border border-[#dbe3e2] bg-white px-3 py-2 text-[10px] text-[#60747a]">
          <span>Sort</span>
          <select className="bg-transparent font-semibold text-[#304c55] outline-none" value={sortMode} onChange={(event) => setSortMode(event.target.value as "popular" | "alphabetical")} aria-label="Sort profiles">
            <option value="popular">Popularity</option>
            <option value="alphabetical">Alphabetical</option>
          </select>
        </label>
      </div>

      {error && (
        <div
          className="people-directory-error m-3 flex flex-wrap items-center justify-between gap-2 rounded-lg border border-[#f2c5b8] bg-[#fff4ed] p-3 text-[#8a4937]"
          role="alert"
          data-testid="status-user-browser-error"
        >
          <span>
            <strong>Directory unavailable.</strong> {error}
          </span>
          <button
            type="button"
            className="people-directory-retry rounded-lg border border-[#e6c9bd] bg-white px-3 py-1.5 text-[#573c34]"
            onClick={() => void loadUsers(false)}
            data-testid="button-retry-users"
          >
            Try again
          </button>
        </div>
      )}

      <div className="people-directory-results min-h-0 flex-1 overflow-auto p-3 sm:p-4" data-testid="user-browser-results">
        {loading ? (
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {[0, 1, 2, 3, 4, 5].map((index) => (
              <LoadingCard key={index} index={index} />
            ))}
          </div>
        ) : users.length === 0 && !error ? (
          <div className="people-directory-empty flex min-h-[180px] flex-col items-center justify-center rounded-xl border border-[#dce4e3] bg-white p-5 text-center">
            <div className="text-base font-bold text-[#287078]" data-testid="status-user-browser-empty">
              This directory is quiet.
            </div>
            <div className="mt-1 max-w-xs text-[11px] text-gray-600">
              No profiles are available yet. Check back after the next new arrival.
            </div>
            <button
              type="button"
              className="mt-3 rounded-lg bg-[#286b70] px-3 py-2 text-[11px] font-semibold text-white"
              onClick={() => void loadUsers(true)}
              data-testid="button-refresh-empty-users"
            >
              Check again
            </button>
          </div>
        ) : visibleUsers.length === 0 ? (
          <div className="people-directory-empty flex min-h-[140px] flex-col items-center justify-center rounded-xl border border-[#dce4e3] bg-white p-5 text-center">
            <div className="font-bold text-[#287078]" data-testid="status-user-search-empty">
              No matching profiles.
            </div>
            <div className="mt-1 text-[11px] text-gray-600">
              Try a different username or clear the search.
            </div>
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {visibleUsers.map((user) => (
              <UserCard key={user.username} user={user} onOpen={openUserPage} onVote={votePage} canVote={!!me && !voting} />
            ))}
          </div>
        )}
      </div>

      <div
        className="people-directory-footer flex shrink-0 justify-between border-t border-[#dce4e3] bg-white px-4 py-2 text-[10px] text-[#7b8b8f]"
        data-testid="status-user-browser-count"
      >
        <span>
          {query ? `${visibleUsers.length} of ${users.length} profiles` : `${users.length} profiles`}
        </span>
        <span>{me ? `Signed in as ${me.username}` : "Visitor mode"}</span>
      </div>
      </>}
    </div>
  );
}
