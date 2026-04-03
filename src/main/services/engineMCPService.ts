import type {
  EngineMCPStatus,
  EngineSetupStatus,
  EngineSetupStep,
  MCPProjectInfo,
  MCPToolDefinition,
  MCPToolResult,
  SelectedEngine,
  UserSettings,
} from '../../shared/types';

export interface IEngineMCPService {
  getStatus(): EngineMCPStatus;
  start(settings: UserSettings): Promise<{ success: boolean; error?: string }>;
  stop(): Promise<void>;
  getTools(): MCPToolDefinition[];
  callTool(name: string, args: Record<string, unknown>): Promise<MCPToolResult>;
  getEditorSnapshot(): Promise<string>;
  testConnection(): Promise<MCPProjectInfo | null>;
  onStatusChange(cb: (status: EngineMCPStatus) => void): void;
  getSetupSteps(): EngineSetupStep[];
  checkSetup(): Promise<EngineSetupStatus>;
  installDeps(): Promise<{ success: boolean; error?: string }>;
}

export type { EngineMCPStatus, EngineSetupStatus, EngineSetupStep, MCPProjectInfo, MCPToolDefinition, MCPToolResult, SelectedEngine, UserSettings };
