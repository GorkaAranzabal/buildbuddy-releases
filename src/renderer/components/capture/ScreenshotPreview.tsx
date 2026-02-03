import React from 'react';
import type { CaptureResult } from '../../../shared/types';

interface ScreenshotPreviewProps {
  screenshot: CaptureResult;
  onRemove: () => void;
}

export function ScreenshotPreview({ screenshot, onRemove }: ScreenshotPreviewProps) {
  return (
    <div className="relative inline-block">
      <div className="relative group rounded-lg overflow-hidden border border-zinc-700 bg-zinc-800">
        {/* Thumbnail */}
        <img
          src={`data:image/png;base64,${screenshot.imageBase64}`}
          alt="Screenshot preview"
          className="h-16 w-auto object-cover"
        />

        {/* Overlay with info */}
        <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
          <div className="text-xs text-white text-center">
            <div>{screenshot.dimensions.width} × {screenshot.dimensions.height}</div>
            <div className="capitalize">{screenshot.mode}</div>
          </div>
        </div>

        {/* Remove button */}
        <button
          onClick={onRemove}
          className="absolute -top-2 -right-2 w-5 h-5 bg-red-500 hover:bg-red-400 rounded-full flex items-center justify-center text-white shadow-md transition-colors"
          title="Remove screenshot"
        >
          <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      </div>

      {/* Window title (if available) */}
      {screenshot.windowTitle && (
        <div className="mt-1 text-xs text-zinc-500 truncate max-w-[150px]">
          {screenshot.windowTitle}
        </div>
      )}
    </div>
  );
}
