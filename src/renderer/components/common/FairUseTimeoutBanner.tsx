import React, { useState, useEffect } from 'react';

interface FairUseTimeoutBannerProps {
  unlockedAt: number;
  requestType: 'chat' | 'rc';
  onDismiss: () => void;
}

function formatCountdown(ms: number): string {
  const totalSeconds = Math.max(0, Math.ceil(ms / 1000));
  const mm = Math.floor(totalSeconds / 60);
  const ss = totalSeconds % 60;
  return `${mm}:${ss.toString().padStart(2, '0')}`;
}

export function FairUseTimeoutBanner({ unlockedAt, requestType, onDismiss }: FairUseTimeoutBannerProps) {
  const [remainingMs, setRemainingMs] = useState(() => Math.max(0, unlockedAt - Date.now()));

  useEffect(() => {
    const interval = setInterval(() => {
      const remaining = Math.max(0, unlockedAt - Date.now());
      setRemainingMs(remaining);
      if (remaining <= 0) {
        clearInterval(interval);
        onDismiss();
      }
    }, 1000);
    return () => clearInterval(interval);
  }, [unlockedAt, onDismiss]);

  const isRC = requestType === 'rc';
  const limitText = isRC ? '12 remote-control commands' : '30 chat messages';
  const title = isRC ? 'Remote control paused' : 'Chat paused';

  return (
    <div className="mx-4 mb-3 p-4 rounded-xl border border-orange-500/20 bg-orange-500/[0.06]">
      <div className="flex items-start gap-3">
        <div className="text-orange-400 mt-0.5 flex-shrink-0">
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <circle cx="12" cy="12" r="10" strokeWidth={1.8} />
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M12 6v6l4 2" />
          </svg>
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-white/90 text-sm font-medium mb-1">{title}</p>
          <p className="text-white/50 text-xs mb-3 leading-relaxed">
            You sent more than {limitText} in 10 minutes.
            {' '}Repeated bursts increase the cooldown (up to 60 min).
          </p>
          {remainingMs > 0 ? (
            <p className="text-orange-300/90 text-base font-mono font-semibold tracking-wide">
              {formatCountdown(remainingMs)}
            </p>
          ) : (
            <p className="text-green-300/80 text-xs">Timeout lifted — you can send again.</p>
          )}
          <button
            onClick={onDismiss}
            className="mt-2.5 text-white/30 hover:text-white/50 text-xs transition-colors"
          >
            Dismiss
          </button>
        </div>
      </div>
    </div>
  );
}
