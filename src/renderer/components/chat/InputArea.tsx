import React, { useState, useRef, useEffect } from 'react';
import { useAppStore } from '../../store';
import { CaptureButton } from '../capture/CaptureButton';
import { ScreenshotPreview } from '../capture/ScreenshotPreview';

interface InputAreaProps {
  onSend: (prompt: string) => void;
  isLoading: boolean;
}

export function InputArea({ onSend, isLoading }: InputAreaProps) {
  const [input, setInput] = useState('');
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const attachedScreenshot = useAppStore((state) => state.attachedScreenshot);
  const setAttachedScreenshot = useAppStore((state) => state.setAttachedScreenshot);

  // Auto-resize textarea
  useEffect(() => {
    const textarea = textareaRef.current;
    if (textarea) {
      textarea.style.height = 'auto';
      textarea.style.height = `${Math.min(textarea.scrollHeight, 120)}px`;
    }
  }, [input]);

  // Focus input on hotkey
  useEffect(() => {
    const unsubscribe = window.electronAPI.onFocusInput(() => {
      textareaRef.current?.focus();
    });

    return () => {
      unsubscribe();
    };
  }, []);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (input.trim() && !isLoading) {
      onSend(input.trim());
      setInput('');
      // Reset textarea height
      if (textareaRef.current) {
        textareaRef.current.style.height = 'auto';
      }
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSubmit(e);
    }
  };

  const handleRemoveScreenshot = () => {
    setAttachedScreenshot(null);
  };

  return (
    <form onSubmit={handleSubmit} className="border-t border-white/[0.1] p-3">
      {/* Screenshot preview */}
      {attachedScreenshot && (
        <div className="mb-2">
          <ScreenshotPreview screenshot={attachedScreenshot} onRemove={handleRemoveScreenshot} />
        </div>
      )}

      {/* Input row */}
      <div className="flex items-end gap-2">
        {/* Capture button */}
        <CaptureButton />

        {/* Text input */}
        <div className="flex-1 relative">
          <textarea
            ref={textareaRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="What are you trying to do?"
            disabled={isLoading}
            rows={1}
            className="w-full px-4 py-2.5 bg-white/[0.04] border border-white/[0.12] rounded-xl text-sm text-white/95 placeholder-white/40 resize-none focus:outline-none focus:border-white/25 focus:bg-white/[0.06] disabled:opacity-50 disabled:cursor-not-allowed transition-all duration-200"
          />
        </div>

        {/* Send button */}
        <button
          type="submit"
          disabled={!input.trim() || isLoading}
          className="px-4 py-2.5 bg-white/[0.06] hover:bg-white/[0.1] disabled:bg-white/[0.02] disabled:text-white/30 text-white/90 text-sm font-medium rounded-xl transition-all duration-200 flex items-center gap-2 border border-white/[0.12] hover:border-white/[0.2] disabled:border-white/[0.06]"
        >
          {isLoading ? (
            <>
              <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
                <circle
                  className="opacity-25"
                  cx="12"
                  cy="12"
                  r="10"
                  stroke="currentColor"
                  strokeWidth="4"
                />
                <path
                  className="opacity-75"
                  fill="currentColor"
                  d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
                />
              </svg>
              <span>Asking...</span>
            </>
          ) : (
            <>
              <span>Ask</span>
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M13 5l7 7-7 7M5 5l7 7-7 7"
                />
              </svg>
            </>
          )}
        </button>
      </div>

      {/* Hint */}
      <div className="mt-2 text-xs text-zinc-500">
        Press Enter to send, Shift+Enter for new line
      </div>
    </form>
  );
}
