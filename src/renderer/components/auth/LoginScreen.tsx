import React, { useState, useEffect, useRef } from 'react';

interface LoginScreenProps {
  onLogin: (email: string) => Promise<void>;
  isLoading: boolean;
  error: string | null;
}

type Step = 'email' | 'plan' | 'waiting';

const POLL_INTERVAL_MS = 5000; // Check every 5 seconds

export function LoginScreen({ onLogin, isLoading, error }: LoginScreenProps) {
  const [email, setEmail] = useState('');
  const [step, setStep] = useState<Step>('email');
  const [pollStatus, setPollStatus] = useState<'polling' | 'confirmed' | 'error'>('polling');
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const isMountedRef = useRef(true);

  const [isCheckingEmail, setIsCheckingEmail] = useState(false);

  const isValidEmail = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);

  // Cleanup polling on unmount
  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
      if (pollRef.current) {
        clearInterval(pollRef.current);
        pollRef.current = null;
      }
    };
  }, []);

  const startPolling = () => {
    if (pollRef.current) clearInterval(pollRef.current);

    setPollStatus('polling');

    pollRef.current = setInterval(async () => {
      try {
        const entitlement = await window.electronAPI.auth.checkEntitlement(email.trim());
        if (entitlement?.active) {
          // Payment confirmed — stop polling and log in as pro
          if (pollRef.current) {
            clearInterval(pollRef.current);
            pollRef.current = null;
          }
          if (isMountedRef.current) {
            setPollStatus('confirmed');
            // Auto-login after short delay so user sees the confirmation
            setTimeout(() => {
              if (isMountedRef.current) {
                onLogin(email.trim());
              }
            }, 1500);
          }
        }
      } catch {
        // Silently continue polling — API might be temporarily unavailable
      }
    }, POLL_INTERVAL_MS);
  };

  const stopPolling = () => {
    if (pollRef.current) {
      clearInterval(pollRef.current);
      pollRef.current = null;
    }
  };

  const handleEmailSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!isValidEmail) return;

    setIsCheckingEmail(true);
    try {
      const entitlement = await window.electronAPI.auth.checkEntitlement(email.trim().toLowerCase());
      if (entitlement?.active) {
        // Already Pro — skip plan selection and log straight in
        await onLogin(email.trim().toLowerCase());
        return;
      }
    } catch {
      // API failure — fall through to plan selection safely
    } finally {
      setIsCheckingEmail(false);
    }

    setStep('plan');
  };

  const handleFreePlan = async () => {
    await onLogin(email.trim());
  };

  const handleProPlan = () => {
    window.electronAPI?.analytics?.track('upgrade_clicked', { source: 'login_screen' });
    // Open pricing page and switch to waiting step
    window.open('https://build-buddy.app/pricing', '_blank');
    setStep('waiting');
    startPolling();
  };

  const handleContinueAsFree = async () => {
    stopPolling();
    await onLogin(email.trim());
  };

  const handleBackToPlan = () => {
    stopPolling();
    setStep('plan');
  };

  return (
    <div
      className="mt-2 rounded-2xl border border-white/[0.12] overflow-hidden animate-in"
      style={{
        background: 'rgba(0, 0, 0, 0.78)',
        backdropFilter: 'blur(80px) saturate(200%)',
        WebkitBackdropFilter: 'blur(80px) saturate(200%)',
        width: '480px',
      }}
    >
      {/* Header */}
      <div className="px-6 pt-6 pb-4 text-center">
        <h1 className="text-white/95 text-lg font-semibold mb-1">
          Welcome to Build Buddy
        </h1>
        <p className="text-white/50 text-sm">
          {step === 'email' && 'Enter your email to get started'}
          {step === 'plan' && 'Choose your plan'}
          {step === 'waiting' && 'Complete your purchase'}
        </p>
      </div>

      {/* Step 1: Email */}
      {step === 'email' && (
        <form onSubmit={handleEmailSubmit} className="px-6 pb-6 space-y-4">
          <div className="space-y-2">
            <label className="text-white/70 text-sm" htmlFor="login-email">
              Email address
            </label>
            <input
              id="login-email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@example.com"
              autoFocus
              className="w-full px-4 py-3 bg-white/[0.06] border border-white/[0.1] rounded-xl text-sm text-white/95 placeholder-white/40 focus:outline-none focus:border-white/20 transition-all"
            />
          </div>

          {error && (
            <div className="px-3 py-2 rounded-lg bg-red-500/10 border border-red-500/20 text-red-400 text-xs">
              {error}
            </div>
          )}

          <button
            type="submit"
            disabled={!isValidEmail || isCheckingEmail}
            className="w-full px-4 py-3 bg-blue-500 hover:bg-blue-400 disabled:bg-white/[0.08] disabled:text-white/40 rounded-xl text-white text-sm font-medium transition-all"
          >
            {isCheckingEmail ? (
              <span className="flex items-center justify-center gap-2">
                <div className="w-3.5 h-3.5 border-2 border-white/50 border-t-transparent rounded-full animate-spin" />
                Checking...
              </span>
            ) : (
              'Continue'
            )}
          </button>
        </form>
      )}

      {/* Step 2: Plan Selection */}
      {step === 'plan' && (
        <div className="px-6 pb-6 space-y-3">
          {/* Email display with back button */}
          <button
            onClick={() => setStep('email')}
            className="flex items-center gap-1.5 text-white/40 hover:text-white/60 text-xs transition-all mb-2"
          >
            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
            </svg>
            {email}
          </button>

          {error && (
            <div className="px-3 py-2 rounded-lg bg-red-500/10 border border-red-500/20 text-red-400 text-xs">
              {error}
            </div>
          )}

          {/* Plan cards */}
          <div className="flex gap-3">
            {/* Free Plan */}
            <div className="flex-1 rounded-xl border border-white/[0.1] bg-white/[0.03] p-4 flex flex-col">
              <h3 className="text-white/90 text-sm font-semibold">Free</h3>
              <p className="text-white/70 text-lg font-bold mt-1">$0</p>
              <div className="mt-3 space-y-2 flex-1">
                <div className="flex items-center gap-2">
                  <svg className="w-3.5 h-3.5 text-white/30 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                  </svg>
                  <span className="text-white/50 text-xs">10 asks / day</span>
                </div>
                <div className="flex items-center gap-2">
                  <svg className="w-3.5 h-3.5 text-white/30 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                  </svg>
                  <span className="text-white/50 text-xs">Screenshot analysis</span>
                </div>
              </div>
              <button
                onClick={handleFreePlan}
                disabled={isLoading}
                className="mt-4 w-full px-3 py-2.5 bg-white/[0.06] hover:bg-white/[0.1] border border-white/[0.1] rounded-lg text-white/80 text-xs font-semibold transition-all disabled:opacity-50"
              >
                {isLoading ? (
                  <span className="flex items-center justify-center gap-2">
                    <div className="w-3 h-3 border-2 border-white/50 border-t-transparent rounded-full animate-spin" />
                    Loading...
                  </span>
                ) : (
                  'GET STARTED'
                )}
              </button>
            </div>

            {/* Pro Plan */}
            <div className="flex-1 rounded-xl border border-blue-500/30 bg-blue-500/[0.04] p-4 flex flex-col relative">
              <div className="absolute -top-2 right-3 px-2 py-0.5 bg-blue-500 rounded text-[10px] font-bold text-white uppercase">
                Popular
              </div>
              <h3 className="text-white/90 text-sm font-semibold">Pro</h3>
              <div className="flex items-baseline gap-0.5 mt-1">
                <p className="text-white/90 text-lg font-bold">$19</p>
                <span className="text-white/40 text-xs">/mo</span>
              </div>
              <div className="mt-3 space-y-2 flex-1">
                <div className="flex items-center gap-2">
                  <svg className="w-3.5 h-3.5 text-blue-400 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                  </svg>
                  <span className="text-white/70 text-xs font-medium">Unlimited asks</span>
                </div>
                <div className="flex items-center gap-2">
                  <svg className="w-3.5 h-3.5 text-blue-400 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                  </svg>
                  <span className="text-white/70 text-xs font-medium">Faster responses</span>
                </div>
                <div className="flex items-center gap-2">
                  <svg className="w-3.5 h-3.5 text-blue-400 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                  </svg>
                  <span className="text-white/70 text-xs font-medium">Best model</span>
                </div>
              </div>
              <button
                onClick={handleProPlan}
                disabled={isLoading}
                className="mt-4 w-full px-3 py-2.5 bg-white hover:bg-white/90 rounded-lg text-black text-xs font-bold transition-all disabled:opacity-50"
              >
                SUBSCRIBE
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Step 3: Waiting for Payment */}
      {step === 'waiting' && (
        <div className="px-6 pb-6 space-y-4">
          {/* Back button */}
          <button
            onClick={handleBackToPlan}
            className="flex items-center gap-1.5 text-white/40 hover:text-white/60 text-xs transition-all"
          >
            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
            </svg>
            Back
          </button>

          {pollStatus === 'confirmed' ? (
            /* Payment confirmed */
            <div className="text-center py-4 space-y-3">
              <div className="w-12 h-12 mx-auto rounded-full bg-green-500/20 flex items-center justify-center">
                <svg className="w-6 h-6 text-green-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                </svg>
              </div>
              <div>
                <p className="text-green-400 text-sm font-semibold">Payment confirmed!</p>
                <p className="text-white/50 text-xs mt-1">Signing you in as Pro...</p>
              </div>
              <div className="flex items-center justify-center">
                <div className="w-4 h-4 border-2 border-green-400/50 border-t-transparent rounded-full animate-spin" />
              </div>
            </div>
          ) : (
            /* Waiting for payment */
            <div className="text-center py-2 space-y-4">
              {/* Animated waiting indicator */}
              <div className="w-12 h-12 mx-auto rounded-full bg-blue-500/15 flex items-center justify-center">
                <div className="w-6 h-6 border-2 border-blue-400 border-t-transparent rounded-full animate-spin" />
              </div>

              <div className="space-y-1.5">
                <p className="text-white/90 text-sm font-medium">
                  Waiting for payment...
                </p>
                <p className="text-white/45 text-xs leading-relaxed max-w-[320px] mx-auto">
                  Complete your purchase in the browser.
                  The app will automatically detect your subscription.
                </p>
              </div>

              {/* Re-open pricing link */}
              <button
                onClick={() => {
                  window.electronAPI?.analytics?.track('upgrade_clicked', { source: 'login_screen' });
                  window.open('https://build-buddy.app/pricing', '_blank');
                }}
                className="inline-flex items-center gap-1.5 text-blue-400 hover:text-blue-300 text-xs font-medium transition-all"
              >
                <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
                </svg>
                Open pricing page again
              </button>

              {/* Divider */}
              <div className="flex items-center gap-3 pt-1">
                <div className="flex-1 h-px bg-white/[0.08]" />
                <span className="text-white/30 text-[10px] uppercase tracking-wider">or</span>
                <div className="flex-1 h-px bg-white/[0.08]" />
              </div>

              {/* Continue as free fallback */}
              <button
                onClick={handleContinueAsFree}
                disabled={isLoading}
                className="w-full px-3 py-2.5 bg-white/[0.06] hover:bg-white/[0.1] border border-white/[0.1] rounded-lg text-white/60 text-xs font-medium transition-all disabled:opacity-50"
              >
                {isLoading ? (
                  <span className="flex items-center justify-center gap-2">
                    <div className="w-3 h-3 border-2 border-white/50 border-t-transparent rounded-full animate-spin" />
                    Loading...
                  </span>
                ) : (
                  'Continue with Free plan instead'
                )}
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
