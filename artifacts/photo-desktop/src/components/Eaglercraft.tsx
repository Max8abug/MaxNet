import { useEffect, useRef } from "react";

export function Eaglercraft() {
  const iframeRef = useRef<HTMLIFrameElement>(null);

  return (
    <div className="w-full h-full flex flex-col bg-black">
      <div className="flex-1 min-h-0">
        <iframe
          ref={iframeRef}
          src="/eaglercraft.html"
          className="w-full h-full border-0"
          title="Eaglercraft"
          allowFullScreen
        />
      </div>
    </div>
  );
}
