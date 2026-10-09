import { useEffect, useState } from "react";
import { ExternalLink, Info } from "lucide-react";

export type PortedGameId = "gettingoverit" | "pvz" | "webfishing" | "undertale";

const PORTS: Record<
  PortedGameId,
  { title: string; assetId: string; repository: string }
> = {
  gettingoverit: {
    title: "Getting Over It",
    assetId: "getting-over-it",
    repository: "https://github.com/genizy/web-port/tree/main/getting-over-it",
  },
  pvz: {
    title: "Plants vs. Zombies",
    assetId: "pvz",
    repository: "https://github.com/web-ports/pvz",
  },
  webfishing: {
    title: "Web Fishing",
    assetId: "web-fishing",
    repository: "https://github.com/genizy/web-port/tree/main/web-fishing",
  },
  undertale: {
    title: "Undertale",
    assetId: "undertale",
    repository: "https://github.com/bandit968thegamer-ops/undertale/tree/main/undertale",
  },
};

type AssetManifest = {
  version?: number;
  games?: Record<string, { installed?: boolean }>;
};

export function PortedGame({ game }: { game: PortedGameId }) {
  const [assetsReady, setAssetsReady] = useState(false);
  const [checkingAssets, setCheckingAssets] = useState(true);
  const port = PORTS[game];
  const gameUrl = `/ported-games/${port.assetId}/index.html`;

  useEffect(() => {
    const controller = new AbortController();
    fetch("/ported-games/asset-manifest.json", {
      cache: "no-store",
      signal: controller.signal,
    })
      .then(async response => {
        if (!response.ok) throw new Error("Game asset manifest is unavailable");
        return response.json() as Promise<AssetManifest>;
      })
      .then(manifest => {
        setAssetsReady(manifest.version === 1 && manifest.games?.[port.assetId]?.installed === true);
      })
      .catch(() => setAssetsReady(false))
      .finally(() => setCheckingAssets(false));

    return () => controller.abort();
  }, [port.assetId]);

  return (
    <div className="flex h-full min-h-0 flex-col bg-[#101b18] text-[#e9f4ec]">
      <div className="flex shrink-0 flex-wrap items-center gap-2 border-b border-[#38554a] bg-[#1b3028] px-2 py-1.5">
        <Info className="h-4 w-4 shrink-0 text-[#b9d3c3]" aria-hidden="true" />
        <p className="min-w-0 flex-1 text-[10px] leading-snug">
          Self-hosted game port · source files are installed by the site updater.
        </p>
        {assetsReady && (
          <a
            className="win98-button inline-flex shrink-0 items-center gap-1 px-2 py-1 text-[10px]"
            href={gameUrl}
            target="_blank"
            rel="noopener noreferrer"
          >
            <ExternalLink className="h-3 w-3" aria-hidden="true" />
            Open in new tab
          </a>
        )}
        <a
          className="shrink-0 text-[10px] underline"
          href={port.repository}
          target="_blank"
          rel="noopener noreferrer"
        >
          Source
        </a>
      </div>
      {checkingAssets ? (
        <div className="flex min-h-0 flex-1 items-center justify-center p-6 text-center text-sm">
          Checking for installed game files…
        </div>
      ) : assetsReady ? (
        <iframe
          className="min-h-0 w-full flex-1 border-0 bg-black"
          src={gameUrl}
          title={`${port.title} game`}
          allow="autoplay; fullscreen; gamepad; pointer-lock"
          allowFullScreen
          referrerPolicy="strict-origin-when-cross-origin"
        />
      ) : (
        <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-3 p-6 text-center">
          <p className="text-base font-semibold">{port.title} files are not installed here.</p>
          <p className="max-w-lg text-xs leading-relaxed text-[#c2d2c8]">
            On the self-hosted server, run <code>bash selfhost/update.sh</code>. The updater
            downloads only this game’s pinned repository folder and keeps the files outside
            Git history.
          </p>
          <a
            className="win98-button inline-flex items-center gap-1 px-2 py-1 text-xs"
            href={port.repository}
            target="_blank"
            rel="noopener noreferrer"
          >
            <ExternalLink className="h-3 w-3" aria-hidden="true" />
            View source repository
          </a>
        </div>
      )}
      <div className="flex shrink-0 items-center justify-between gap-2 border-t border-[#38554a] bg-[#1b3028] px-2 py-1 text-[10px]">
        <span>{port.title}</span>
        <span>Self-hosted game files</span>
      </div>
    </div>
  );
}
