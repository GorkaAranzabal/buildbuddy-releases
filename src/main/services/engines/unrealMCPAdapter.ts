import type { IEngineMCPService } from '../engineMCPService';
import type { UnrealMCPService } from '../unrealMCPService';
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

export class UnrealMCPAdapter implements IEngineMCPService {
  constructor(private service: UnrealMCPService) {}

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
    return this.service.callTool(name, args);
  }

  getEditorSnapshot(): Promise<string> {
    return this.service.getEditorSnapshot();
  }

  testConnection(): Promise<MCPProjectInfo | null> {
    return this.service.testConnection();
  }

  onStatusChange(cb: (status: EngineMCPStatus) => void): void {
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
}
