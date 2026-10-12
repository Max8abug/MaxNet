import "./_group.css";

const people = [
  { name: "Jamie", rank: "Community helper", initials: "J", tint: "#d8eddf", active: "Active now", page: true, site: true, votes: 18 },
  { name: "Morgan", rank: "Member", initials: "M", tint: "#dce7f7", active: "Active 12 min ago", page: true, votes: 12 },
  { name: "Riley", rank: "Site administrator", initials: "R", tint: "#f4e4ca", active: "Active 25 min ago", page: true, admin: true, votes: 9 },
  { name: "Taylor", rank: "Member", initials: "T", tint: "#eee0f0", active: "Active yesterday", site: true },
  { name: "Casey", rank: "New member", initials: "C", tint: "#e8e9e4", active: "No recent activity" },
  { name: "Alex", rank: "Member", initials: "A", tint: "#f5dddd", active: "Active 3 hr ago", page: true, votes: 5 },
];

function ProfileCard({ person }: { person: (typeof people)[number] }) {
  return (
    <article className="group flex min-w-0 flex-col rounded-xl border border-[#dce3e7] bg-white p-4 shadow-[0_2px_8px_rgba(35,59,76,.05)] transition hover:-translate-y-0.5 hover:border-[#a9c9ca] hover:shadow-[0_8px_20px_rgba(35,59,76,.1)]">
      <div className="flex min-w-0 items-center gap-3">
        <div className="relative shrink-0">
          <div style={{ background: person.tint }} className="flex h-12 w-12 items-center justify-center rounded-full text-lg font-bold text-[#344d5b]">{person.initials}</div>
          <span className={`absolute bottom-0 right-0 h-3 w-3 rounded-full border-2 border-white ${person.active === "No recent activity" ? "bg-[#aab3b8]" : "bg-[#35a878]"}`} />
        </div>
        <div className="min-w-0 flex-1">
          <h2 className={`truncate text-sm font-bold ${person.admin ? "text-[#9b3944]" : "text-[#203844]"}`}>{person.name}</h2>
          <p className="mt-0.5 truncate text-[11px] text-[#70818a]">{person.rank}</p>
        </div>
        <span className="text-[#9aabb2]" aria-hidden="true">↗</span>
      </div>
      <div className="mt-4 flex items-center justify-between gap-2 border-t border-[#edf0f1] pt-3">
        <span className="truncate text-[10px] text-[#76868d]">{person.active}</span>
        <div className="flex shrink-0 items-center gap-1.5">
          {person.site && <span className="rounded-full bg-[#e8f2ef] px-2 py-1 text-[9px] font-semibold text-[#42776a]">HTML site</span>}
          {person.page && <button type="button" className="rounded-full border border-[#d9e2e5] bg-[#f7faf9] px-2.5 py-1 text-[10px] font-semibold text-[#375f65] hover:bg-[#eaf4f1]">▲ {person.votes}</button>}
        </div>
      </div>
      <div className="mt-3 flex items-center justify-between">
        <span className="text-[10px] text-[#85939a]">{person.page || person.site ? "Personal page" : "Profile"}</span>
        <span className="text-[11px] font-semibold text-[#287078] group-hover:underline">View profile →</span>
      </div>
    </article>
  );
}

export function Refresh() {
  return (
    <main className="flex h-screen min-h-0 flex-col bg-[#f3f6f4] text-[#203844]">
      <header className="shrink-0 border-b border-[#dce4e3] bg-white px-5 py-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div><p className="text-[10px] font-bold uppercase tracking-[.16em] text-[#57827c]">Community</p><h1 className="mt-1 text-xl font-bold tracking-tight">People</h1><p className="mt-1 text-[11px] text-[#718188]">Find the people behind the posts and personal sites.</p></div>
          <button className="rounded-lg bg-[#286b70] px-3 py-2 text-[11px] font-semibold text-white shadow-sm hover:bg-[#20585d]">Open my page</button>
        </div>
      </header>
      <section className="flex shrink-0 flex-wrap items-center gap-2 border-b border-[#e4e9e7] px-5 py-3" aria-label="Directory controls">
        <label className="flex min-w-[180px] flex-1 items-center gap-2 rounded-lg border border-[#dbe3e2] bg-white px-3 py-2 text-[#6c7e83]">
          <span aria-hidden="true">⌕</span><input className="min-w-0 flex-1 bg-transparent text-[11px] text-[#203844] outline-none placeholder:text-[#91a0a4]" placeholder="Search people" />
        </label>
        <span className="rounded-full bg-[#e6efed] px-3 py-2 text-[10px] font-semibold text-[#537871]">6 members</span>
        <label className="flex items-center gap-2 rounded-lg border border-[#dbe3e2] bg-white px-3 py-2 text-[10px] text-[#60747a]"><span>Sort</span><select className="bg-transparent font-semibold text-[#304c55] outline-none"><option>Popular</option><option>A–Z</option></select></label>
      </section>
      <section className="min-h-0 flex-1 overflow-auto p-4 sm:p-5">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          {people.map((person) => <ProfileCard key={person.name} person={person} />)}
        </div>
      </section>
      <footer className="flex shrink-0 items-center justify-between border-t border-[#dce4e3] bg-white px-5 py-2 text-[10px] text-[#7b8b8f]"><span>Showing 6 people</span><span>Signed in as Jamie</span></footer>
    </main>
  );
}
