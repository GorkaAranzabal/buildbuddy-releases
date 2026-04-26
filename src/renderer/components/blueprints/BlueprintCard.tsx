import React from 'react';
import type { BlueprintSnippet } from '../../../shared/blueprints/types';
import { CATEGORY_COLORS } from '../../../shared/blueprints/categoryMap';

interface BlueprintCardProps {
  snippet: BlueprintSnippet;
  locked: boolean;
  onSelect: () => void;
  onLockedClick: () => void;
}

export function BlueprintCard({ snippet, locked, onSelect, onLockedClick }: BlueprintCardProps) {
  const accent =
    CATEGORY_COLORS[snippet.category as keyof typeof CATEGORY_COLORS] ?? CATEGORY_COLORS.Unknown;

  return (
    <button
      onClick={locked ? onLockedClick : onSelect}
      className="w-full text-left p-3 bg-zinc-800/50 hover:bg-zinc-800/70 rounded-lg border border-white/[0.06] transition-all group"
    >
      <div className="flex items-start gap-2">
        <span
          className="inline-block w-1 rounded-full flex-shrink-0 self-stretch"
          style={{ background: accent, minHeight: 36 }}
        />
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <h4 className="text-sm text-white/90 font-medium truncate">{snippet.title}</h4>
            {locked && (
              <svg
                className="w-3.5 h-3.5 text-amber-400 flex-shrink-0"
                fill="currentColor"
                viewBox="0 0 20 20"
              >
                <path
                  fillRule="evenodd"
                  d="M5 9V7a5 5 0 0110 0v2h1a2 2 0 012 2v7a2 2 0 01-2 2H4a2 2 0 01-2-2v-7a2 2 0 012-2h1zm2-2a3 3 0 116 0v2H7V7z"
                  clipRule="evenodd"
                />
              </svg>
            )}
          </div>
          <p className="text-[11px] text-white/50 mt-0.5 line-clamp-2">{snippet.description}</p>
          <div className="flex items-center gap-1.5 mt-1.5 flex-wrap">
            <span
              className="text-[10px] px-1.5 py-0.5 rounded"
              style={{ background: `${accent}33`, color: accent }}
            >
              {String(snippet.category)}
            </span>
            <span className="text-[10px] px-1.5 py-0.5 rounded bg-white/[0.06] text-white/50">
              → {snippet.target_blueprint}
            </span>
          </div>
        </div>
      </div>
    </button>
  );
}
