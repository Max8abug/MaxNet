import { useDesktopStore } from '../store';

const EMPTY_STRINGS: never[] = [];
const EMPTY_WINDOWS: never[] = [];

export function RedStrings({ page }: { page: string }) {
  const strings = useDesktopStore(state => state.strings[page] ?? EMPTY_STRINGS);
  const windows = useDesktopStore(state => state.windows[page] ?? EMPTY_WINDOWS);
  const removeString = useDesktopStore(state => state.removeString);
  
  // Need to force re-render when windows move
  // We'll just rely on parent re-renders or an animation frame loop if needed.
  // Actually, Zustand will re-render this if windows change (since x/y are in windows)
  
  if (strings.length === 0) return null;

  return (
    <svg className="absolute inset-0 w-full h-full pointer-events-none z-0" style={{ minWidth: 2000, minHeight: 2000 }}>
      <defs>
        <filter id="fuzzy" x="-20%" y="-20%" width="140%" height="140%">
          <feTurbulence type="fractalNoise" baseFrequency="0.5" numOctaves="2" result="noise" />
          <feDisplacementMap in="SourceGraphic" in2="noise" scale="2" xChannelSelector="R" yChannelSelector="G" />
          <feDropShadow dx="2" dy="2" stdDeviation="2" floodOpacity="0.5" />
        </filter>
      </defs>
      {strings.map(s => {
        const w1 = windows.find(w => w.id === s.fromId);
        const w2 = windows.find(w => w.id === s.toId);
        
        if (!w1 || !w2) return null;
        
        const x1 = w1.x + w1.width / 2;
        const y1 = w1.y + w1.height / 2;
        const x2 = w2.x + w2.width / 2;
        const y2 = w2.y + w2.height / 2;
        
        // Calculate curve/sag
        const midX = (x1 + x2) / 2;
        const midY = (y1 + y2) / 2 + Math.abs(x1 - x2) * 0.2; // Sag proportional to distance
        
        const path = `M ${x1} ${y1} Q ${midX} ${midY} ${x2} ${y2}`;
        
        return (
          <g key={s.id} className="pointer-events-auto cursor-pointer" onClick={() => removeString(page, s.id)}>
            {/* Invisible thick path for easier clicking */}
            <path d={path} stroke="transparent" strokeWidth="20" fill="none" />
            <path 
              d={path} 
              stroke="#ff2a2a" 
              strokeWidth="4" 
              fill="none" 
              strokeLinecap="round"
              filter="url(#fuzzy)"
              className="hover:stroke-red-500 transition-colors"
            />
          </g>
        );
      })}
    </svg>
  );
}
