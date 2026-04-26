import React from 'react';

interface RawTextFallbackProps {
  text: string;
  reason: string;
  width: number;
  height: number;
}

export function RawTextFallback({ text, reason, width, height }: RawTextFallbackProps) {
  return (
    <div
      className="rounded-xl border border-white/[0.08] flex flex-col"
      style={{ width, height, background: 'rgba(0,0,0,0.35)' }}
    >
      <div className="px-3 py-2 text-[11px] text-amber-300 border-b border-white/[0.08] bg-amber-500/5">
        Preview unavailable — {reason}. Raw T3D shown below; copy still works.
      </div>
      <pre
        className="flex-1 overflow-auto text-[10px] text-white/70 p-3 font-mono whitespace-pre"
        style={{ lineHeight: 1.4 }}
      >
        {text}
      </pre>
    </div>
  );
}
