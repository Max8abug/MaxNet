import { ExternalLink, Info } from "lucide-react";

const NEWCP_PLAY_URL = "https://play.newcp.net/";

export function NewClubPenguin() {
  return (
    <div className="flex h-full min-h-0 flex-col bg-[#eaf3fb] text-[#14304a]">
      <div className="flex shrink-0 items-center gap-2 border-b border-[#bbd1e2] bg-[#f7fbff] px-2 py-1.5">
        <Info className="h-4 w-4 shrink-0 text-[#236b9d]" aria-hidden="true" />
        <p className="min-w-0 flex-1 text-[10px] leading-snug">
          Sign in with a NewCP account. It is separate from your account on this site.
        </p>
        <a
          className="win98-button inline-flex shrink-0 items-center gap-1 px-2 py-1 text-[10px]"
          href={NEWCP_PLAY_URL}
          target="_blank"
          rel="noopener noreferrer"
        >
          <ExternalLink className="h-3 w-3" aria-hidden="true" />
          Open in new tab
        </a>
      </div>
      <iframe
        className="min-h-0 w-full flex-1 border-0 bg-[#169fe8]"
        src={NEWCP_PLAY_URL}
        title="New Club Penguin browser game"
        allow="autoplay; fullscreen; gamepad; pointer-lock"
        allowFullScreen
        referrerPolicy="strict-origin-when-cross-origin"
      />
    </div>
  );
}
