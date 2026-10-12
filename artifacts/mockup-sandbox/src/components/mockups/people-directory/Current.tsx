import "./_group.css";

type DirectoryUser = {
  username: string;
  rank: string;
  isAdmin?: boolean;
  lastSeen?: string;
  hasPage?: boolean;
  hasHostedSite?: boolean;
  upvotes?: number;
  myVote?: boolean;
};

const users: DirectoryUser[] = [
  { username: "Jamie", rank: "Community Helper", lastSeen: "2026-10-12T14:30:00", hasPage: true, hasHostedSite: true, upvotes: 18 },
  { username: "Morgan", rank: "Member", lastSeen: "2026-10-12T13:50:00", hasPage: true, upvotes: 12 },
  { username: "Riley", rank: "Site administrator", isAdmin: true, lastSeen: "2026-10-12T14:18:00", hasPage: true, upvotes: 9 },
  { username: "Taylor", rank: "Member", lastSeen: "2026-10-11T20:10:00", hasHostedSite: true },
  { username: "Casey", rank: "New member" },
  { username: "Alex", rank: "Member", lastSeen: "2026-10-12T10:40:00", hasPage: true, upvotes: 5 },
];

function Avatar({ username, size = 38 }: { username: string; size?: number }) {
  return <span style={{ width: size, height: size }} className="flex shrink-0 items-center justify-center border border-[#777] bg-[#d7e3ef] text-sm font-bold text-[#294e72]">{username.slice(0, 1).toUpperCase()}</span>;
}

function displayActivity(value?: string) {
  if (!value) return "No recent activity";
  return `Active ${new Date(value).toLocaleString()}`;
}

function UserCard({ user }: { user: DirectoryUser }) {
  const hasPersonalContent = !!user.hasPage || !!user.hasHostedSite;
  return (
    <div role="button" tabIndex={0} className="group flex min-h-[116px] w-full flex-col gap-2 text-left" title={`Open ${user.username}'s personal page`}>
      <span className="win98-window flex h-full w-full flex-col p-1 transition-transform group-hover:-translate-y-px">
        <span className="flex items-center gap-2 border-b border-gray-300 bg-[#e5e5e5] px-1.5 py-1">
          <Avatar username={user.username} size={38} />
          <span className="min-w-0 flex-1">
            <span className="block truncate text-sm font-bold" style={{ color: user.isAdmin ? "#9b0000" : undefined }}>{user.username}</span>
            <span className="block truncate text-[10px] text-gray-600">{user.isAdmin ? "Site administrator" : user.rank || "Directory member"}</span>
          </span>
          <span className={`h-2.5 w-2.5 shrink-0 border border-black ${user.lastSeen ? "bg-[#008000]" : "bg-[#808080]"}`} />
        </span>
        <span className="flex min-h-0 flex-1 flex-col justify-between px-1.5 py-1 text-[10px]">
          <span className="text-gray-700">{hasPersonalContent ? displayActivity(user.lastSeen) : "No personal page yet"}</span>
          <span className="flex items-center justify-between gap-1">
            <span className="font-bold text-[#000080] group-hover:underline">{hasPersonalContent ? "Open personal page" : "View profile"}</span>
            {user.hasHostedSite && <span className="shrink-0 border border-[#808080] bg-[#e6e6e6] px-1 text-[9px]">HTML site</span>}
            {user.hasPage && <button type="button" className="win98-button shrink-0 px-1 text-[10px]">▲ {user.upvotes || 0}</button>}
          </span>
        </span>
      </span>
    </div>
  );
}

export function Current() {
  return (
    <div className="flex h-screen min-h-0 flex-col bg-[#c0c0c0] text-xs text-black">
      <div className="flex shrink-0 flex-wrap items-end justify-between gap-2 border-b border-[#808080] bg-[#d8d8d8] p-2">
        <div><div className="text-base font-bold text-[#000080]">Personal Web Directory</div><div className="mt-0.5 text-[10px] text-gray-700">Browse the people who keep this little site alive.</div></div>
        <button className="win98-button shrink-0 px-2 py-1">Open my page</button>
      </div>
      <div className="flex shrink-0 items-center gap-1 border-b border-[#808080] bg-[#c0c0c0] p-1.5">
        <label className="font-bold">Find</label><input className="win98-inset min-w-0 flex-1 bg-white px-1 py-0.5" placeholder="Search usernames" />
        <label className="flex items-center gap-1"><span className="font-bold">Sort</span><select className="win98-inset bg-white px-1 py-0.5"><option>Popularity</option><option>Alphabetical</option></select></label>
      </div>
      <div className="min-h-0 flex-1 overflow-auto bg-white p-2">
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          {users.map((user) => <UserCard key={user.username} user={user} />)}
        </div>
      </div>
      <div className="flex shrink-0 justify-between border-t border-white bg-[#c0c0c0] px-2 py-1 text-[10px] text-gray-700"><span>6 profiles</span><span>Signed in as Jamie</span></div>
    </div>
  );
}
