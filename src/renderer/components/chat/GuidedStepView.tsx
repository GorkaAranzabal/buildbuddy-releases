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

export function GuidedStepView() {
  const {
    guidedSteps,
    guidedCurrentStep,
    guidedVerification,
    guidedGoal,
    guidedIsComplete,
    setGuidedVerification,
    exitGuidedMode,
    appendGuidedStep,
    markGuidedComplete,
  } = useAppStore();

  const [isVerifying, setIsVerifying] = useState(false);
  const [fadeIn, setFadeIn] = useState(false);
  const dismissTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    requestAnimationFrame(() => setFadeIn(true));
  }, []);

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

    setIsVerifying(true);
    window.electronAPI?.vignette?.show();
    try {
      const screenshot = await window.electronAPI.capture.fullscreenNoHide();
      const result = await window.electronAPI.ai.generateNextStep({
        goal: guidedGoal ?? '',
        currentStep: guidedSteps[guidedCurrentStep],
        stepHistory: guidedSteps.slice(0, guidedCurrentStep),
        screenshot,
      });
      if (result.isComplete) {
        setGuidedVerification(result.completionMessage ?? 'All done!');
        markGuidedComplete();
      } else if (result.nextStep) {
        appendGuidedStep(result.nextStep);
      }
    } catch (err) {
      console.error('Next step generation failed:', err);
    }
    window.electronAPI?.vignette?.hide();
    setIsVerifying(false);
  }, [guidedGoal, guidedSteps, guidedCurrentStep, appendGuidedStep, markGuidedComplete, setGuidedVerification]);

  const handleDone = useCallback(() => {
    exitGuidedMode();
  }, [exitGuidedMode]);

  const handleShowAll = useCallback(() => {
    exitGuidedMode();
  }, [exitGuidedMode]);

  if (!guidedSteps || guidedSteps.length === 0) return null;

  const currentStepText = guidedSteps[guidedCurrentStep];
  const knownStepCount = guidedSteps.length;

  return (
    <div
      className={`relative flex flex-col gap-3 px-4 py-4 transition-opacity duration-300 ${fadeIn ? 'opacity-100' : 'opacity-0'}`}
    >
      {/* Back to chat icon */}
      <button
        onClick={handleShowAll}
        className="absolute top-3 right-3 w-5 h-5 rounded-full bg-white/[0.06] hover:bg-white/[0.12] flex items-center justify-center transition-all group"
        title="Back to chat"
      >
        <svg className="w-2.5 h-2.5 text-white/40 group-hover:text-white/60" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
        </svg>
      </button>

      {/* Step indicator pill */}
      <div className="flex justify-center">
        <span className="inline-flex items-center px-3 py-1 rounded-full bg-blue-500/15 border border-blue-400/25 text-blue-300 text-xs font-medium">
          Step {guidedCurrentStep + 1}
        </span>
      </div>

      {/* Verification feedback (from previous step) */}
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

      {/* Progress dots — only for known steps so far */}
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
        {/* Trailing dot hint that more steps may come */}
        {!guidedIsComplete && (
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
            disabled={isVerifying}
            className="flex-1 flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl bg-blue-500 hover:bg-blue-400 text-white text-sm font-medium transition-all disabled:opacity-50"
          >
            {isVerifying ? (
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
          disabled={isVerifying}
          className="px-4 py-2.5 rounded-xl bg-transparent hover:bg-white/[0.06] border border-white/[0.12] text-white/60 hover:text-white/80 text-sm font-medium transition-all disabled:opacity-50"
        >
          Back to chat
        </button>
      </div>
    </div>
  );
}
