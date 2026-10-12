import { useState } from "react";
import { useAuth } from "../lib/auth-store";
import { HostedSitePanel } from "./HostedSitePanel";
import { SocialFeed } from "./SocialFeed";

export function UserPage({ username }: { username: string }) {
  const [showSite, setShowSite] = useState(false);
  const me = useAuth((state) => state.user);
  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex shrink-0 items-center gap-1 border-b border-[#808080] bg-[#c0c0c0] p-1 text-xs">
        <button type="button" className={`win98-button px-2 ${!showSite ? "font-bold" : ""}`} onClick={() => setShowSite(false)}>Posts</button>
        <button type="button" className={`win98-button px-2 ${showSite ? "font-bold" : ""}`} onClick={() => setShowSite(true)}>HTML site</button>
      </div>
      <div className="min-h-0 flex-1">
        {showSite ? <HostedSitePanel username={username} isOwner={me?.username === username} /> : <SocialFeed username={username} />}
      </div>
    </div>
  );
}
