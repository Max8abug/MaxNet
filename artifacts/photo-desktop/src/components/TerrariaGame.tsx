import { ExternalLink, Info } from "lucide-react";

const TERRARIUM_URL = "https://terraria.mercurywork.shop/";
const REPOSITORY_URL = "https://github.com/MercuryWorkshop/terraria-wasm";

export function TerrariaGame() {
  return (
    <div className="flex h-full min-h-0 flex-col bg-[#101b18] text-[#e9f4ec]">
      <div className="flex shrink-0 flex-wrap items-center gap-2 border-b border-[#38554a] bg-[#1b3028] px-2 py-1.5">
        <Info className="h-4 w-4 shrink-0 text-[#b9d3c3]" aria-hidden="true" />
        <p className="min-w-0 flex-1 text-[10px] leading-snug">
          If the embedded WebAssembly game does not start, open it in a new tab.
        </p>
        <a
          className="win98-button inline-flex shrink-0 items-center gap-1 px-2 py-1 text-[10px]"
          href={TERRARIUM_URL}
          target="_blank"
          rel="noopener noreferrer"
        >
          <ExternalLink className="h-3 w-3" aria-hidden="true" />
          Open in new tab
        </a>
      </div>
      <iframe
        className="min-h-0 w-full flex-1 border-0 bg-black"
        src={TERRARIUM_URL}
        title="Terrarium Terraria WebAssembly game"
        allow="autoplay; fullscreen; gamepad; pointer-lock"
        allowFullScreen
        referrerPolicy="strict-origin-when-cross-origin"
      />
      <div className="flex shrink-0 items-center justify-between gap-2 border-t border-[#38554a] bg-[#1b3028] px-2 py-1 text-[10px]">
        <span>Hosted by Mercury Workshop</span>
        <a className="underline" href={REPOSITORY_URL} target="_blank" rel="noopener noreferrer">
          Source repository
        </a>
      </div>
    </div>
  );
}
