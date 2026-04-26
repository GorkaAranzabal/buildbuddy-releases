import React, { useState } from 'react';
import { useAppStore } from '../../store';

interface UpgradePromptProps {
  onDismiss: () => void;
  title?: string;
  message?: string;
}

export function UpgradePrompt({ onDismiss, title, message }: UpgradePromptProps) {
  const { authState, setAuthState } = useAppStore();
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [refreshed, setRefreshed] = useState(false);

  const handleUpgrade = () => {
    window.electronAPI?.analytics?.track('upgrade_clicked', { source: 'upgrade_prompt' });
    window.open('https://build-buddy.app/pricing', '_blank');
  };

  const handleRefreshPlan = async () => {
    if (!authState?.email) return;
    setIsRefreshing(true);
    try {
      const entitlement = await window.electronAPI.auth.checkEntitlement(authState.email);
      setAuthState({ ...authState, entitlement });
      if (entitlement.active) {
        // Plan is now active — dismiss the prompt
        onDismiss();
        return;
      }
    } catch {
      // ignore
    }
    setIsRefreshing(false);
    setRefreshed(true);
  };

  return (
    <div className="mx-4 mb-3 p-4 rounded-xl border border-amber-500/20 bg-amber-500/[0.06]">
      <div className="flex items-start gap-3">
        <div className="text-amber-400 text-lg mt-0.5">
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
              d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
          </svg>
        </div>
        <div className="flex-1">
          <p className="text-white/90 text-sm font-medium mb-1">
            {title || 'Weekly limit reached'}
          </p>
          <p className="text-white/50 text-xs mb-3">
            {message || "You've used all your free asks for this week. Upgrade to Pro for unlimited asks and the best AI model."}
          </p>
          {refreshed && (
            <p className="text-white/40 text-xs mb-2">Plan is still showing as free. If you just upgraded, wait a minute and try again.</p>
          )}
          <div className="flex items-center gap-2 flex-wrap">
            <button
              onClick={handleUpgrade}
              className="px-4 py-1.5 bg-amber-500 hover:bg-amber-400 rounded-lg text-black text-xs font-semibold transition-all"
            >
              Upgrade to Pro
            </button>
            {authState?.email && (
              <button
                onClick={handleRefreshPlan}
                disabled={isRefreshing}
                className="px-3 py-1.5 text-white/50 hover:text-white/80 text-xs transition-all disabled:opacity-50"
              >
                {isRefreshing ? 'Checking...' : 'Already upgraded? Refresh'}
              </button>
            )}
            <button
              onClick={onDismiss}
              className="px-3 py-1.5 text-white/40 hover:text-white/60 text-xs transition-all"
            >
              Dismiss
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
