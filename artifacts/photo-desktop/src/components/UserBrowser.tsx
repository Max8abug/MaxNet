import { useCallback, useEffect, useMemo, useState } from "react";
import { fetchUsers, fetchUserPages, voteUserPage, type PublicUser, type UserPageListing } from "../lib/api";
import { useAuth } from "../lib/auth-store";
import { useDesktopStore } from "../store";
import { Avatar } from "./Avatar";

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
  page,
  onVote,
}: {
  user: PublicUser;
  onOpen: (username: string) => void;
  page?: UserPageListing;
  onVote: (username: string) => void;
}) {
  return (
    <div
      className="group flex min-h-[116px] w-full flex-col gap-2 text-left"
      onClick={() => onOpen(user.username)}
      data-testid={`card-user-${user.username}`}
      title={`Open ${user.username}'s personal page`}
    >
      <span className="win98-window flex h-full w-full flex-col p-1 transition-transform group-hover:-translate-y-px" onClick={() => onOpen(user.username)}>
        <span className="flex items-center gap-2 border-b border-gray-300 bg-[#e5e5e5] px-1.5 py-1">
          <Avatar username={user.username} size={38} />
          <span className="min-w-0 flex-1">
            <span
              className="block truncate text-sm font-bold"
              style={{ color: user.isAdmin ? "#9b0000" : undefined }}
              data-testid={`text-username-${user.username}`}
            >
              {user.username}
            </span>
            <span className="block truncate text-[10px] text-gray-600">
              {user.isAdmin ? "Site administrator" : user.rank || "Directory member"}
            </span>
          </span>
          <span
            className={`h-2.5 w-2.5 shrink-0 border border-black ${
              user.lastSeen ? "bg-[#008000]" : "bg-[#808080]"
            }`}
            title={user.lastSeen ? "Has recent activity" : "No recent activity"}
            aria-hidden="true"
          />
        </span>
        <span className="flex min-h-0 flex-1 flex-col justify-between px-1.5 py-1 text-[10px]">
          <span className="text-gray-700">{displayActivity(user.lastSeen)}</span>
          <span className="flex items-center justify-between gap-1">
            <span className="font-bold text-[#000080] group-hover:underline">Open personal page</span>
            {page && <button type="button" className="win98-button px-1 text-[10px]" onClick={(e) => { e.stopPropagation(); onVote(user.username); }} aria-label={`Upvote ${user.username}'s page`}>
              {page.myVote ? "♥" : "♡"} {page.score}
            </button>}
          </span>
        </span>
      </span>
    </div>
  );
}

function LoadingCard({ index }: { index: number }) {
  return (
    <div
      className="win98-window min-h-[116px] w-full animate-pulse p-1"
      data-testid={`skeleton-user-${index}`}
      aria-label="Loading user"
    >
      <div className="flex items-center gap-2 border-b border-gray-300 bg-[#e5e5e5] px-1.5 py-1">
        <div className="h-[38px] w-[38px] shrink-0 bg-[#c0c0c0]" />
        <div className="flex-1 space-y-1">
          <div className="h-3 w-3/5 bg-[#c0c0c0]" />
          <div className="h-2 w-2/5 bg-[#d8d8d8]" />
        </div>
      </div>
      <div className="space-y-2 px-1.5 py-2">
        <div className="h-2 w-4/5 bg-[#d8d8d8]" />
        <div className="h-2 w-2/5 bg-[#c0c0c0]" />
      </div>
    </div>
  );
}

export function UserBrowser({ page = "/" }: UserBrowserProps) {
  const [users, setUsers] = useState<PublicUser[]>([]);
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pages, setPages] = useState<UserPageListing[]>([]);
  const me = useAuth((state) => state.user);
  const addWindow = useDesktopStore((state) => state.addWindow);

  const loadUsers = useCallback(async (isRefresh = false) => {
    if (isRefresh) setRefreshing(true);
    else setLoading(true);
    setError(null);

    try {
      const [nextUsers, nextPages] = await Promise.all([fetchUsers(), fetchUserPages()]);
      setUsers(nextUsers); setPages(nextPages);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "The directory could not be loaded.");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);
  const vote = useCallback(async (username: string) => {
    if (!me) { setError("Log in to vote for pages."); return; }
    try {
      const result = await voteUserPage(username);
      setPages(current => current.map(p => p.username === username ? { ...p, score: result.score, myVote: result.myVote } : p));
    } catch (e) { setError(e instanceof Error ? e.message : "Could not vote."); }
  }, [me]);

  useEffect(() => {
    void loadUsers();
  }, [loadUsers]);

  const visibleUsers = useMemo(() => {
    const normalizedQuery = query.trim().toLocaleLowerCase();
    const scores = new Map(pages.map((item) => [item.username, item.score]));
    return [...users]
      .sort((first, second) => {
        const scoreDifference = (scores.get(second.username) || 0) - (scores.get(first.username) || 0);
        return scoreDifference || first.username.localeCompare(second.username);
      })
      .filter((user) => !normalizedQuery || user.username.toLocaleLowerCase().includes(normalizedQuery));
  }, [pages, query, users]);

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
      className="flex h-full min-h-0 w-full flex-col bg-[#c0c0c0] text-xs text-black"
      data-testid="user-browser"
    >
      <div className="flex shrink-0 flex-wrap items-center gap-1 border-b border-[#808080] bg-[#c0c0c0] p-1">
        <span className="px-1 font-bold text-[#000080]">Web</span>
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
            value="http://photo.local/users/"
            readOnly
            data-testid="input-browser-address"
            aria-label="Directory address"
          />
        </label>
      </div>

      <div className="flex shrink-0 flex-wrap items-end justify-between gap-2 border-b border-[#808080] bg-[#d8d8d8] p-2">
        <div>
          <div className="text-base font-bold text-[#000080]">Personal Web Directory</div>
          <div className="mt-0.5 text-[10px] text-gray-700">
            Browse the people who keep this little site alive.
          </div>
        </div>
        {me && (
          <button
            type="button"
            className="win98-button shrink-0 px-2 py-1"
            onClick={() => openUserPage(me.username)}
            data-testid="button-open-my-page"
            title={`Open ${me.username}'s personal page`}
          >
            Open my page
          </button>
        )}
      </div>

      <div className="flex shrink-0 items-center gap-1 border-b border-[#808080] bg-[#c0c0c0] p-1.5" role="search">
        <label className="font-bold" htmlFor="user-browser-search">
          Find
        </label>
        <input
          id="user-browser-search"
          type="search"
          className="win98-inset min-w-0 flex-1 bg-white px-1 py-0.5"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Search usernames"
          data-testid="input-search-users"
          aria-label="Search usernames"
        />
        {query && (
          <button
            type="button"
            className="win98-button px-2"
            onClick={() => setQuery("")}
            data-testid="button-clear-user-search"
          >
            Clear
          </button>
        )}
      </div>

      {error && (
        <div
          className="m-2 flex flex-wrap items-center justify-between gap-2 border border-[#800000] bg-[#ffffe1] p-2 text-[#800000]"
          role="alert"
          data-testid="status-user-browser-error"
        >
          <span>
            <strong>Directory unavailable.</strong> {error}
          </span>
          <button
            type="button"
            className="win98-button px-2 text-black"
            onClick={() => void loadUsers(false)}
            data-testid="button-retry-users"
          >
            Try again
          </button>
        </div>
      )}

      <div className="min-h-0 flex-1 overflow-auto bg-white p-2" data-testid="user-browser-results">
        {loading ? (
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 xl:grid-cols-3">
            {[0, 1, 2, 3, 4, 5].map((index) => (
              <LoadingCard key={index} index={index} />
            ))}
          </div>
        ) : users.length === 0 && !error ? (
          <div className="win98-inset flex min-h-[180px] flex-col items-center justify-center bg-[#f4f4f4] p-5 text-center">
            <div className="text-base font-bold text-[#000080]" data-testid="status-user-browser-empty">
              This directory is quiet.
            </div>
            <div className="mt-1 max-w-xs text-[11px] text-gray-600">
              No profiles are available yet. Check back after the next new arrival.
            </div>
            <button
              type="button"
              className="win98-button mt-3 px-3"
              onClick={() => void loadUsers(true)}
              data-testid="button-refresh-empty-users"
            >
              Check again
            </button>
          </div>
        ) : visibleUsers.length === 0 ? (
          <div className="win98-inset flex min-h-[140px] flex-col items-center justify-center bg-[#f4f4f4] p-5 text-center">
            <div className="font-bold text-[#000080]" data-testid="status-user-search-empty">
              No matching profiles.
            </div>
            <div className="mt-1 text-[11px] text-gray-600">
              Try a different username or clear the search.
            </div>
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 xl:grid-cols-3">
            {visibleUsers.map((user) => (
              <UserCard key={user.username} user={user} page={pages.find(p => p.username === user.username)} onVote={vote} onOpen={openUserPage} />
            ))}
          </div>
        )}
      </div>

      <div
        className="flex shrink-0 justify-between border-t border-white bg-[#c0c0c0] px-2 py-1 text-[10px] text-gray-700"
        data-testid="status-user-browser-count"
      >
        <span>
          {query ? `${visibleUsers.length} of ${users.length} profiles` : `${users.length} profiles`}
        </span>
        <span>{me ? `Signed in as ${me.username}` : "Visitor mode"}</span>
      </div>
    </div>
  );
}
