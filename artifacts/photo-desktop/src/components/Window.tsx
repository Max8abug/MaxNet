import React, { useRef, useState } from 'react';
import { useDesktopStore, WindowData } from '../store';
import { motion } from 'framer-motion';
import { useLocation } from 'wouter';
import { X, Square, Minus } from 'lucide-react';

export function Window({ 
  window: w, 
  page, 
  boundsRef 
}: { 
  window: WindowData; 
  page: string; 
  boundsRef: React.RefObject<HTMLDivElement>;
}) {
  const { updateWindow, removeWindow, bringToFront, isStringMode, stringStartId, setStringStart, addString } = useDesktopStore();
  const [, setLocation] = useLocation();
  const [isEditing, setIsEditing] = useState(false);

  const handlePointerDown = () => {
    bringToFront(page, w.id);
  };

  const handleWindowClick = () => {
    if (isStringMode) {
      if (!stringStartId) {
        setStringStart(w.id);
      } else {
        addString(page, stringStartId, w.id);
      }
    }
  };

  const handleDragEnd = (e: any, info: any) => {
    updateWindow(page, w.id, { x: w.x + info.offset.x, y: w.y + info.offset.y });
  };

  const handleResize = (e: React.PointerEvent) => {
    e.preventDefault();
    e.stopPropagation();
    
    bringToFront(page, w.id);

    const startX = e.clientX;
    const startY = e.clientY;
    const startW = w.width;
    const startH = w.height;

    const onPointerMove = (moveEvent: PointerEvent) => {
      const newW = Math.max(200, startW + (moveEvent.clientX - startX));
      const newH = Math.max(150, startH + (moveEvent.clientY - startY));
      updateWindow(page, w.id, { width: newW, height: newH });
    };

    const onPointerUp = () => {
      document.removeEventListener('pointermove', onPointerMove);
      document.removeEventListener('pointerup', onPointerUp);
    };

    document.addEventListener('pointermove', onPointerMove);
    document.addEventListener('pointerup', onPointerUp);
  };

  const isActive = useDesktopStore(state => state.maxZIndex === w.zIndex);

  return (
    <motion.div
      drag={!isStringMode && !isEditing}
      dragConstraints={boundsRef}
      dragMomentum={false}
      dragElastic={0}
      onDragEnd={handleDragEnd}
      onPointerDown={handlePointerDown}
      onClick={handleWindowClick}
      initial={false}
      animate={{ x: w.x, y: w.y }}
      transition={{ type: "tween", duration: 0 }}
      className={`absolute win98-window flex flex-col ${isStringMode ? 'cursor-crosshair' : ''} ${isStringMode && stringStartId === w.id ? 'ring-4 ring-red-500' : ''}`}
      style={{
        width: w.width,
        height: w.height,
        zIndex: w.zIndex,
      }}
    >
      {/* Title bar */}
      <div 
        className={`win98-titlebar ${isActive ? '' : 'inactive'} shrink-0 cursor-move select-none`}
        onDoubleClick={() => { /* maybe maximize */ }}
      >
        <div className="flex items-center gap-2 overflow-hidden px-1">
          <div className="w-4 h-4 bg-white/20" /> {/* fake icon */}
          <span className="truncate text-sm tracking-wide">{w.title}</span>
        </div>
        <div className="flex items-center gap-1 shrink-0 px-1">
          <button className="win98-button w-5 h-5 flex items-center justify-center pointer-events-auto" onPointerDown={e => e.stopPropagation()}>
            <Minus className="w-3 h-3" strokeWidth={3} />
          </button>
          <button className="win98-button w-5 h-5 flex items-center justify-center pointer-events-auto" onPointerDown={e => e.stopPropagation()}>
            <Square className="w-3 h-3" strokeWidth={3} />
          </button>
          <button 
            className="win98-button w-5 h-5 flex items-center justify-center pointer-events-auto" 
            onPointerDown={e => { e.stopPropagation(); removeWindow(page, w.id); }}
          >
            <X className="w-3 h-3" strokeWidth={3} />
          </button>
        </div>
      </div>

      {/* Content Area */}
      <div 
        className="flex-1 overflow-auto win98-inset bg-white p-2 text-black pointer-events-auto flex flex-col relative group"
        onDoubleClick={() => setIsEditing(true)}
      >
        {isEditing && (
          <div className="absolute inset-0 bg-[#c0c0c0] z-50 p-2 flex flex-col gap-2 overflow-auto text-sm">
            <div className="font-bold mb-2">Edit Window</div>
            <label className="flex flex-col">
              Title
              <input type="text" className="win98-inset px-1" value={w.title} onChange={e => updateWindow(page, w.id, { title: e.target.value })} />
            </label>
            {w.type === 'photo' && (
              <>
                <label className="flex flex-col">
                  Image URL
                  <input type="text" className="win98-inset px-1" value={w.imageUrl || ''} onChange={e => updateWindow(page, w.id, { imageUrl: e.target.value })} />
                </label>
                <label className="flex flex-col">
                  Caption
                  <input type="text" className="win98-inset px-1" value={w.content || ''} onChange={e => updateWindow(page, w.id, { content: e.target.value })} />
                </label>
              </>
            )}
            {w.type === 'link' && (
              <>
                <label className="flex flex-col">
                  Link Label
                  <input type="text" className="win98-inset px-1" value={w.linkLabel || ''} onChange={e => updateWindow(page, w.id, { linkLabel: e.target.value })} />
                </label>
                <label className="flex flex-col">
                  Link Target (e.g. /about)
                  <input type="text" className="win98-inset px-1" value={w.linkTarget || ''} onChange={e => updateWindow(page, w.id, { linkTarget: e.target.value })} />
                </label>
              </>
            )}
            {w.type === 'text' && (
              <label className="flex flex-col flex-1">
                Content
                <textarea className="win98-inset px-1 flex-1 resize-none" value={w.content || ''} onChange={e => updateWindow(page, w.id, { content: e.target.value })} />
              </label>
            )}
            <button className="win98-button mt-auto" onClick={(e) => { e.stopPropagation(); setIsEditing(false); }}>Done</button>
          </div>
        )}

        {w.type === 'text' && !isEditing && (
          <div className="w-full h-full font-mono text-sm whitespace-pre-wrap break-words overflow-auto">
            {w.content || ''}
          </div>
        )}

        {w.type === 'photo' && !isEditing && (
          <div className="w-full h-full flex flex-col">
            <div className="flex-1 bg-black overflow-hidden flex items-center justify-center pointer-events-none">
              {w.imageUrl ? (
                <img src={w.imageUrl} alt={w.title} className="max-w-full max-h-full object-contain" draggable={false} />
              ) : (
                <div className="text-white/50 text-sm">No Image</div>
              )}
            </div>
            {w.content && <div className="mt-2 text-sm italic shrink-0 text-center font-serif pointer-events-none">{w.content}</div>}
          </div>
        )}

        {w.type === 'gallery' && !isEditing && (
          <div className="grid grid-cols-3 gap-2 overflow-auto auto-rows-max h-full">
            {(w.images || []).map((img, i) => (
              <div 
                key={i} 
                className="aspect-square bg-gray-200 border border-gray-400 cursor-pointer hover:border-blue-500 overflow-hidden"
                onClick={() => {
                  const store = useDesktopStore.getState();
                  store.addWindow(page, {
                    type: 'photo',
                    title: `Photo ${i+1}`,
                    imageUrl: img,
                    x: w.x + 50 + (i * 20),
                    y: w.y + 50 + (i * 20),
                    width: 400,
                    height: 450
                  });
                }}
              >
                <img src={img} alt="" className="w-full h-full object-cover" draggable={false} />
              </div>
            ))}
          </div>
        )}

        {w.type === 'link' && !isEditing && (
          <div className="w-full h-full flex flex-col items-center justify-center p-4">
            <button 
              className="win98-button text-lg px-8 py-4 bg-gray-300 w-full"
              onClick={() => {
                if (w.linkTarget) {
                  setLocation(w.linkTarget);
                }
              }}
            >
              {w.linkLabel || 'Open Link'}
            </button>
            <div className="mt-4 text-xs text-gray-500 truncate pointer-events-none">Target: {w.linkTarget}</div>
          </div>
        )}

        {/* Resize Handle */}
        <div 
          className="absolute bottom-0 right-0 w-4 h-4 cursor-se-resize flex items-end justify-end p-0.5 opacity-50 group-hover:opacity-100"
          onPointerDown={handleResize}
        >
          <svg width="10" height="10" viewBox="0 0 10 10">
            <path d="M 10 0 L 10 10 L 0 10 Z" fill="transparent" />
            <path d="M 8 2 L 10 0 M 6 4 L 10 0 M 4 6 L 10 0 M 2 8 L 10 0 M 0 10 L 10 0" stroke="black" strokeWidth="1" />
          </svg>
        </div>
      </div>
    </motion.div>
  );
}
