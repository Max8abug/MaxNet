import { useEffect, useRef, useState } from "react";

interface Player {
  destroy(): void;
  cueVideoById(videoId: string): void;
  loadVideoById(videoId: string): void;
  playVideo(): void;
  pauseVideo(): void;
}
interface YouTubeAPI {
  Player: new (element: HTMLElement, options: {
    width: string; height: string;
    videoId: string;
    playerVars: Record<string, string | number>;
    events: {
      onReady(event: { target: Player }): void;
      onStateChange(event: { data: number }): void;
      onError(event: { data: number }): void;
      onAutoplayBlocked(): void;
    };
  }) => Player;
}
let apiPromise: Promise<YouTubeAPI> | null = null;
function loadAPI(): Promise<YouTubeAPI> {
  const getAPI = () => (window as Window & { YT?: YouTubeAPI }).YT;
  if (getAPI()?.Player) return Promise.resolve(getAPI()!);
  if (apiPromise) return apiPromise;
  apiPromise = new Promise<YouTubeAPI>((resolve, reject) => {
    let script = document.getElementById("personal-youtube-api") as HTMLScriptElement | null;
    if (!script) {
      script = document.createElement("script");
      script.id = "personal-youtube-api";
      script.src = "https://www.youtube.com/iframe_api";
      document.head.appendChild(script);
    }
    const cleanup = () => { clearInterval(poll); clearTimeout(timeout); script?.removeEventListener("error", fail); };
    const fail = () => {
      cleanup();
      script?.remove();
      reject(new Error("YouTube could not load. Check your connection or content blocker and retry."));
    };
    const poll = setInterval(() => {
      const api = getAPI();
      if (api?.Player) { cleanup(); resolve(api); }
    }, 100);
    const timeout = setTimeout(fail, 15_000);
    script.addEventListener("error", fail);
  }).catch((error) => { apiPromise = null; throw error; });
  return apiPromise;
}

export function PersonalYouTubePlayer({ videoId, playRequest, onEnded }: {
  videoId: string | null;
  playRequest: number;
  onEnded: () => void;
}) {
  const section = useRef<HTMLElement>(null);
  const holder = useRef<HTMLDivElement>(null);
  const player = useRef<Player | null>(null);
  const latest = useRef({ videoId, playRequest, onEnded });
  latest.current = { videoId, playRequest, onEnded };
  const [ready, setReady] = useState(false);
  const [playing, setPlaying] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [animation, setAnimation] = useState(true);
  const [videoWidth, setVideoWidth] = useState(100);
  const [availableWidth, setAvailableWidth] = useState(640);
  const [retry, setRetry] = useState(0);
  const [frame, setFrame] = useState(0);
  const [reducedMotion, setReducedMotion] = useState(() => window.matchMedia("(prefers-reduced-motion: reduce)").matches);
  const hasVideo = !!videoId;
  const minimumVideoPercent = Math.min(100, (200 / Math.max(availableWidth, 200)) * 100);
  const displayedVideoPercent = Math.max(videoWidth, minimumVideoPercent);
  const displayedVideoWidth = Math.max(200, Math.round(availableWidth * displayedVideoPercent / 100));

  useEffect(() => {
    const element = section.current;
    if (!element || typeof ResizeObserver === "undefined") return;
    const measure = () => {
      const width = Math.floor(element.getBoundingClientRect().width);
      if (width > 0) setAvailableWidth(width);
    };
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    measure();
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    const query = window.matchMedia("(prefers-reduced-motion: reduce)");
    const change = () => setReducedMotion(query.matches);
    query.addEventListener("change", change);
    return () => query.removeEventListener("change", change);
  }, []);

  useEffect(() => {
    let alive = true;
    setReady(false); setPlaying(false); setError(null);
    if (!hasVideo) return;
    void loadAPI().then((api) => {
      if (!alive || !holder.current) return;
      const mount = document.createElement("div");
      holder.current.replaceChildren(mount);
      player.current = new api.Player(mount, {
        width: "100%", height: "100%",
        videoId: latest.current.videoId!,
        playerVars: { controls: 1, playsinline: 1, rel: 0, origin: window.location.origin },
        events: {
          onReady: () => {
            if (!alive) return;
            setReady(true);
          },
          onStateChange: (event) => {
            if (!alive) return;
            setPlaying(event.data === 1);
            if (event.data === 1) setError(null);
            if (event.data === 0) latest.current.onEnded();
          },
          onError: (event) => {
            if (!alive) return;
            setPlaying(false);
            setError(event.data === 100 ? "This video is unavailable or private. Choose another track."
              : event.data === 101 || event.data === 150 ? "The owner does not allow embedded playback. Open it on YouTube or choose another track."
              : event.data === 153 ? "YouTube could not verify this page's origin. Try opening this app in a regular browser tab."
              : "YouTube could not play this video. Try another track or retry.");
          },
          onAutoplayBlocked: () => {
            if (alive) { setPlaying(false); setError("Your browser blocked automatic playback. Press Play in the YouTube player."); }
          },
        },
      });
    }).catch((err) => { if (alive) setError(err instanceof Error ? err.message : "Could not load YouTube."); });
    return () => {
      alive = false;
      player.current?.destroy();
      player.current = null;
    };
  }, [retry, hasVideo]);

  useEffect(() => {
    if (!ready || !player.current) return;
    setPlaying(false); setError(null);
    if (!videoId) { player.current.pauseVideo(); return; }
    if (playRequest > 0) player.current.loadVideoById(videoId);
    else player.current.cueVideoById(videoId);
  }, [videoId, playRequest, ready]);

  useEffect(() => {
    if (!playing || !animation || reducedMotion) return;
    const timer = setInterval(() => setFrame(value => value + 1), 120);
    return () => clearInterval(timer);
  }, [playing, animation, reducedMotion]);

  return (
    <section ref={section} className="min-w-0" aria-label="Personal YouTube player">
      <div className="mb-1">
        <label className="flex items-center gap-2">
          <span className="shrink-0">Video size</span>
          <input
            type="range"
            min={minimumVideoPercent}
            max={100}
            step={1}
            value={displayedVideoPercent}
            onChange={(event) => setVideoWidth(Number(event.target.value))}
            aria-label="YouTube video width"
            aria-valuetext={`${displayedVideoWidth}px wide; player minimum is 200 by 200 pixels`}
            className="min-w-0 flex-1 accent-blue-700"
            data-testid="input-youtube-video-size"
          />
          <output className="w-16 text-right tabular-nums" data-testid="text-youtube-video-size">
            {displayedVideoWidth}px
          </output>
        </label>
        <p className="text-[10px] text-gray-600">
          The visible YouTube player can shrink to 200 × 200 px; controls and animation stay full-width.
        </p>
      </div>
      <div className="flex w-full justify-center">
        <div
          ref={holder}
          style={{ width: `${displayedVideoPercent}%`, minWidth: "200px" }}
          className="min-h-[200px] aspect-video overflow-hidden bg-black [&>iframe]:h-full [&>iframe]:w-full"
          data-testid="personal-youtube-player"
        />
      </div>
      <div className="flex flex-wrap gap-1 py-1 items-center">
        <button type="button" className="win98-button px-3 py-1" disabled={!ready || !videoId}
          onClick={() => playing ? player.current?.pauseVideo() : player.current?.playVideo()}>{playing ? "Pause" : "Play"}</button>
        <span className="text-[10px]">{!videoId ? "Choose a track below" : playing ? "Playing on this device only" : ready ? "Ready" : "Loading YouTube…"}</span>
        <button type="button" className="win98-button px-2 py-1 ml-auto text-[10px]" onClick={() => setAnimation(value => !value)}>
          {animation ? "Hide animation" : "Show animation"}
        </button>
      </div>
      {animation && <div>
        <div className="win98-inset flex h-10 items-end gap-0.5 bg-black p-1" aria-hidden="true">
          {Array.from({ length: 32 }, (_, index) => <span key={index} className="flex-1 bg-gradient-to-t from-green-600 via-lime-400 to-yellow-300"
            style={{ height: `${playing ? 15 + Math.abs(Math.sin(frame * 0.7 + index * 1.3)) * 85 : 8}%`, transition: "height 120ms linear" }} />)}
        </div>
        <p className="text-[9px] text-gray-600 mt-0.5">Playback animation — not an audio waveform. YouTube does not expose audio data.</p>
      </div>}
      {error && <div role="alert" className="text-xs text-red-800 bg-yellow-50 p-2 mt-1">
        {error} <button type="button" className="win98-button px-2" onClick={() => setRetry(value => value + 1)}>Retry player</button>
      </div>}
      {videoId && <a className="text-xs underline text-blue-800" href={`https://www.youtube.com/watch?v=${videoId}`} target="_blank" rel="noreferrer">Open current video on YouTube</a>}
      <p className="text-[10px] text-gray-600 mt-1">Playback is local, not shared or synchronized. Closing this window stops playback; minimizing it keeps playing in the background. YouTube may block some videos or autoplay.</p>
    </section>
  );
}
