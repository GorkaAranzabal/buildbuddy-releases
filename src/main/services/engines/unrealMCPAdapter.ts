import { clipboard } from 'electron';
import type { IEngineMCPService } from '../engineMCPService';
import type { UnrealMCPService } from '../unrealMCPService';
import type { WindowManager } from '../../windowManager';
import { focusUnrealEditor } from '../windowFocusService';
import { composeSnippets } from '../../../shared/blueprints/composer';
import { compileIntent, whitelistedFunctionIds } from '../../../shared/blueprints/intentCompiler';
import type { BlueprintIntent } from '../../../shared/blueprints/intentCompiler';
import { generateVariablePython } from '../../../shared/blueprints/pythonGenerator';
import snippetsJson from '../../../shared/blueprints/snippets.json';
import type {
  BlueprintSnippet,
  RequiredVariable,
} from '../../../shared/blueprints/types';
import type {
  EngineMCPStatus,
  EngineSetupStatus,
  EngineSetupStep,
  MCPProjectInfo,
  MCPToolDefinition,
  MCPToolResult,
  UserSettings,
} from '../../../shared/types';

const UE5_SETUP_STEPS: EngineSetupStep[] = [
  {
    n: 1,
    title: 'Open Project Settings',
    desc: 'In Unreal Editor: Edit → Project Settings → Plugins → Python',
    isAutomatic: false,
  },
  {
    n: 2,
    title: 'Enable Remote Execution',
    desc: 'Check "Enable Remote Execution" and set Multicast Bind Address to 0.0.0.0',
    isAutomatic: false,
  },
  {
    n: 3,
    title: 'Set Engine Path',
    desc: 'In Build Buddy settings, set the path to your Unreal Engine installation',
    isAutomatic: false,
  },
];

const LIBRARY_SNIPPETS = snippetsJson as BlueprintSnippet[];

export class UnrealMCPAdapter implements IEngineMCPService {
  constructor(private service: UnrealMCPService, private windowManager?: WindowManager) {}

  setWindowManager(wm: WindowManager): void {
    this.windowManager = wm;
  }

  getStatus(): EngineMCPStatus {
    return this.service.getStatus() as EngineMCPStatus;
  }

  start(settings: UserSettings): Promise<{ success: boolean; error?: string }> {
    return this.service.start(settings.unrealEnginePath ?? '', settings.ueProjectPath ?? '');
  }

  stop(): Promise<void> {
    return this.service.stop();
  }

  getTools(): MCPToolDefinition[] {
    return this.service.getTools();
  }

  callTool(name: string, args: Record<string, unknown>): Promise<MCPToolResult> {
    if (name === 'compose_blueprint') {
      return this.composeBlueprint(args);
    }
    if (name === 'build_blueprint_freeform') {
      return this.buildBlueprintFreeform(args);
    }
    return this.service.callTool(name, args);
  }

  getEditorSnapshot(): Promise<string> {
    return this.service.getEditorSnapshot();
  }

  testConnection(): Promise<MCPProjectInfo | null> {
    return this.service.testConnection();
  }

  onStatusChange(cb: (status: EngineMCPStatus, error?: string) => void): void {
    this.service.onStatusChange(cb as (status: string) => void);
  }

  getSetupSteps(): EngineSetupStep[] {
    return UE5_SETUP_STEPS;
  }

  async checkSetup(): Promise<EngineSetupStatus> {
    return { engine: 'unreal', stepsComplete: true, pendingSteps: [] };
  }

  async installDeps(): Promise<{ success: boolean; error?: string }> {
    return { success: true };
  }

  private async composeBlueprint(args: Record<string, unknown>): Promise<MCPToolResult> {
    const rawIds = args.snippet_ids;
    if (!Array.isArray(rawIds) || rawIds.length === 0) {
      return { success: false, error: 'snippet_ids must be a non-empty array of strings' };
    }
    const snippetIds = rawIds.map((v) => String(v));

    const paramsBySnippet = normalizeParams(args.params);

    const composed = composeSnippets(snippetIds, LIBRARY_SNIPPETS, paramsBySnippet);

    if (composed.unknownIds.length > 0) {
      const valid = LIBRARY_SNIPPETS.map((s) => s.id).join(', ');
      return {
        success: false,
        error: `Unknown snippet ids: ${composed.unknownIds.join(', ')}. Valid ids are: ${valid}.`,
      };
    }
    if (composed.conflicts.length > 0) {
      const lines = composed.conflicts.map(
        (c) => `Variable "${c.name}" is ${c.typeA} in one snippet but ${c.typeB} in another.`,
      );
      return {
        success: false,
        error: `Variable type conflict — pick snippets that agree on types:\n${lines.join('\n')}`,
      };
    }
    if (composed.usedSnippets.length === 0) {
      return { success: false, error: 'No snippets were selected.' };
    }

    const snippetList = composed.usedSnippets.map((s) => s.id).join(', ');
    const varSummary =
      composed.requiredVars.length > 0
        ? ` Created variables: ${composed.requiredVars.map(formatVar).join(', ')}.`
        : '';
    const paramSummary = summarizeParams(paramsBySnippet);
    const summary = `Composed ${composed.usedSnippets.length} snippet(s) (${snippetList})${paramSummary} into the clipboard.${varSummary} Target blueprint: ${composed.targetBlueprint}. Unreal is focused and a paste-hint overlay is showing — the user should click the event graph and press Cmd/Ctrl+V.`;

    return this.runPastePipeline(composed.t3d, composed.requiredVars, summary);
  }

  private async buildBlueprintFreeform(args: Record<string, unknown>): Promise<MCPToolResult> {
    const intent = args.intent as BlueprintIntent | undefined;
    if (!intent || typeof intent !== 'object') {
      return {
        success: false,
        error: 'intent must be an object. See Blueprint Snippet Catalog in system prompt for schema.',
      };
    }

    const compiled = compileIntent(intent);
    if (!compiled.ok) {
      return { success: false, error: compiled.error };
    }

    const actionsSummary = summarizeActions(intent);
    const varSummary =
      compiled.requiredVars.length > 0
        ? ` Created variables: ${compiled.requiredVars.map(formatVar).join(', ')}.`
        : '';
    const summary = `Built a freeform blueprint (${actionsSummary}) into the clipboard.${varSummary} Target blueprint: ${compiled.targetBlueprint}. Whitelisted functions only: ${whitelistedFunctionIds().join(', ')}. Unreal is focused and a paste-hint overlay is showing — the user should click the event graph and press Cmd/Ctrl+V. Target-pin wiring for component functions is manual.`;

    return this.runPastePipeline(compiled.t3d, compiled.requiredVars, summary);
  }

  private async runPastePipeline(
    t3d: string,
    requiredVars: RequiredVariable[],
    summary: string,
  ): Promise<MCPToolResult> {
    try {
      clipboard.writeText(t3d);
    } catch (err) {
      return {
        success: false,
        error: `Failed to write to clipboard: ${err instanceof Error ? err.message : String(err)}`,
      };
    }

    if (requiredVars.length > 0) {
      const pyResult = await this.service.callTool('editor_run_python', {
        code: generateVariablePython(requiredVars),
      });
      if (!pyResult.success) {
        return {
          success: false,
          error: `Variables + open step failed: ${pyResult.error ?? 'unknown error'}`,
        };
      }
      const text = extractText(pyResult.data);
      if (/^ERROR:/m.test(text)) {
        const errLine = text.split('\n').find((l) => l.startsWith('ERROR:')) || text;
        return { success: false, error: errLine };
      }
    }

    try { await focusUnrealEditor(); } catch { /* best-effort */ }
    try { this.windowManager?.showPasteHint(7000); } catch { /* best-effort */ }

    return {
      success: true,
      data: { content: [{ type: 'text', text: summary }] },
    };
  }
}

function extractText(data: unknown): string {
  if (!data || typeof data !== 'object') return '';
  const content = (data as { content?: Array<{ type?: string; text?: string }> }).content;
  if (!Array.isArray(content)) return '';
  return content
    .filter((c) => c && c.type === 'text' && typeof c.text === 'string')
    .map((c) => c.text as string)
    .join('\n');
}

function formatVar(v: RequiredVariable): string {
  const def = v.default_value !== undefined ? `=${v.default_value}` : '';
  return `${v.name}:${v.type}${def}`;
}

function normalizeParams(raw: unknown): Record<string, Record<string, string>> | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  const out: Record<string, Record<string, string>> = {};
  for (const [id, overrides] of Object.entries(raw as Record<string, unknown>)) {
    if (!overrides || typeof overrides !== 'object') continue;
    const entry: Record<string, string> = {};
    for (const [k, v] of Object.entries(overrides as Record<string, unknown>)) {
      entry[k] = String(v);
    }
    out[id] = entry;
  }
  return Object.keys(out).length > 0 ? out : undefined;
}

function summarizeParams(params?: Record<string, Record<string, string>>): string {
  if (!params) return '';
  const parts: string[] = [];
  for (const [id, overrides] of Object.entries(params)) {
    const kv = Object.entries(overrides).map(([k, v]) => `${k}=${v}`).join(', ');
    if (kv) parts.push(`${id}:{${kv}}`);
  }
  return parts.length > 0 ? ` with overrides ${parts.join('; ')}` : '';
}

function summarizeActions(intent: BlueprintIntent): string {
  const trig = intent.trigger;
  let triggerLabel = '';
  if (trig.kind === 'input_key') triggerLabel = `InputKey ${trig.key}`;
  else if (trig.kind === 'input_action') triggerLabel = `InputAction ${trig.action}`;
  else triggerLabel = trig.event;
  const actionLabels = intent.actions.map((a) => {
    if (a.kind === 'print') return `print("${a.message}")`;
    if (a.kind === 'call_function') return a.function_ref;
    return `set ${a.name}=${a.literal}`;
  });
  return `${triggerLabel} → ${actionLabels.join(' → ')}`;
}
