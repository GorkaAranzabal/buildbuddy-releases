import React from 'react';

interface Step {
  n: number;
  title: string;
  desc: string;
  warn?: string;
}

const STEPS: Step[] = [
  {
    n: 1,
    title: 'Enable Python Editor Script Plugin',
    desc: 'Edit → Plugins → search "Python Editor Script Plugin" → Enable → Restart.',
  },
  {
    n: 2,
    title: 'Enable Remote Execution',
    desc: 'Edit → Project Settings → Plugins → Python → check "Enable Remote Execution".',
  },
  {
    n: 3,
    title: 'Set Multicast Bind Address to 0.0.0.0',
    desc: 'Same Python settings → "Remote Execution Multicast Bind Address" = 0.0.0.0.',
    warn: 'Must be 0.0.0.0 — the MCP server binds to all interfaces and will not see UE if you set 127.0.0.1.',
  },
  {
    n: 4,
    title: 'Allow BuildBuddy in macOS Firewall',
    desc: 'System Settings → Network → Firewall → Options → find BuildBuddy → Allow incoming connections.',
    warn: 'Each new build of BuildBuddy is treated as a new app by the firewall. You may need to re-allow it every time you update.',
  },
  {
    n: 5,
    title: 'Restart Unreal Editor',
    desc: 'Close and reopen your project for the plugin settings to take effect.',
  },
  {
    n: 6,
    title: 'Open your project, then click "Start Server"',
    desc: 'Unreal Editor must be running with your project open when you click Start Server.',
  },
];

export function MCPSetupChecklist() {
  return (
    <div className="mt-2 rounded-xl border border-white/[0.08] p-3 space-y-2.5" style={{ background: 'rgba(255,255,255,0.02)' }}>
      <p className="text-white/50 text-xs font-medium uppercase tracking-wider">Setup Required</p>
      {STEPS.map((s) => (
        <div key={s.n} className="flex gap-2.5">
          <div
            className="flex-shrink-0 w-5 h-5 rounded-full flex items-center justify-center mt-0.5"
            style={{ background: 'rgba(255,255,255,0.08)' }}
          >
            <span className="text-white/50 text-[10px] font-bold">{s.n}</span>
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-white/80 text-xs font-medium">{s.title}</p>
            <p className="text-white/45 text-xs mt-0.5 leading-relaxed">{s.desc}</p>
            {s.warn && (
              <p className="text-amber-400/80 text-xs mt-1">⚠ {s.warn}</p>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}
