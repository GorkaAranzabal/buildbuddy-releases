import React from 'react';
import type { BlueprintSnippet } from '../../../shared/blueprints/types';
import { CATEGORY_COLORS } from '../../../shared/blueprints/categoryMap';

interface BlueprintTileProps {
  snippet: BlueprintSnippet;
  locked: boolean;
  onSelect: () => void;
  onLockedClick: () => void;
}

export function BlueprintTile({ snippet, locked, onSelect, onLockedClick }: BlueprintTileProps) {
  const accent =
    CATEGORY_COLORS[snippet.category as keyof typeof CATEGORY_COLORS] ?? CATEGORY_COLORS.Unknown;

  return (
    <button
      onClick={locked ? onLockedClick : onSelect}
      className="relative text-left p-2.5 bg-zinc-800/50 hover:bg-zinc-800/70 rounded-lg border border-white/[0.06] transition-all group flex flex-col gap-1.5 min-h-[72px]"
    >
      <span
        className="absolute left-0 top-2 bottom-2 w-0.5 rounded-r-full"
        style={{ background: accent }}
      />
      <div className="flex items-center gap-1.5 pl-1">
        <h4 className="text-[12px] text-white/90 font-medium truncate flex-1">{snippet.title}</h4>
        {locked && (
          <svg
            className="w-3 h-3 text-amber-400 flex-shrink-0"
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
      <span
        className="text-[9px] uppercase tracking-wide px-1.5 py-0.5 rounded self-start"
        style={{ background: `${accent}33`, color: accent }}
      >
        {String(snippet.category)}
      </span>
    </button>
  );
}
