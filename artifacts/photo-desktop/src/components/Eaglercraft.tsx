import { useEffect, useRef, useState } from "react";

export function Eaglercraft() {
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [hasInteracted, setHasInteracted] = useState(false);

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
