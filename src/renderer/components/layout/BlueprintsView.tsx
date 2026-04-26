import React, { useEffect, useState } from 'react';
import { BlueprintsPanel } from '../blueprints/BlueprintsPanel';

interface BlueprintsViewProps {
  onClose: () => void;
  onBack: () => void;
}

export function BlueprintsView({ onClose, onBack }: BlueprintsViewProps) {
  const [selectedSnippetId, setSelectedSnippetId] = useState<string | null>(null);

  // Keep blueprint panels at the same size as the chat window so there's no
  // jarring resize when the user enters the library or opens a snippet.
  const panelWidth = '480px';
  const panelMaxHeight = '500px';
  const contentMaxHeight = '440px';
  const graphWidth = 432;
  const graphHeight = 150;

  useEffect(() => {
    window.electronAPI?.window?.resizeSettings?.(480, 560);
  }, []);

  return (
    <div
      className="mt-2 rounded-2xl border border-white/[0.12] overflow-hidden transition-all duration-200 ease-out"
      style={{
        background: 'rgba(0, 0, 0, 0.55)',
        backdropFilter: 'blur(80px) saturate(200%)',
        WebkitBackdropFilter: 'blur(80px) saturate(200%)',
        width: panelWidth,
        maxHeight: panelMaxHeight,
      }}
    >
      <div className="flex items-center justify-between px-4 py-3 border-b border-white/[0.08]">
        <button
          onClick={() => {
            if (selectedSnippetId) {
              setSelectedSnippetId(null);
            } else {
              onBack();
            }
          }}
          className="flex items-center gap-1 text-white/70 hover:text-white/90 text-sm transition-all"
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
          </svg>
          Back
        </button>
        <h2 className="text-white/90 font-medium">Blueprints</h2>
        <button
          onClick={onClose}
          className="w-6 h-6 rounded-full bg-white/[0.1] hover:bg-white/[0.15] flex items-center justify-center transition-all"
        >
          <svg className="w-3.5 h-3.5 text-white/70" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      </div>

      <div className="p-4 overflow-y-auto" style={{ maxHeight: contentMaxHeight }}>
        <BlueprintsPanel
          selectedId={selectedSnippetId}
          onSelect={setSelectedSnippetId}
          graphWidth={graphWidth}
          graphHeight={graphHeight}
        />
      </div>
    </div>
  );
}
