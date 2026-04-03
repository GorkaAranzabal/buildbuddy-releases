import { existsSync, readdirSync, writeFileSync, mkdirSync } from 'fs';
import path from 'path';
import { createRequire } from 'module';
import type { IEngineMCPService } from '../engineMCPService';
import type {
  EngineMCPStatus,
  EngineSetupStatus,
  EngineSetupStep,
  MCPProjectInfo,
  MCPToolDefinition,
  MCPToolResult,
  UserSettings,
} from '../../../shared/types';

const _require = createRequire(import.meta.url);

const SETUP_STEPS: EngineSetupStep[] = [
  {
    n: 1,
    title: 'Install mcp-unity Package in Unity',
    desc: 'Open Unity → Window → Package Manager → Add package from Git URL:\nhttps://github.com/CoderGamester/mcp-unity.git\n\nWait for Unity to finish compiling before continuing.',
    isAutomatic: false,
  },
  {
    n: 2,
    title: 'Select your Unity project folder',
    desc: 'Build Buddy will find the MCP server inside the installed package and build it automatically.',
    isAutomatic: false,
  },
];

/** Custom tool injected by Build Buddy — mcp-unity has no native file-writing tool. */
const WRITE_SCRIPT_TOOL: MCPToolDefinition = {
  name: 'write_script',
  description: 'Creates or overwrites a C# script file in the Unity project Assets folder. Use this to create new MonoBehaviour scripts or update existing ones. After writing, Unity will recompile automatically.',
  inputSchema: {
    type: 'object',
    properties: {
      scriptName: { type: 'string', description: 'Script filename without .cs extension (e.g. "EnemyAI")' },
      content: { type: 'string', description: 'Full C# source code' },
      folder: { type: 'string', description: 'Subfolder within Assets (e.g. "Scripts"). Defaults to root Assets folder.' },
    },
    required: ['scriptName', 'content'],
  },
};

export class UnityMCPAdapter implements IEngineMCPService {
  private status: EngineMCPStatus = 'disconnected';
  private statusCallbacks: Array<(s: EngineMCPStatus) => void> = [];
  private mcpClient: any = null;
  private tools: MCPToolDefinition[] = [];
  private projectPath: string = '';

  private setStatus(s: EngineMCPStatus) {
    this.status = s;
    for (const cb of this.statusCallbacks) cb(s);
  }

  getStatus(): EngineMCPStatus { return this.status; }
  onStatusChange(cb: (status: EngineMCPStatus) => void): void { this.statusCallbacks.push(cb); }
  getTools(): MCPToolDefinition[] { return [WRITE_SCRIPT_TOOL, ...this.tools]; }
  getSetupSteps(): EngineSetupStep[] { return SETUP_STEPS; }

  async checkSetup(): Promise<EngineSetupStatus> {
    return {
      engine: 'unity',
      stepsComplete: false,
      pendingSteps: SETUP_STEPS,
    };
  }

  async installDeps(): Promise<{ success: boolean; error?: string }> {
    return { success: true };
  }

  /** Find the built mcp-unity Node.js server inside the Unity project's package cache. */
  private findServerPath(projectPath: string): string | null {
    const cacheDir = path.join(projectPath, 'Library', 'PackageCache');
    if (existsSync(cacheDir)) {
      const entries = readdirSync(cacheDir).filter(e =>
        e.toLowerCase().includes('mcp-unity@') || e.toLowerCase().includes('mcp_unity@')
      );
      for (const entry of entries) {
        const p = path.join(cacheDir, entry, 'Server~', 'build', 'index.js');
        if (existsSync(p)) return p;
      }
    }
    const localPath = path.join(projectPath, 'Packages', 'mcp-unity', 'Server~', 'build', 'index.js');
    if (existsSync(localPath)) return localPath;
    return null;
  }

  async start(settings: UserSettings): Promise<{ success: boolean; error?: string }> {
    if (this.status === 'connected' || this.status === 'starting') return { success: true };
    this.setStatus('starting');

    try {
      const projectPath = settings.unityProjectPath;
      if (!projectPath) {
        this.setStatus('error');
        return { success: false, error: 'No Unity project selected. Click "Do it for me" to select your project folder.' };
      }

      const serverPath = this.findServerPath(projectPath);
      if (!serverPath) {
        this.setStatus('error');
        return { success: false, error: 'MCP server not found in Unity project. Make sure the mcp-unity package is installed and click "Do it for me" to build the server.' };
      }

      this.projectPath = projectPath;

      const { Client } = _require('@modelcontextprotocol/sdk/client/index.js');
      const { StdioClientTransport } = _require('@modelcontextprotocol/sdk/client/stdio.js');

      const transport = new StdioClientTransport({
        command: process.execPath,
        args: [serverPath],
        env: { ...(process.env as Record<string, string>), ELECTRON_RUN_AS_NODE: '1' },
      });

      this.mcpClient = new Client({ name: 'build-buddy', version: '1.0.0' });

      transport.onclose = () => {
        this.mcpClient = null;
        this.tools = [];
        this.setStatus('disconnected');
      };

      await this.mcpClient.connect(transport);
      console.log('[UnityMCP] Connected to mcp-unity server');

      const { tools: rawTools } = await this.mcpClient.listTools();
      console.log(`[UnityMCP] Got ${rawTools.length} tools from mcp-unity`);
      console.log('[UnityMCP] Tools:', rawTools.map((t: any) => t.name).join(', '));
      this.tools = rawTools.map((t: any) => ({
        name: t.name,
        description: t.description ?? '',
        inputSchema: t.inputSchema ?? { type: 'object', properties: {} },
      }));

      this.setStatus('connected');
      return { success: true };
    } catch (err) {
      this.mcpClient = null;
      this.setStatus('error');
      return { success: false, error: err instanceof Error ? err.message : String(err) };
    }
  }

  async stop(): Promise<void> {
    if (this.mcpClient) {
      try { await this.mcpClient.close(); } catch { /* ignore */ }
      this.mcpClient = null;
    }
    this.tools = [];
    this.projectPath = '';
    this.setStatus('disconnected');
  }

  async callTool(name: string, args: Record<string, unknown>): Promise<MCPToolResult> {
    if (this.status !== 'connected' || !this.mcpClient) {
      return { success: false, error: 'Not connected to Unity editor' };
    }

    // Handle our custom write_script tool locally
    if (name === 'write_script') {
      return this.handleWriteScript(args);
    }

    try {
      const result = await this.mcpClient.callTool({ name, arguments: args });
      const text = result.content
        ?.filter((c: any) => c.type === 'text')
        .map((c: any) => c.text)
        .join('\n') ?? '';
      return { success: true, data: text };
    } catch (err) {
      return { success: false, error: err instanceof Error ? err.message : String(err) };
    }
  }

  private async handleWriteScript(args: Record<string, unknown>): Promise<MCPToolResult> {
    try {
      const scriptName = args.scriptName as string;
      const content = args.content as string;
      const folder = (args.folder as string | undefined) ?? '';

      if (!scriptName || !content) {
        return { success: false, error: 'write_script requires scriptName and content' };
      }
      if (!this.projectPath) {
        return { success: false, error: 'Unity project path not set' };
      }

      const assetsDir = folder
        ? path.join(this.projectPath, 'Assets', folder)
        : path.join(this.projectPath, 'Assets');
      mkdirSync(assetsDir, { recursive: true });

      const filePath = path.join(assetsDir, `${scriptName}.cs`);
      writeFileSync(filePath, content, 'utf-8');
      console.log(`[UnityMCP] Wrote script: ${filePath}`);

      // Trigger recompile so Unity picks up the new file
      try {
        await this.mcpClient.callTool({ name: 'recompile_scripts', arguments: { returnWithLogs: false } });
      } catch { /* recompile is best-effort */ }

      return { success: true, data: `Script written to Assets/${folder ? folder + '/' : ''}${scriptName}.cs — Unity is recompiling.` };
    } catch (err) {
      return { success: false, error: err instanceof Error ? err.message : String(err) };
    }
  }

  async getEditorSnapshot(): Promise<string> {
    if (this.status !== 'connected' || !this.mcpClient) return '';
    try {
      const result = await this.mcpClient.callTool({ name: 'get_scene_info', arguments: {} });
      return result.content
        ?.filter((c: any) => c.type === 'text')
        .map((c: any) => c.text)
        .join('\n') ?? '';
    } catch { return ''; }
  }

  async testConnection(): Promise<MCPProjectInfo | null> {
    if (this.status !== 'connected' || !this.mcpClient) return null;
    return { projectName: 'Unity Project', engineVersion: '2022+', projectPath: '' };
  }
}
