import React, { useRef, useCallback } from 'react';
import robotIdleImg from '../../assets/robot-idle.png';
import robotThinkingImg from '../../assets/robot-thinking.png';
import robotErrorImg from '../../assets/robot-error.png';
import robotSuccessImg from '../../assets/robot-success.png';
import { EnginePickerButton } from '../engines/EnginePickerButton';
import type { SelectedEngine } from '../../../../shared/types';

export type RobotStatus = 'idle' | 'thinking' | 'error' | 'success';

interface NotchBarProps {
  isExpanded: boolean;
  onToggle: () => void;
  onStop?: () => void;
  onSettings?: () => void;
  isLoading?: boolean;
  robotStatus?: RobotStatus;
  selectedEngine?: SelectedEngine;
  onEngineChange?: (engine: SelectedEngine) => void;
  updateReady?: boolean;
  updateDownloading?: string | null;
  updateError?: string | null;
}

const robotImages: Record<RobotStatus, string> = {
  idle: robotIdleImg,
  thinking: robotThinkingImg,
  error: robotErrorImg,
  success: robotSuccessImg,
};

export function NotchBar({ isExpanded, onToggle, onStop, onSettings, isLoading, robotStatus = 'idle', selectedEngine, onEngineChange, updateReady, updateDownloading, updateError }: NotchBarProps) {
  const handleSettingsOrUpdate = () => {
    if (updateReady) {
      window.electronAPI.updater.install();
    } else {
      onSettings?.();
    }
  };
  // Determine which image to show
  const currentStatus: RobotStatus = isLoading ? 'thinking' : robotStatus;
  const robotImage = robotImages[currentStatus];

  const dragHandleRef = useRef<HTMLDivElement>(null);

  const handleDragStart = useCallback(() => {
    dragHandleRef.current?.classList.add('is-dragging');
    const onUp = () => {
      dragHandleRef.current?.classList.remove('is-dragging');
      window.removeEventListener('mouseup', onUp);
    };
    window.addEventListener('mouseup', onUp);
  }, []);

  return (
    <div 
      className="flex items-center gap-1 px-1.5 py-1.5 rounded-full border border-white/[0.12] drag-region"
      style={{
        background: 'rgba(0, 0, 0, 0.78)',
        backdropFilter: 'blur(80px) saturate(200%)',
        WebkitBackdropFilter: 'blur(80px) saturate(200%)',
      }}
    >
      {/* Drag Handle (leftmost) - visual affordance for moving the notch */}
      <div
        ref={dragHandleRef}
        className="drag-handle flex items-center justify-center w-4 h-full opacity-30 hover:opacity-60 transition-opacity duration-200"
        onMouseDown={handleDragStart}
        title="Drag to move"
      >
        <svg width="8" height="14" viewBox="0 0 8 14" fill="currentColor" className="text-white">
          <circle cx="2" cy="2" r="1.4" />
          <circle cx="6" cy="2" r="1.4" />
          <circle cx="2" cy="7" r="1.4" />
          <circle cx="6" cy="7" r="1.4" />
          <circle cx="2" cy="12" r="1.4" />
          <circle cx="6" cy="12" r="1.4" />
        </svg>
      </div>

      {/* Robot Mascot Icon (Left) - Changes based on status */}
      <div className={`w-8 h-8 rounded-full bg-white/[0.08] flex items-center justify-center no-drag overflow-hidden transition-all duration-300 ${isLoading ? 'animate-pulse' : ''}`}>
        <img 
          src={robotImage} 
          alt={`Robot ${currentStatus}`} 
          className="w-6 h-6 object-cover"
        />
      </div>

      {/* Engine Picker — only in expanded state to keep the compact notch minimal */}
      {isExpanded && onEngineChange && (
        <EnginePickerButton
          selectedEngine={selectedEngine ?? null}
          onEngineChange={onEngineChange}
        />
      )}

      {/* Ask Button (Center) */}
      <button
        onClick={onToggle}
        className="flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-blue-500 hover:bg-blue-400 text-white text-sm font-medium transition-all duration-200 no-drag"
      >
        {isExpanded ? (
          <>
            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 15l7-7 7 7" />
            </svg>
            <span>Hide</span>
          </>
        ) : (
          <>
            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M5 3v4M3 5h4M6 17v4m-2-2h4m5-16l2.286 6.857L21 12l-5.714 2.143L13 21l-2.286-6.857L5 12l5.714-2.143L13 3z"
              />
            </svg>
            <span>Ask</span>
          </>
        )}
      </button>

      {/* Settings Button (Right) — badge reflects update state */}
      <button
        onClick={handleSettingsOrUpdate}
        className="relative w-8 h-8 rounded-full bg-white/[0.08] hover:bg-white/[0.15] flex items-center justify-center no-drag transition-all duration-200"
        title={
          updateReady ? 'Update ready — click to install' :
          updateError ? 'Update failed — click for settings' :
          updateDownloading ? `Downloading update v${updateDownloading}…` :
          'Settings'
        }
      >
        <svg className="w-4 h-4 text-white/80" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z"
          />
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"
          />
        </svg>
        {/* Green pulsing dot: update downloaded and ready to install */}
        {updateReady && (
          <span className="absolute top-0.5 right-0.5 flex h-2.5 w-2.5">
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />
            <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-emerald-500" />
          </span>
        )}
        {/* Blue spinning dot: update is being downloaded */}
        {!updateReady && updateDownloading && (
          <span className="absolute top-0.5 right-0.5 flex h-2.5 w-2.5">
            <span className="animate-spin inline-flex h-2.5 w-2.5 rounded-full border border-blue-400 border-t-transparent" />
          </span>
        )}
        {/* Red dot: download failed */}
        {!updateReady && !updateDownloading && updateError && (
          <span className="absolute top-0.5 right-0.5 flex h-2.5 w-2.5">
            <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-red-500" />
          </span>
        )}
      </button>
    </div>
  );
}
