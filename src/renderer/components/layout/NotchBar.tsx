import React, { useRef, useCallback, useState } from 'react';
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
  onOpenBlueprints?: () => void;
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

export function NotchBar({ isExpanded, onToggle, onStop, onSettings, onOpenBlueprints, isLoading, robotStatus = 'idle', selectedEngine, onEngineChange, updateReady, updateDownloading, updateError }: NotchBarProps) {
  const [blueprintsHovered, setBlueprintsHovered] = useState(false);
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
    document.body.style.cursor = 'grabbing';
    const onUp = () => {
      dragHandleRef.current?.classList.remove('is-dragging');
      document.body.style.cursor = '';
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
        className="drag-handle flex items-center justify-center w-4 h-full opacity-30 hover:opacity-60 transition-opacity duration-200 cursor-grab"
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

      {/* Engine Picker — only in expanded state to keep the compact notch minimal */}
      {isExpanded && onEngineChange && (
        selectedEngine === 'unreal' && onOpenBlueprints ? (
          <div
            className="relative no-drag"
            onMouseEnter={() => setBlueprintsHovered(true)}
            onMouseLeave={() => setBlueprintsHovered(false)}
          >
            <EnginePickerButton
              selectedEngine={selectedEngine ?? null}
              onEngineChange={onEngineChange}
            />
            {/* Invisible hover bridge so the cursor can travel from engine button to popover without exiting the wrapper */}
            <div className="absolute bottom-full left-1/2 -translate-x-1/2 w-12 h-4" aria-hidden />
            <button
              onClick={onOpenBlueprints}
              className="absolute bottom-full left-1/2 -translate-x-1/2 mb-3 w-6 h-6 rounded-full bg-white/[0.08] hover:bg-white/[0.15] border border-white/[0.14] flex items-center justify-center no-drag z-10"
              style={{
                transform: blueprintsHovered ? 'translateY(0) scale(1)' : 'translateY(6px) scale(0.6)',
                opacity: blueprintsHovered ? 1 : 0,
                pointerEvents: blueprintsHovered ? 'auto' : 'none',
                transition: 'transform 220ms cubic-bezier(0.34, 1.56, 0.64, 1), opacity 160ms ease-out',
              }}
              title="Blueprints Library"
            >
              <svg
                width="14"
                height="14"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth={2}
                strokeLinecap="round"
                strokeLinejoin="round"
                className="text-white/80"
              >
                <rect x="3" y="4" width="7" height="5" rx="1" />
                <rect x="14" y="4" width="7" height="5" rx="1" />
                <rect x="3" y="15" width="7" height="5" rx="1" />
                <rect x="14" y="15" width="7" height="5" rx="1" />
                <path d="M10 6.5h4M10 17.5h4M6.5 9v6M17.5 9v6" />
              </svg>
            </button>
          </div>
        ) : (
          <EnginePickerButton
            selectedEngine={selectedEngine ?? null}
            onEngineChange={onEngineChange}
          />
        )
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
            <img
              src={robotImage}
              alt={`Robot ${currentStatus}`}
              className={`w-5 h-5 object-cover rounded-full ring-1 ring-white/50 ${isLoading ? 'animate-pulse' : ''}`}
            />
            <span>Ask</span>
          </>
        )}
      </button>

      {/* Settings Button (Right) — badge reflects update state */}
      <button
        onClick={handleSettingsOrUpdate}
        className="relative w-8 h-8 rounded-full bg-white/[0.08] hover:bg-white/[0.15] flex items-center justify-center no-drag transition-all duration-200"
        title={
          updateReady ? 'New update ready — click to restart' :
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
