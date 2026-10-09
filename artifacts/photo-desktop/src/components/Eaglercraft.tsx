import { useEffect, useRef, useState } from "react";
import { configureEaglercraftServers, type EaglercraftLaunchOptions } from "../lib/eaglercraft-config";

export function Eaglercraft() {
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [hasInteracted, setHasInteracted] = useState(false);
  const [configError, setConfigError] = useState<string | null>(null);

  const configureGame = () => {
    try {
      const game = iframeRef.current?.contentWindow as (Window & { eaglercraftXOpts?: EaglercraftLaunchOptions }) | null;
      if (!game?.eaglercraftXOpts) throw new Error("Missing game launch options");
      // The bundled client starts main() after its load-event countdown.
      // Apply defaults here before that countdown launches the game.
      configureEaglercraftServers(game.eaglercraftXOpts);
      setConfigError(null);
    } catch {
      setConfigError("Could not configure the default server. Close and reopen Eaglercraft to retry.");
    }
  };

  useEffect(() => {
    // Continuously ensure iframe has focus when component is mounted
    const focusIframe = () => {
      if (iframeRef.current && document.activeElement !== iframeRef.current) {
        iframeRef.current.focus();
      }
    };

    const timer = setTimeout(focusIframe, 100);
    const interval = setInterval(focusIframe, 500);

    return () => {
      clearTimeout(timer);
      clearInterval(interval);
    };
  }, []);

  const handleInteraction = () => {
    setHasInteracted(true);
    if (iframeRef.current) {
      iframeRef.current.focus();
    }
  };

  return (
    <div 
      ref={containerRef}
      className="w-full h-full flex flex-col bg-black relative" 
      onClick={handleInteraction}
      onMouseDown={handleInteraction}
    >
      {configError && <p role="alert" className="bg-yellow-100 text-red-900 text-xs px-2 py-1">{configError}</p>}
      {!hasInteracted && (
        <div className="absolute inset-0 flex items-center justify-center bg-black/80 z-10 cursor-pointer">
          <div className="text-white text-center">
            <p className="text-xl font-bold mb-2">Click to Play</p>
            <p className="text-sm text-gray-300">Click here to enable keyboard controls</p>
          </div>
        </div>
      )}
      <div className="flex-1 min-h-0">
        <iframe
          ref={iframeRef}
          src="/eaglercraft.html"
          onLoad={configureGame}
          className="w-full h-full border-0"
          title="Eaglercraft"
          allowFullScreen
          allow="keyboard; pointer-lock; fullscreen; gamepad"
          tabIndex={0}
          style={{ outline: 'none' }}
        />
      </div>
    </div>
  );
}
