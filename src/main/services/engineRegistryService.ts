import type { IEngineMCPService } from './engineMCPService';
import type { UnrealMCPAdapter } from './engines/unrealMCPAdapter';
import { GodotMCPAdapter } from './engines/godotMCPAdapter';
import { UnityMCPAdapter } from './engines/unityMCPAdapter';
import { BlenderMCPAdapter } from './engines/blenderMCPAdapter';
import { RobloxMCPAdapter } from './engines/robloxMCPAdapter';
import { UEFNMCPAdapter } from './engines/uefnMCPAdapter';
import type {
  CaptureResult,
  EngineMCPStatus,
  EngineSetupStatus,
  EngineSetupStep,
  MCPProjectInfo,
  MCPToolDefinition,
  MCPToolResult,
  SelectedEngine,
  UserSettings,
} from '../../shared/types';

export class EngineRegistryService {
  private adapters: Map<NonNullable<SelectedEngine>, IEngineMCPService>;
  private currentEngine: SelectedEngine = null;
  private statusCallbacks: Array<(status: EngineMCPStatus, error?: string) => void> = [];

  constructor(unrealAdapter: UnrealMCPAdapter) {
    this.adapters = new Map([
      ['unreal', unrealAdapter as IEngineMCPService],
      ['uefn', new UEFNMCPAdapter()],
      ['godot', new GodotMCPAdapter()],
      ['unity', new UnityMCPAdapter()],
      ['blender', new BlenderMCPAdapter()],
      ['roblox', new RobloxMCPAdapter()],
    ]);

    // Wire status callbacks through for all adapters (only propagate when active)
    for (const [engine, adapter] of this.adapters) {
      adapter.onStatusChange((status, error) => {
        if (this.currentEngine === engine) {
          for (const cb of this.statusCallbacks) cb(status, error);
        }
      });
    }
  }

  setEngine(engine: SelectedEngine): void {
    this.currentEngine = engine;
  }

  getEngine(): SelectedEngine {
    return this.currentEngine;
  }

  getActiveAdapter(): IEngineMCPService | null {
    if (!this.currentEngine) return null;
    return this.adapters.get(this.currentEngine) ?? null;
  }

  getAdapterFor(engine: SelectedEngine): IEngineMCPService | null {
    if (!engine) return null;
    return this.adapters.get(engine) ?? null;
  }

  onStatusChange(cb: (status: EngineMCPStatus, error?: string) => void): void {
    this.statusCallbacks.push(cb);
  }

  // ===== Delegate methods =====

  getStatus(): EngineMCPStatus {
    return this.getActiveAdapter()?.getStatus() ?? 'disconnected';
  }

  async start(settings: UserSettings): Promise<{ success: boolean; error?: string }> {
    const adapter = this.getActiveAdapter();
    if (!adapter) return { success: false, error: 'No engine selected' };
    return adapter.start(settings);
  }

  async stop(): Promise<void> {
    await this.getActiveAdapter()?.stop();
  }

  getTools(): MCPToolDefinition[] {
    return this.getActiveAdapter()?.getTools() ?? [];
  }

  async callTool(name: string, args: Record<string, unknown>): Promise<MCPToolResult> {
    const adapter = this.getActiveAdapter();
    if (!adapter) return { success: false, error: 'No engine selected' };
    return adapter.callTool(name, args);
  }

  async getEditorSnapshot(): Promise<string> {
    return this.getActiveAdapter()?.getEditorSnapshot() ?? '';
  }

  async testConnection(): Promise<MCPProjectInfo | null> {
    return this.getActiveAdapter()?.testConnection() ?? null;
  }

  async checkSetup(engine: SelectedEngine): Promise<EngineSetupStatus | null> {
    const adapter = this.getAdapterFor(engine);
    return adapter?.checkSetup() ?? null;
  }

  async installDeps(engine: SelectedEngine): Promise<{ success: boolean; error?: string }> {
    const adapter = this.getAdapterFor(engine);
    return adapter?.installDeps() ?? { success: false, error: 'Unknown engine' };
  }

  getSetupSteps(engine: SelectedEngine): EngineSetupStep[] {
    const adapter = this.getAdapterFor(engine);
    return adapter?.getSetupSteps() ?? [];
  }

  // ===== Auto-detect engine from screenshot =====

  async autoDetectEngine(
    screenshot: CaptureResult | null,
    detectFn: (screenshot: CaptureResult | null) => Promise<string>
  ): Promise<SelectedEngine> {
    try {
      const raw = await detectFn(screenshot);
      const normalized = raw.trim().toLowerCase();
      const valid: NonNullable<SelectedEngine>[] = ['unreal', 'uefn', 'godot', 'unity', 'blender', 'roblox'];
      return valid.find(e => normalized.includes(e)) ?? null;
    } catch {
      return null;
    }
  }
}
