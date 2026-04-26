import React, { useMemo, useState } from 'react';
import { useAppStore, selectIsPro } from '../../store';
import type { BlueprintSnippet } from '../../../shared/blueprints/types';
import { BlueprintGrid } from './BlueprintGrid';
import { BlueprintDetail } from './BlueprintDetail';
import { applySnippetParams } from '../../../shared/blueprints/composer';
import snippetsData from '../../../shared/blueprints/snippets.json';

const SNIPPETS = snippetsData as BlueprintSnippet[];

interface BlueprintsPanelProps {
  selectedId: string | null;
  onSelect: (id: string | null) => void;
  graphWidth: number;
  graphHeight: number;
}

export function BlueprintsPanel({
  selectedId,
  onSelect,
  graphWidth,
  graphHeight,
}: BlueprintsPanelProps) {
  const isPro = useAppStore(selectIsPro);
  const authState = useAppStore((s) => s.authState);
  const [upgradePrompt, setUpgradePrompt] = useState(false);

  const selected = useMemo(
    () => (selectedId ? SNIPPETS.find((s) => s.id === selectedId) ?? null : null),
    [selectedId],
  );

  const handleLockedClick = (id: string) => {
    setUpgradePrompt(true);
    window.electronAPI?.analytics?.track('snippet_upgrade_click', {
      snippetId: id,
      plan: isPro ? 'pro' : 'free',
    });
  };

  const handleSelect = (id: string) => {
    onSelect(id);
    const snippet = SNIPPETS.find((s) => s.id === id);
    window.electronAPI?.analytics?.track('snippet_viewed', {
      snippetId: id,
      category: snippet?.category ?? 'Unknown',
      plan: isPro ? 'pro' : 'free',
      email: authState?.email ?? null,
    });
  };

  const handleCopied = (snippet: BlueprintSnippet) => {
    window.electronAPI?.analytics?.track('snippet_copied', {
      snippetId: snippet.id,
      category: snippet.category,
      t3dLength: applySnippetParams(snippet).length,
      targetBlueprint: snippet.target_blueprint,
      plan: isPro ? 'pro' : 'free',
    });
  };

  if (selected) {
    return (
      <BlueprintDetail
        snippet={selected}
        graphWidth={graphWidth}
        graphHeight={graphHeight}
        onCopied={handleCopied}
      />
    );
  }

  return (
    <div className="flex flex-col gap-3">
      {!isPro && (
        <div className="flex items-start gap-2 p-2.5 rounded-lg border border-amber-500/20 bg-amber-500/[0.06]">
          <svg
            className="w-4 h-4 text-amber-400 flex-shrink-0 mt-0.5"
            fill="currentColor"
            viewBox="0 0 20 20"
          >
            <path d="M5 9V7a5 5 0 0110 0v2h1a2 2 0 012 2v7a2 2 0 01-2 2H4a2 2 0 01-2-2v-7a2 2 0 012-2h1z" />
          </svg>
          <div className="text-[11px] text-amber-100/90 leading-relaxed">
            Free plan: {SNIPPETS.filter((s) => s.is_intro).length} intro snippets unlocked.
            <button
              onClick={() => {
                window.electronAPI?.analytics?.track('upgrade_clicked', { source: 'blueprints' });
                window.open('https://build-buddy.app/pricing', '_blank');
              }}
              className="underline underline-offset-2 ml-1 hover:text-amber-200"
            >
              Upgrade to Pro
            </button>{' '}
            to unlock the full library.
          </div>
        </div>
      )}

      {upgradePrompt && (
        <div className="flex items-center justify-between p-2.5 rounded-lg border border-amber-500/30 bg-amber-500/[0.1]">
          <span className="text-[11px] text-amber-100">Upgrade to Pro to unlock this snippet.</span>
          <div className="flex items-center gap-1.5">
            <button
              onClick={() => {
                window.electronAPI?.analytics?.track('upgrade_clicked', { source: 'blueprints_locked' });
                window.open('https://build-buddy.app/pricing', '_blank');
              }}
              className="px-2 py-1 rounded bg-amber-500/30 hover:bg-amber-500/40 text-amber-100 text-[11px] font-medium"
            >
              Upgrade
            </button>
            <button
              onClick={() => setUpgradePrompt(false)}
              className="text-amber-100/60 hover:text-amber-100 text-[11px] px-1"
            >
              ✕
            </button>
          </div>
        </div>
      )}

      <BlueprintGrid
        snippets={SNIPPETS}
        isPro={isPro}
        onSelect={handleSelect}
        onLockedClick={handleLockedClick}
      />
    </div>
  );
}
