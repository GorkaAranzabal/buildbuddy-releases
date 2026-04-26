import React, { useMemo, useState } from 'react';
import type { BlueprintSnippet } from '../../../shared/blueprints/types';
import { parseT3D } from '../../../shared/blueprints/t3dParser';
import { generateVariablePython } from '../../../shared/blueprints/pythonGenerator';
import { generateDirectBuildPython } from '../../../shared/blueprints/pythonNodeEmitter';
import { applySnippetParams } from '../../../shared/blueprints/composer';
import { GraphPreview } from './GraphPreview';
import { RawTextFallback } from './RawTextFallback';
import { copyT3DText } from './copyUtil';
import { useAppStore } from '../../store';

interface BlueprintDetailProps {
  snippet: BlueprintSnippet;
  graphWidth: number;
  graphHeight: number;
  onCopied: (snippet: BlueprintSnippet) => void;
}

type AutoRunState = 'idle' | 'running' | 'success' | 'error';

// Direct-build constructs K2Nodes via UE Python reflection — blocked in UE 5.x
// because `UEdGraph::AddNode` is not exposed to the Python binding (confirmed:
// dir(graph) exposes only generic UObject methods; `Nodes` is read-protected;
// `BlueprintEditorLibrary` adds graphs/variables but never nodes; no
// `EdGraphUtilities`). Flip to true once a C++ MCP extension exposes AddNode,
// or if a future UE release surfaces it in Python. Fallback flow continues to
// work untouched.
const DIRECT_BUILD_ENABLED = false;

function extractText(data: unknown): string {
  if (!data || typeof data !== 'object') return '';
  const content = (data as { content?: Array<{ type?: string; text?: string }> }).content;
  if (!Array.isArray(content)) return '';
  return content
    .filter((c) => c && c.type === 'text' && typeof c.text === 'string')
    .map((c) => c.text as string)
    .join('\n');
}

export function BlueprintDetail({
  snippet,
  graphWidth,
  graphHeight,
  onCopied,
}: BlueprintDetailProps) {
  const { selectedEngine, unrealMCPStatus, setEngineSetupStatus, setEngineSetupOpen } = useAppStore();
  const resolvedT3D = useMemo(() => applySnippetParams(snippet), [snippet]);
  const parse = useMemo(() => parseT3D(resolvedT3D), [resolvedT3D]);
  const requiredVars = snippet.required_variables ?? [];
  const pythonScript = useMemo(
    () => (requiredVars.length > 0 ? generateVariablePython(requiredVars) : ''),
    [requiredVars],
  );
  const directBuild = useMemo(
    () => (parse.ok ? generateDirectBuildPython(parse.graph, requiredVars) : null),
    [parse, requiredVars],
  );
  const [copied, setCopied] = useState(false);
  const [pyCopied, setPyCopied] = useState(false);
  const [showManual, setShowManual] = useState(false);
  const [autoRunState, setAutoRunState] = useState<AutoRunState>('idle');
  const [autoRunError, setAutoRunError] = useState<string>('');
  const [directRunState, setDirectRunState] = useState<AutoRunState>('idle');
  const [directRunError, setDirectRunError] = useState<string>('');

  const mcpConnected = selectedEngine === 'unreal' && unrealMCPStatus === 'connected';
  const isVariableSnippet = requiredVars.length > 0;
  const canAutoRun = mcpConnected && isVariableSnippet;
  const needsConnectCTA = isVariableSnippet && !mcpConnected;
  const canDirectBuild =
    DIRECT_BUILD_ENABLED &&
    mcpConnected &&
    directBuild !== null &&
    directBuild.unsupportedClasses.length === 0 &&
    directBuild.nodeCount > 0;

  const handleCopy = async () => {
    const ok = await copyT3DText(resolvedT3D);
    if (ok) {
      setCopied(true);
      onCopied(snippet);
      setTimeout(() => setCopied(false), 1600);
    }
  };

  const handleCopyPython = async () => {
    const ok = await copyT3DText(pythonScript);
    if (ok) {
      setPyCopied(true);
      setTimeout(() => setPyCopied(false), 1600);
    }
  };

  const handleConnectUnreal = async () => {
    try {
      const setup = await window.electronAPI?.engine?.checkSetup?.('unreal');
      if (setup) {
        setEngineSetupStatus(setup);
        setEngineSetupOpen(true);
      }
    } catch {
      // best-effort — user can still open engine setup via NotchBar
    }
  };

  const handleDirectBuild = async () => {
    if (!directBuild) return;
    setDirectRunState('running');
    setDirectRunError('');
    window.electronAPI?.analytics?.track('snippet_direct_build_attempt', {
      snippetId: snippet.id,
      nodeCount: directBuild.nodeCount,
    });
    try {
      const result = await window.electronAPI.unrealMcp.callTool('editor_run_python', {
        code: directBuild.code,
      });
      if (!result.success) {
        const errMsg = result.error || 'Unknown error running Python in Unreal';
        setDirectRunState('error');
        setDirectRunError(errMsg);
        window.electronAPI?.analytics?.track('snippet_direct_build_error', {
          snippetId: snippet.id,
          errorHead: errMsg.slice(0, 200),
        });
        return;
      }
      const text = extractText(result.data);
      if (/^ERROR:/m.test(text)) {
        const errLine = text.split('\n').find((l) => l.startsWith('ERROR:')) || text;
        setDirectRunState('error');
        setDirectRunError(errLine);
        window.electronAPI?.analytics?.track('snippet_direct_build_error', {
          snippetId: snippet.id,
          errorHead: errLine.slice(0, 200),
        });
        return;
      }
      setDirectRunState('success');
      window.electronAPI?.analytics?.track('snippet_direct_build_success', {
        snippetId: snippet.id,
        nodeCount: directBuild.nodeCount,
      });
      setTimeout(() => setDirectRunState('idle'), 5000);
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err);
      setDirectRunState('error');
      setDirectRunError(errMsg);
      window.electronAPI?.analytics?.track('snippet_direct_build_error', {
        snippetId: snippet.id,
        errorHead: errMsg.slice(0, 200),
      });
    }
  };

  const handleAutoRun = async () => {
    setAutoRunState('running');
    setAutoRunError('');
    try {
      const copyOk = await copyT3DText(resolvedT3D);
      if (!copyOk) {
        setAutoRunState('error');
        setAutoRunError('Failed to copy T3D to clipboard');
        return;
      }
      const result = await window.electronAPI.unrealMcp.callTool('editor_run_python', {
        code: pythonScript,
      });
      if (!result.success) {
        setAutoRunState('error');
        setAutoRunError(result.error || 'Unknown error running Python in Unreal');
        return;
      }
      const text = extractText(result.data);
      if (/^ERROR:/m.test(text)) {
        setAutoRunState('error');
        setAutoRunError(text.split('\n').find((l) => l.startsWith('ERROR:')) || text);
        return;
      }
      onCopied(snippet);
      setAutoRunState('success');

      // Bring Unreal to the foreground so the user doesn't have to Alt-Tab,
      // then show a big paste-hint overlay telling them to press Cmd/Ctrl+V.
      // Both are best-effort — failures don't affect the success state.
      try {
        await window.electronAPI?.unreal?.focusEditor?.();
      } catch {
        // ignore — overlay below is the fallback UX
      }
      try {
        window.electronAPI?.pasteHint?.show?.(7000);
      } catch {
        // ignore
      }

      setTimeout(() => setAutoRunState('idle'), 5000);
    } catch (err) {
      setAutoRunState('error');
      setAutoRunError(err instanceof Error ? err.message : String(err));
    }
  };

  return (
    <div className="flex flex-col gap-3">
      <div>
        <h3 className="text-white/95 text-sm font-semibold">{snippet.title}</h3>
        <p className="text-white/60 text-xs mt-0.5">{snippet.description}</p>
      </div>

      <div
        className="rounded-lg p-2.5 flex items-start gap-2"
        style={{
          background: 'rgba(245, 158, 11, 0.08)',
          border: '1px solid rgba(245, 158, 11, 0.3)',
        }}
      >
        <svg
          className="w-4 h-4 text-amber-300 flex-shrink-0 mt-0.5"
          fill="currentColor"
          viewBox="0 0 20 20"
        >
          <path
            fillRule="evenodd"
            d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.213 2.98-1.742 2.98H4.42c-1.53 0-2.493-1.646-1.743-2.98l5.58-9.92zM11 13a1 1 0 11-2 0 1 1 0 012 0zm-1-8a1 1 0 00-1 1v3a1 1 0 002 0V6a1 1 0 00-1-1z"
            clipRule="evenodd"
          />
        </svg>
        <div className="min-w-0">
          <div className="text-[11px] font-semibold text-amber-200 uppercase tracking-wide">
            Paste into: {snippet.target_blueprint}
          </div>
          <div className="text-[11px] text-amber-100/90 mt-0.5 leading-relaxed">
            {snippet.paste_instructions}
          </div>
        </div>
      </div>

      {parse.ok ? (
        <GraphPreview graph={parse.graph} width={graphWidth} height={graphHeight} />
      ) : (
        <RawTextFallback
          text={resolvedT3D}
          reason={parse.reason}
          width={graphWidth}
          height={graphHeight}
        />
      )}

      {canDirectBuild && (
        <div
          className="rounded-lg p-3 space-y-2"
          style={{
            background: 'rgba(168, 85, 247, 0.10)',
            border: '1px solid rgba(168, 85, 247, 0.35)',
          }}
        >
          <div className="flex items-center gap-2">
            <span className="w-1.5 h-1.5 rounded-full bg-purple-400" />
            <div className="text-[11px] font-semibold text-purple-200 uppercase tracking-wide">
              One-click build — no paste needed
            </div>
          </div>
          <div className="text-[11px] text-purple-100/85 leading-relaxed">
            Build Buddy creates the variables, opens the blueprint, and constructs every node directly in the event graph. Have your target blueprint <span className="text-purple-50">open in the editor</span>, or click it <span className="text-purple-50">ONCE in the Content Browser</span>.
          </div>
          <button
            onClick={handleDirectBuild}
            disabled={directRunState === 'running'}
            className={`w-full px-4 py-2.5 rounded-lg text-sm font-medium transition-all ${
              directRunState === 'success'
                ? 'bg-green-600/30 border border-green-500/40 text-green-300'
                : directRunState === 'error'
                  ? 'bg-red-600/30 border border-red-500/40 text-red-200'
                  : directRunState === 'running'
                    ? 'bg-purple-600/40 border border-purple-500/30 text-purple-100 cursor-wait'
                    : 'bg-purple-600 hover:bg-purple-500 text-white'
            }`}
          >
            {directRunState === 'success'
              ? '✓ Done — nodes are in your event graph'
              : directRunState === 'running'
                ? 'Building in Unreal…'
                : directRunState === 'error'
                  ? 'Try again'
                  : '⚡ Build directly in graph'}
          </button>
          {directRunState === 'error' && directRunError && (
            <>
              <div className="text-[11px] text-red-300/90 leading-relaxed font-mono break-all">
                {directRunError}
              </div>
              <div className="text-[10px] text-purple-200/70 leading-relaxed">
                Try the clipboard method below instead.
              </div>
            </>
          )}
        </div>
      )}

      {canAutoRun && (
        <div
          className="rounded-lg p-3 space-y-2"
          style={{
            background: 'rgba(16, 185, 129, 0.08)',
            border: '1px solid rgba(16, 185, 129, 0.3)',
          }}
        >
          <div className="flex items-center gap-2">
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-400" />
            <div className="text-[11px] font-semibold text-emerald-200 uppercase tracking-wide">
              {canDirectBuild ? 'Fallback: clipboard paste' : 'Connected to Unreal — no Output Log needed'}
            </div>
          </div>
          <div className="text-[11px] text-emerald-100/85 leading-relaxed">
            Have your target blueprint <span className="text-emerald-50">open in the editor</span>, or click it <span className="text-emerald-50">ONCE in the Content Browser</span>. Build Buddy will create the variables, open the blueprint, and put the T3D on your clipboard — then just press <span className="text-emerald-50 font-semibold">Ctrl+V</span> in the event graph. Required:{' '}
            {requiredVars.map((v, i) => (
              <React.Fragment key={v.name}>
                {i > 0 && ', '}
                <span className="text-emerald-50 font-medium">{v.name}</span>
                <span className="text-emerald-100/60"> ({v.type})</span>
              </React.Fragment>
            ))}
            .
          </div>
          <button
            onClick={handleAutoRun}
            disabled={autoRunState === 'running'}
            className={`w-full px-4 py-2.5 rounded-lg text-sm font-medium transition-all ${
              autoRunState === 'success'
                ? 'bg-green-600/30 border border-green-500/40 text-green-300'
                : autoRunState === 'error'
                  ? 'bg-red-600/30 border border-red-500/40 text-red-200'
                  : autoRunState === 'running'
                    ? 'bg-emerald-600/40 border border-emerald-500/30 text-emerald-100 cursor-wait'
                    : 'bg-emerald-600 hover:bg-emerald-500 text-white'
            }`}
          >
            {autoRunState === 'success'
              ? '✓ Done — press Ctrl+V in the event graph'
              : autoRunState === 'running'
                ? 'Running in Unreal…'
                : autoRunState === 'error'
                  ? 'Try again'
                  : '⚡ Setup & open blueprint'}
          </button>
          {autoRunState === 'error' && autoRunError && (
            <div className="text-[11px] text-red-300/90 leading-relaxed font-mono break-all">
              {autoRunError}
            </div>
          )}
          <button
            onClick={() => setShowManual((s) => !s)}
            className="text-[10px] text-emerald-200/70 hover:text-emerald-100 underline underline-offset-2"
          >
            {showManual ? 'Hide manual Python' : 'Or run Python manually'}
          </button>
        </div>
      )}

      {isVariableSnippet && canAutoRun && showManual && (
        <div
          className="rounded-lg p-3 space-y-2"
          style={{
            background: 'rgba(99, 102, 241, 0.08)',
            border: '1px solid rgba(99, 102, 241, 0.3)',
          }}
        >
          <div className="flex items-center justify-between">
            <div className="text-[11px] font-semibold text-indigo-200 uppercase tracking-wide">
              Manual · Create variables via Python
            </div>
            <button
              onClick={handleCopyPython}
              className={`px-2.5 py-1 rounded text-[11px] font-medium transition-all ${
                pyCopied
                  ? 'bg-green-600/30 border border-green-500/40 text-green-300'
                  : 'bg-indigo-600/40 hover:bg-indigo-500/50 border border-indigo-400/30 text-indigo-50'
              }`}
            >
              {pyCopied ? '✓ Copied' : 'Copy Python'}
            </button>
          </div>
          <div className="text-[11px] text-indigo-100/80 leading-relaxed">
            <span className="text-indigo-50">Open your blueprint in the editor</span>, or click it ONCE in the Content Browser. Then <span className="text-indigo-50">Window → Output Log</span>, switch the <span className="text-indigo-50">Cmd</span> dropdown to <span className="text-indigo-50">Python</span> (not REPL), paste, Enter. Required:{' '}
            {requiredVars.map((v, i) => (
              <React.Fragment key={v.name}>
                {i > 0 && ', '}
                <span className="text-indigo-50 font-medium">{v.name}</span>
                <span className="text-indigo-100/60"> ({v.type})</span>
              </React.Fragment>
            ))}
            .
          </div>
          <pre
            className="text-[10px] leading-snug text-indigo-50/90 font-mono overflow-auto rounded px-2 py-1.5"
            style={{
              background: 'rgba(0, 0, 0, 0.35)',
              maxHeight: 140,
            }}
          >
            {pythonScript}
          </pre>
        </div>
      )}

      {!isVariableSnippet && (
        <button
          onClick={handleCopy}
          className={`w-full px-4 py-2.5 rounded-lg text-sm font-medium transition-all ${
            copied
              ? 'bg-green-600/30 border border-green-500/40 text-green-300'
              : 'bg-blue-600 hover:bg-blue-500 text-white'
          }`}
        >
          {copied ? '✓ Copied — paste into UE5 event graph' : 'Copy T3D to clipboard'}
        </button>
      )}

      {needsConnectCTA && (
        <div
          className="rounded-lg p-3 space-y-2"
          style={{
            background: 'rgba(59, 130, 246, 0.08)',
            border: '1px solid rgba(59, 130, 246, 0.3)',
          }}
        >
          <div className="flex items-center gap-2">
            <span className="w-1.5 h-1.5 rounded-full bg-blue-400" />
            <div className="text-[11px] font-semibold text-blue-200 uppercase tracking-wide">
              Connect Unreal to use this snippet
            </div>
          </div>
          <div className="text-[11px] text-blue-100/85 leading-relaxed">
            This snippet creates variables in your blueprint, so Build Buddy needs a live connection to Unreal to wire it up for you. Open Unreal with the MCP plugin running, then come back — we'll handle the rest.
          </div>
          <button
            onClick={handleConnectUnreal}
            className="w-full px-4 py-2.5 rounded-lg text-sm font-medium transition-all bg-blue-600 hover:bg-blue-500 text-white"
          >
            Connect Unreal MCP
          </button>
        </div>
      )}
    </div>
  );
}
