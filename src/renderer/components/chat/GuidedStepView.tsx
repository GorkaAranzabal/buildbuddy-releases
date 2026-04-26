import React, { useState, useEffect, useCallback, useRef } from 'react';
import ReactMarkdown from 'react-markdown';
import { useAppStore } from '../../store';

const HighlightedKeyword = ({ children }: { children: React.ReactNode }) => (
  <span className="inline-flex items-center px-2 py-0.5 mx-0.5 rounded-md bg-blue-500/20 text-[#60a5fa] font-semibold border border-blue-400/40">
    {children}
  </span>
);

const markdownComponents = {
  code: ({ children, className }: { children: React.ReactNode; className?: string }) => {
    if (!className) {
      return <HighlightedKeyword>{children}</HighlightedKeyword>;
    }
    return <code className={className}>{children}</code>;
  },
  strong: ({ children }: { children: React.ReactNode }) => (
    <span className="font-semibold text-blue-300">{children}</span>
  ),
};

const VERIFICATION_DISMISS_MS = 8000;

function extractYouTubeVideoId(url: string): string | null {
  const m = url.match(/(?:youtube\.com\/(?:watch\?v=|shorts\/)|youtu\.be\/)([a-zA-Z0-9_-]{11})/);
  return m ? m[1] : null;
}

export function GuidedStepView() {
  const {
    guidedSteps,
    guidedCurrentStep,
    guidedVerification,
    guidedGoal,
    guidedIsComplete,
    guidedVideoUrl,
    guidedStepTimestamps,
    setGuidedVerification,
    exitGuidedMode,
    appendGuidedStep,
    markGuidedComplete,
    setGuidedStep,
  } = useAppStore();

  const [isVerifying, setIsVerifying] = useState(false);
  // In video mode, start as "watching" so cursor doesn't fire before first pause
  const [videoWatching, setVideoWatching] = useState(() => !!guidedVideoUrl);
  const [fadeIn, setFadeIn] = useState(false);
  const dismissTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const cursorManagedByMainRef = useRef(false);

  // YouTube video control refs
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const videoWaitingRef = useRef(true);
  const currentStepRef = useRef(guidedCurrentStep);
  const timestampsRef = useRef<number[]>([]);
  const guidedStepsRef = useRef(guidedSteps); // stale-closure-free access inside message handler

  // Keep refs in sync
  useEffect(() => { currentStepRef.current = guidedCurrentStep; }, [guidedCurrentStep]);
  useEffect(() => { timestampsRef.current = guidedStepTimestamps ?? []; }, [guidedStepTimestamps]);
  useEffect(() => { guidedStepsRef.current = guidedSteps; }, [guidedSteps]);

  useEffect(() => {
    requestAnimationFrame(() => setFadeIn(true));
  }, []);

  // Disable focus stealing while in guided mode
  useEffect(() => {
    window.electronAPI?.window?.setFocusable(false);
    return () => {
      window.electronAPI?.window?.setFocusable(true);
    };
  }, []);

  // Hide cursor when guided mode exits
  useEffect(() => {
    return () => {
      window.electronAPI?.cursor?.hide();
    };
  }, []);

  // Expand window for video mode; restore on exit
  useEffect(() => {
    if (!guidedVideoUrl) return;
    window.electronAPI?.window?.enterVideoMode();
    return () => {
      window.electronAPI?.window?.exitVideoMode();
    };
  }, [!!guidedVideoUrl]);

  // postMessage helpers for YouTube iframe
  const postToYT = useCallback((data: object) => {
    iframeRef.current?.contentWindow?.postMessage(JSON.stringify(data), '*');
  }, []);

  const pauseVideo = useCallback(() => {
    postToYT({ event: 'command', func: 'pauseVideo', args: '' });
  }, [postToYT]);

  const playVideo = useCallback(() => {
    postToYT({ event: 'command', func: 'playVideo', args: '' });
  }, [postToYT]);

  // YouTube postMessage listener — auto-pauses at each step's timestamp
  useEffect(() => {
    if (!guidedVideoUrl) return;

    const handleMessage = (event: MessageEvent) => {
      if (event.origin !== 'https://www.youtube-nocookie.com') return;
      try {
        const data = typeof event.data === 'string' ? JSON.parse(event.data) : event.data;

        // Authoritative end-of-video signal from the YouTube IFrame API.
        // YT.PlayerState.ENDED === 0. Fires only when the player actually reaches the end,
        // so "Done" tracks the real video length rather than the last AI-generated pauseAt.
        if (data.event === 'onStateChange' && data.info === 0) {
          markGuidedComplete();
          return;
        }

        if (data.event !== 'infoDelivery' || !videoWaitingRef.current) return;
        const currentTime: number = data.info?.currentTime ?? 0;
        const currentIdx = currentStepRef.current;
        const timestamps = timestampsRef.current;

        // timestamps[] here are "pauseAt" values — the AI-identified moment when the
        // instructor finishes the demo, so we pause exactly at the right time.
        if (currentIdx < timestamps.length && currentTime >= timestamps[currentIdx]) {
          videoWaitingRef.current = false;
          setVideoWatching(false);
          pauseVideo();
          // Trigger cursor directly from the message handler — avoids React batching /
          // effect-cancellation race conditions that prevent cursor from showing via useEffect.
          const stepText = guidedStepsRef.current?.[currentIdx];
          console.log('[cursor] pause fired idx=', currentIdx, 'stepText=', stepText ? stepText.slice(0, 60) : 'UNDEFINED/EMPTY');
          if (stepText) {
            (async () => {
              try {
                console.log('[cursor] taking screenshot...');
                const screenshot = await window.electronAPI.capture.fullscreenNoHide();
                if (!screenshot) { console.warn('[cursor] screenshot null'); return; }
                console.log('[cursor] screenshot ok, calling generateClickTarget...');
                const target = await window.electronAPI.ai.generateClickTarget({ stepText, screenshot });
                console.log('[cursor] target:', target
                  ? `conf=${target.confidence?.toFixed(2)} xy=(${target.xRatio?.toFixed(2)},${target.yRatio?.toFixed(2)})`
                  : 'null');
                if (!target || target.confidence < 0.15) return;
                console.log('[cursor] calling cursor.show...');
                await window.electronAPI.cursor.show({
                  xRatio: target.xRatio,
                  yRatio: target.yRatio,
                  label: target.description ?? '',
                  displayBounds: screenshot.displayBounds,
                });
                console.log('[cursor] cursor.show done');
              } catch (err) {
                console.error('[cursor] failed:', err);
              }
            })();
          }
        }
        // Past the last AI-generated step but the video is still playing — leave the
        // listener armed (videoWaitingRef stays true) so the onStateChange ENDED branch
        // above can fire when the player actually reaches the end.
      } catch {
        // ignore malformed messages
      }
    };

    window.addEventListener('message', handleMessage);

    // When the user switches to another app (Unreal etc.), YouTube may pause via Page Visibility API.
    // When they switch back, resume the video so it can reach the next timestamp.
    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible' && videoWaitingRef.current) {
        setTimeout(() => playVideo(), 200);
      }
    };
    document.addEventListener('visibilitychange', handleVisibilityChange);

    const initTimer = setTimeout(() => {
      postToYT({ event: 'listening', id: 'yt-guided', channel: 'widget' });
    }, 800);

    return () => {
      window.removeEventListener('message', handleMessage);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      clearTimeout(initTimer);
    };
  }, [guidedVideoUrl, pauseVideo, markGuidedComplete, postToYT]);

  // Point cursor at the target element — regular (non-video) mode only.
  // In video mode the cursor is fired directly from the message handler to avoid
  // React batching / effect-cancellation race conditions.
  useEffect(() => {
    if (guidedVideoUrl) return; // video mode: cursor handled in message handler
    if (!guidedSteps || guidedSteps.length === 0) return;
    const stepText = guidedSteps[guidedCurrentStep];
    if (!stepText) return;

    let cancelled = false;

    if (cursorManagedByMainRef.current) {
      cursorManagedByMainRef.current = false;
      return;
    }

    (async () => {
      try {
        const screenshot = await window.electronAPI.capture.fullscreenNoHide();
        if (cancelled || !screenshot) return;

        const target = await window.electronAPI.ai.generateClickTarget({ stepText, screenshot });
        if (cancelled || !target || target.confidence < 0.3) {
          window.electronAPI?.cursor?.hide();
          return;
        }

        await window.electronAPI.cursor.show({
          xRatio: target.xRatio,
          yRatio: target.yRatio,
          label: target.description ?? '',
          displayBounds: screenshot.displayBounds,
        });
      } catch (err) {
        console.error('[GuidedStepView] cursor positioning failed:', err);
      }
    })();

    return () => { cancelled = true; };
  }, [guidedCurrentStep, guidedSteps, guidedVideoUrl]);

  // Auto-dismiss verification feedback
  useEffect(() => {
    if (dismissTimerRef.current) clearTimeout(dismissTimerRef.current);
    if (guidedVerification) {
      dismissTimerRef.current = setTimeout(() => {
        setGuidedVerification(null);
      }, VERIFICATION_DISMISS_MS);
    }
    return () => {
      if (dismissTimerRef.current) clearTimeout(dismissTimerRef.current);
    };
  }, [guidedVerification, setGuidedVerification]);

  const handleNext = useCallback(async () => {
    if (!guidedSteps) return;

    // VIDEO MODE — advance step, resume video; message handler pauses at next timestamp
    if (guidedVideoUrl && guidedStepTimestamps) {
      const nextIdx = guidedCurrentStep + 1;
      if (nextIdx >= guidedStepTimestamps.length) {
        markGuidedComplete();
        return;
      }
      window.electronAPI?.cursor?.hide();
      window.electronAPI?.cursor?.hide(); // hide cursor while video plays to next step
      setGuidedStep(nextIdx);
      videoWaitingRef.current = true;
      setVideoWatching(true);
      playVideo();
      return;
    }

    // REGULAR MODE
    setIsVerifying(true);
    window.electronAPI?.vignette?.show();
    const stepStartedAt = Date.now();
    const verifiedStepIndex = guidedCurrentStep;
    try {
      const screenshot = await window.electronAPI.capture.fullscreenNoHide();
      const result = await window.electronAPI.ai.generateNextStep({
        goal: guidedGoal ?? '',
        currentStep: guidedSteps[guidedCurrentStep],
        stepHistory: guidedSteps.slice(0, guidedCurrentStep),
        screenshot,
      });
      window.electronAPI?.analytics?.track('guided_step_verified', {
        stepIndex: verifiedStepIndex,
        success: !!(result.isComplete || result.nextStep),
        msSinceGenerated: Date.now() - stepStartedAt,
      });
      if (result.isComplete) {
        setGuidedVerification(result.completionMessage ?? 'All done!');
        markGuidedComplete();
      } else if (result.nextStep) {
        cursorManagedByMainRef.current = !!(result as any).cursorFiredByMain;
        appendGuidedStep(result.nextStep);
      }
    } catch (err) {
      console.error('Next step generation failed:', err);
      window.electronAPI?.analytics?.track('guided_step_verified', {
        stepIndex: verifiedStepIndex,
        success: false,
        msSinceGenerated: Date.now() - stepStartedAt,
      });
    }
    window.electronAPI?.vignette?.hide();
    setIsVerifying(false);
  }, [guidedVideoUrl, guidedStepTimestamps, guidedCurrentStep, guidedSteps, playVideo,
      guidedGoal, appendGuidedStep, markGuidedComplete, setGuidedVerification]);

  const handleDone = useCallback(() => {
    exitGuidedMode();
  }, [exitGuidedMode]);

  const handleShowAll = useCallback(() => {
    exitGuidedMode();
  }, [exitGuidedMode]);

  if (!guidedSteps || guidedSteps.length === 0) return null;

  const currentStepText = guidedSteps[guidedCurrentStep];
  const knownStepCount = guidedSteps.length;
  const isBusy = isVerifying || videoWatching;

  return (
    <div
      className={`relative flex flex-col gap-3 px-4 py-4 transition-opacity duration-300 ${fadeIn ? 'opacity-100' : 'opacity-0'}`}
    >

      {/* YouTube mini player */}
      {guidedVideoUrl && (() => {
        const vid = extractYouTubeVideoId(guidedVideoUrl);
        return vid ? (
          <div className="rounded-xl overflow-hidden border border-white/[0.1]" style={{ aspectRatio: '16/9' }}>
            <iframe
              ref={iframeRef}
              src={`https://www.youtube-nocookie.com/embed/${vid}?controls=1&rel=0&modestbranding=1&autoplay=1&enablejsapi=1`}
              width="100%"
              height="100%"
              style={{ border: 'none', display: 'block' }}
              allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
              allowFullScreen
            />
          </div>
        ) : null;
      })()}

      {/* Step indicator pill */}
      <div className="flex justify-center">
        <span className="inline-flex items-center px-3 py-1 rounded-full bg-blue-500/15 border border-blue-400/25 text-blue-300 text-xs font-medium">
          {guidedVideoUrl ? `Video Step ${guidedCurrentStep + 1}` : `Step ${guidedCurrentStep + 1}`}
        </span>
      </div>

      {/* While video playing: show hint. When paused: show full step UI. */}
      {videoWatching ? (
        <div className="flex items-center justify-center gap-2 px-4 py-3 rounded-2xl bg-white/[0.04] border border-white/[0.06]">
          <div className="w-2 h-2 rounded-full bg-blue-400 animate-pulse flex-shrink-0" />
          <span className="text-white/50 text-sm">Watch the video…</span>
        </div>
      ) : (
        <>
          {/* Verification feedback */}
          {guidedVerification && (
            <div
              className="flex items-start gap-2 px-3 py-2 rounded-xl bg-white/[0.04] border border-white/[0.06] cursor-pointer transition-opacity duration-300"
              onClick={() => setGuidedVerification(null)}
            >
              <span className="text-white/40 text-xs leading-relaxed">{guidedVerification}</span>
              <button className="text-white/20 hover:text-white/40 text-xs flex-shrink-0 mt-0.5">
                &times;
              </button>
            </div>
          )}

          {/* Step content */}
          <div className="rounded-2xl bg-white/[0.06] border border-white/[0.1] px-4 py-3">
            <div className="markdown-content text-sm text-white/90">
              <ReactMarkdown components={markdownComponents}>{currentStepText}</ReactMarkdown>
            </div>
          </div>

          {/* Progress dots */}
          <div className="flex justify-center gap-1.5">
            {Array.from({ length: knownStepCount }).map((_, idx) => (
              <div
                key={idx}
                className={`w-1.5 h-1.5 rounded-full transition-all duration-300 ${
                  idx === guidedCurrentStep
                    ? 'bg-blue-400 scale-125'
                    : idx < guidedCurrentStep
                      ? 'bg-blue-400/40'
                      : 'bg-white/15'
                }`}
              />
            ))}
            {!guidedIsComplete && !guidedVideoUrl && (
              <div className="w-1.5 h-1.5 rounded-full bg-white/10" />
            )}
          </div>

          {/* Action buttons */}
          <div className="flex items-center gap-2">
            {guidedIsComplete ? (
              <button
                onClick={handleDone}
                className="flex-1 flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl bg-emerald-500/20 hover:bg-emerald-500/30 border border-emerald-400/30 text-emerald-300 text-sm font-medium transition-all"
              >
                <span>Done</span>
                <span>&#10003;</span>
              </button>
            ) : (
              <button
                onClick={handleNext}
                disabled={isBusy}
                className="flex-1 flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl bg-blue-500 hover:bg-blue-400 text-white text-sm font-medium transition-all disabled:opacity-50"
              >
                {isBusy ? (
                  <div className="w-3.5 h-3.5 border-2 border-white/50 border-t-transparent rounded-full animate-spin" />
                ) : (
                  <>
                    <span>Next step</span>
                    <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                    </svg>
                  </>
                )}
              </button>
            )}

            <button
              onClick={handleShowAll}
              disabled={isBusy}
              className="px-4 py-2.5 rounded-xl bg-transparent hover:bg-white/[0.06] border border-white/[0.12] text-white/60 hover:text-white/80 text-sm font-medium transition-all disabled:opacity-50"
            >
              Back to chat
            </button>
          </div>
        </>
      )}
    </div>
  );
}
