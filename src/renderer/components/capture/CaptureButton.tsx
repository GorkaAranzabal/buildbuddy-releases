import React, { useState, useRef, useEffect } from 'react';

export function CaptureButton() {
  const [isOpen, setIsOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  // Close dropdown when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const handleCapture = (mode: 'fullscreen' | 'window' | 'region') => {
    setIsOpen(false);
    switch (mode) {
      case 'fullscreen':
        window.electronAPI.capture.fullscreen();
        break;
      case 'window':
        // For window capture, we'll show a window picker in the future
        // For now, just capture fullscreen
        window.electronAPI.capture.fullscreen();
        break;
      case 'region':
        window.electronAPI.capture.region();
        break;
    }
  };

  return (
    <div className="relative" ref={dropdownRef}>
      <button
        type="button"
        onClick={() => setIsOpen(!isOpen)}
        className="p-2.5 text-white/50 hover:text-white/80 hover:bg-white/[0.06] rounded-xl transition-all duration-200"
        title="Capture screenshot"
      >
        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M3 9a2 2 0 012-2h.93a2 2 0 001.664-.89l.812-1.22A2 2 0 0110.07 4h3.86a2 2 0 011.664.89l.812 1.22A2 2 0 0018.07 7H19a2 2 0 012 2v9a2 2 0 01-2 2H5a2 2 0 01-2-2V9z"
          />
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M15 13a3 3 0 11-6 0 3 3 0 016 0z"
          />
        </svg>
      </button>

      {/* Dropdown menu */}
      {isOpen && (
        <div 
          className="absolute bottom-full left-0 mb-2 w-48 border border-white/[0.15] rounded-2xl shadow-2xl overflow-hidden animate-in z-50"
          style={{
            background: 'rgba(255, 255, 255, 0.02)',
            backdropFilter: 'blur(60px) saturate(180%)',
            WebkitBackdropFilter: 'blur(60px) saturate(180%)',
          }}
        >
          <div className="py-1.5">
            <button
              onClick={() => handleCapture('fullscreen')}
              className="w-full px-3 py-2.5 text-left text-sm text-white/90 hover:bg-white/[0.06] flex items-center gap-2 transition-colors"
            >
              <svg className="w-4 h-4 text-white/60" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M9.75 17L9 20l-1 1h8l-1-1-.75-3M3 13h18M5 17h14a2 2 0 002-2V5a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z"
                />
              </svg>
              Full Screen
              <span className="ml-auto text-xs text-white/40">⌘⇧1</span>
            </button>

            <button
              onClick={() => handleCapture('window')}
              className="w-full px-3 py-2.5 text-left text-sm text-white/90 hover:bg-white/[0.06] flex items-center gap-2 transition-colors"
            >
              <svg className="w-4 h-4 text-white/60" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M4 5a1 1 0 011-1h14a1 1 0 011 1v2a1 1 0 01-1 1H5a1 1 0 01-1-1V5zM4 13a1 1 0 011-1h6a1 1 0 011 1v6a1 1 0 01-1 1H5a1 1 0 01-1-1v-6zM16 13a1 1 0 011-1h2a1 1 0 011 1v6a1 1 0 01-1 1h-2a1 1 0 01-1-1v-6z"
                />
              </svg>
              Window
              <span className="ml-auto text-xs text-white/40">⌘⇧2</span>
            </button>

            <button
              onClick={() => handleCapture('region')}
              className="w-full px-3 py-2.5 text-left text-sm text-white/90 hover:bg-white/[0.06] flex items-center gap-2 transition-colors"
            >
              <svg className="w-4 h-4 text-white/60" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z"
                />
              </svg>
              Region
              <span className="ml-auto text-xs text-white/40">⌘⇧3</span>
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
