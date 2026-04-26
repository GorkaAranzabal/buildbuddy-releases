import React, { useMemo, useState } from 'react';
import type { BlueprintSnippet } from '../../../shared/blueprints/types';
import { BlueprintCard } from './BlueprintCard';
import { BlueprintTile } from './BlueprintTile';

type ViewLayout = 'grid' | 'list';

interface BlueprintGridProps {
  snippets: BlueprintSnippet[];
  isPro: boolean;
  onSelect: (id: string) => void;
  onLockedClick: (id: string) => void;
}

export function BlueprintGrid({ snippets, isPro, onSelect, onLockedClick }: BlueprintGridProps) {
  const [query, setQuery] = useState('');
  const [activeCategory, setActiveCategory] = useState<string | null>(null);
  const [layout, setLayout] = useState<ViewLayout>('grid');

  const categories = useMemo(() => {
    const set = new Set<string>();
    for (const s of snippets) set.add(String(s.category));
    return Array.from(set).sort();
  }, [snippets]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return snippets.filter((s) => {
      if (activeCategory && String(s.category) !== activeCategory) return false;
      if (!q) return true;
      return (
        s.title.toLowerCase().includes(q) ||
        s.description.toLowerCase().includes(q) ||
        s.tags.some((t) => t.toLowerCase().includes(q)) ||
        s.target_blueprint.toLowerCase().includes(q)
      );
    });
  }, [snippets, query, activeCategory]);

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-col gap-2">
        <div className="relative">
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search snippets..."
            className="w-full px-3 py-2 pl-8 bg-zinc-800/60 border border-white/[0.08] rounded-lg text-sm text-white/90 placeholder:text-white/30 focus:outline-none focus:border-white/[0.2] transition-colors"
          />
          <svg
            className="absolute left-2.5 top-1/2 -translate-y-1/2 w-4 h-4 text-white/40"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"
            />
          </svg>
        </div>
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-1.5 flex-wrap min-w-0">
            <CategoryChip
              label="All"
              active={activeCategory === null}
              onClick={() => setActiveCategory(null)}
            />
            {categories.map((c) => (
              <CategoryChip
                key={c}
                label={c}
                active={activeCategory === c}
                onClick={() => setActiveCategory(c)}
              />
            ))}
          </div>
          <LayoutToggle layout={layout} onChange={setLayout} />
        </div>
      </div>

      {filtered.length === 0 ? (
        <div className="text-center text-xs text-white/40 py-8">No snippets match that search.</div>
      ) : layout === 'grid' ? (
        <div className="grid grid-cols-2 gap-2">
          {filtered.map((s) => {
            const locked = !isPro && !s.is_intro;
            return (
              <BlueprintTile
                key={s.id}
                snippet={s}
                locked={locked}
                onSelect={() => onSelect(s.id)}
                onLockedClick={() => onLockedClick(s.id)}
              />
            );
          })}
        </div>
      ) : (
        <div className="flex flex-col gap-2">
          {filtered.map((s) => {
            const locked = !isPro && !s.is_intro;
            return (
              <BlueprintCard
                key={s.id}
                snippet={s}
                locked={locked}
                onSelect={() => onSelect(s.id)}
                onLockedClick={() => onLockedClick(s.id)}
              />
            );
          })}
        </div>
      )}
    </div>
  );
}

function LayoutToggle({ layout, onChange }: { layout: ViewLayout; onChange: (l: ViewLayout) => void }) {
  return (
    <div className="flex items-center bg-white/[0.04] border border-white/[0.08] rounded-md overflow-hidden flex-shrink-0">
      <button
        onClick={() => onChange('grid')}
        className={`p-1.5 transition-colors ${
          layout === 'grid' ? 'bg-white/[0.12] text-white/90' : 'text-white/50 hover:text-white/80'
        }`}
        aria-label="Grid view"
        title="Grid view"
      >
        <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h6v6H4zM14 6h6v6h-6zM4 14h6v6H4zM14 14h6v6h-6z" />
        </svg>
      </button>
      <button
        onClick={() => onChange('list')}
        className={`p-1.5 transition-colors ${
          layout === 'list' ? 'bg-white/[0.12] text-white/90' : 'text-white/50 hover:text-white/80'
        }`}
        aria-label="List view"
        title="List view"
      >
        <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
        </svg>
      </button>
    </div>
  );
}

function CategoryChip({
  label,
  active,
  onClick,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className={`text-[11px] px-2 py-1 rounded-full border transition-colors ${
        active
          ? 'bg-white/[0.15] border-white/[0.25] text-white/90'
          : 'bg-white/[0.04] border-white/[0.08] text-white/60 hover:text-white/80 hover:bg-white/[0.08]'
      }`}
    >
      {label}
    </button>
  );
}
