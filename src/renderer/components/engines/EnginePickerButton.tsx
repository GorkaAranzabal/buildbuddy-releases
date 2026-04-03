import React, { useState, useRef, useEffect } from 'react';
import type { SelectedEngine } from '../../../../shared/types';
import { EngineIcon, ENGINE_NAMES } from '../common/EngineIcons';

interface EnginePickerButtonProps {
  selectedEngine: SelectedEngine;
  onEngineChange: (engine: SelectedEngine) => void;
}

const ENGINES: NonNullable<SelectedEngine>[] = ['unreal', 'godot', 'unity', 'blender', 'uefn'];

export function EnginePickerButton({ selectedEngine, onEngineChange }: EnginePickerButtonProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [isDetecting, setIsDetecting] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  // Close dropdown on outside click
  useEffect(() => {
    if (!isOpen) return;
    const handleClick = (e: MouseEvent) => {
      if (!containerRef.current?.contains(e.target as Node)) setIsOpen(false);
    };
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [isOpen]);

  const handleEngineSelect = (engine: NonNullable<SelectedEngine>) => {
    setIsOpen(false);
    onEngineChange(engine);
  };

  const handleAutoDetect = async () => {
    setIsDetecting(true);
    setIsOpen(false);
    try {
      const detected = await window.electronAPI.engine.autoDetect();
      if (detected) onEngineChange(detected);
    } catch {
      // silently fail
    }
    setIsDetecting(false);
  };

  return (
    <div ref={containerRef} className="relative no-drag">
      <button
        onClick={() => setIsOpen(prev => !prev)}
        className="w-8 h-8 rounded-full bg-white/[0.08] hover:bg-white/[0.15] flex items-center justify-center transition-all duration-200 relative"
        title={selectedEngine ? `Engine: ${ENGINE_NAMES[selectedEngine]}${selectedEngine === 'uefn' ? ' (Experimental)' : ''}` : 'Select engine'}
      >
        {isDetecting ? (
          <div className="w-3.5 h-3.5 border-2 border-white/40 border-t-white/80 rounded-full animate-spin" />
        ) : (
          <EngineIcon engine={selectedEngine} size={16} />
        )}
        {selectedEngine === 'uefn' && (
          <span className="absolute -top-0.5 -right-0.5 w-2.5 h-2.5 rounded-full bg-amber-400 border border-black/40 flex items-center justify-center" style={{ fontSize: 6, color: '#000', fontWeight: 700, lineHeight: 1 }}>E</span>
        )}
      </button>

      {isOpen && (
        <div
          className="absolute top-full mt-2 left-1/2 -translate-x-1/2 rounded-xl border border-white/[0.12] overflow-hidden z-50 min-w-[170px]"
          style={{
            background: 'rgba(10, 10, 20, 0.92)',
            backdropFilter: 'blur(40px)',
            WebkitBackdropFilter: 'blur(40px)',
          }}
        >
          {ENGINES.map((engine) => (
            <button
              key={engine}
              onClick={() => handleEngineSelect(engine)}
              className={`w-full flex items-center gap-2.5 px-3 py-2 text-left text-sm transition-colors duration-150 ${
                selectedEngine === engine
                  ? 'bg-white/[0.12] text-white'
                  : 'text-white/70 hover:bg-white/[0.08] hover:text-white'
              }`}
            >
              <EngineIcon engine={engine} size={16} />
              <span>{ENGINE_NAMES[engine]}</span>
              {engine === 'uefn' && (
                <span className="ml-1 w-3.5 h-3.5 rounded-full bg-amber-400/20 border border-amber-400/30 flex items-center justify-center flex-shrink-0" style={{ fontSize: 7, color: '#fbbf24', fontWeight: 700 }}>E</span>
              )}
              {selectedEngine === engine && (
                <svg className="w-3 h-3 ml-auto text-blue-400" fill="currentColor" viewBox="0 0 20 20">
                  <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                </svg>
              )}
            </button>
          ))}
          <div className="border-t border-white/[0.08]">
            <button
              onClick={handleAutoDetect}
              className="w-full flex items-center gap-2.5 px-3 py-2 text-left text-sm text-white/50 hover:bg-white/[0.08] hover:text-white/80 transition-colors duration-150"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 9a2 2 0 012-2h.93a2 2 0 001.664-.89l.812-1.22A2 2 0 0110.07 4h3.86a2 2 0 011.664.89l.812 1.22A2 2 0 0018.07 7H19a2 2 0 012 2v9a2 2 0 01-2 2H5a2 2 0 01-2-2V9z" />
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 13a3 3 0 11-6 0 3 3 0 016 0z" />
              </svg>
              <span>Auto-detect</span>
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
