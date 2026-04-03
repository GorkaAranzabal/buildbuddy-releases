import { execSync } from 'child_process';
import path from 'path';
import fs from 'fs';
import https from 'https';
import { app } from 'electron';
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

const ADDON_URL = 'https://raw.githubusercontent.com/ahujasid/blender-mcp/main/addon.py';

const SETUP_STEPS: EngineSetupStep[] = [
  {
    n: 1,
    title: 'Install uv package manager (automatic)',
    desc: 'Build Buddy will install uv automatically (macOS: brew install uv / Windows: PowerShell script).',
    isAutomatic: true,
  },
  {
    n: 2,
    title: 'Install Blender addon',
    desc: 'Click "Do it for me" — Build Buddy will install and enable the addon in Blender automatically. Blender must be closed while this runs.',
    isAutomatic: false,
    warn: 'You need to do this once per Blender installation.',
  },
  {
    n: 3,
    title: 'Start the server in Blender',
    desc: 'Open Blender → press N to open the sidebar → click the "BlenderMCP" tab → click "Start Server".\n\nYou need to do this each time you open Blender before connecting.',
    isAutomatic: false,
  },
];

export class BlenderMCPAdapter implements IEngineMCPService {
  private status: EngineMCPStatus = 'disconnected';
  private statusCallbacks: Array<(s: EngineMCPStatus) => void> = [];
  private mcpClient: any = null;
  private tools: MCPToolDefinition[] = [];
  private addonPath: string;

  constructor() {
    this.addonPath = path.join(app.getPath('userData'), 'blender-mcp', 'addon.py');
  }

  private setStatus(s: EngineMCPStatus) {
    this.status = s;
    for (const cb of this.statusCallbacks) cb(s);
  }

  getStatus(): EngineMCPStatus { return this.status; }
  onStatusChange(cb: (status: EngineMCPStatus) => void): void { this.statusCallbacks.push(cb); }
  getTools(): MCPToolDefinition[] { return this.tools; }

  getSetupSteps(): EngineSetupStep[] {
    return SETUP_STEPS;
  }

  async checkSetup(): Promise<EngineSetupStatus> {
    const pendingSteps: EngineSetupStep[] = [];
    if (!this.isUvInstalled()) pendingSteps.push(SETUP_STEPS[0]);
    pendingSteps.push(SETUP_STEPS[1]);
    pendingSteps.push(SETUP_STEPS[2]);
    return { engine: 'blender', stepsComplete: pendingSteps.length === 0, pendingSteps };
  }

  private isUvInstalled(): boolean {
    try {
      execSync('uv --version', { stdio: 'ignore', timeout: 3000 });
      return true;
    } catch {
      return false;
    }
  }

  private downloadAddon(): Promise<void> {
    return new Promise((resolve, reject) => {
      const dir = path.dirname(this.addonPath);
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      const file = fs.createWriteStream(this.addonPath);
      https.get(ADDON_URL, (res) => {
        res.pipe(file);
        file.on('finish', () => { file.close(); resolve(); });
      }).on('error', (err) => {
        fs.unlink(this.addonPath, () => {});
        reject(err);
      });
    });
  }

  async installDeps(): Promise<{ success: boolean; error?: string }> {
    try {
      if (!fs.existsSync(this.addonPath)) {
        await this.downloadAddon();
      }
      if (!this.isUvInstalled()) {
        const platform = process.platform;
        if (platform === 'darwin' || platform === 'linux') {
          execSync('curl -LsSf https://astral.sh/uv/install.sh | sh', {
            stdio: 'pipe', timeout: 120000, shell: '/bin/bash',
          });
        } else if (platform === 'win32') {
          execSync('powershell -c "irm https://astral.sh/uv/install.ps1 | iex"', {
            stdio: 'pipe', timeout: 120000,
          });
        } else {
          return { success: false, error: `Unsupported platform: ${platform}` };
        }
      }
      return { success: true };
    } catch (err) {
      return { success: false, error: err instanceof Error ? err.message : String(err) };
    }
  }

  async start(_settings: UserSettings): Promise<{ success: boolean; error?: string }> {
    if (this.status === 'connected' || this.status === 'starting') return { success: true };
    this.setStatus('starting');

    try {
      if (!this.isUvInstalled()) {
        this.setStatus('error');
        return { success: false, error: 'uv is not installed. Run setup first.' };
      }

      const { Client } = _require('@modelcontextprotocol/sdk/client/index.js');
      const { StdioClientTransport } = _require('@modelcontextprotocol/sdk/client/stdio.js');

      // Resolve uv path — on macOS it installs to ~/.local/bin or ~/.cargo/bin
      const uvPath = this.resolveUvPath();

      const transport = new StdioClientTransport({
        command: uvPath,
        args: ['blender-mcp'],
        env: { ...(process.env as Record<string, string>) },
      });

      this.mcpClient = new Client({ name: 'build-buddy', version: '1.0.0' });

      transport.onclose = () => {
        this.mcpClient = null;
        this.tools = [];
        this.setStatus('disconnected');
      };

      await this.mcpClient.connect(transport);
      console.log('[BlenderMCP] Connected to blender-mcp server');

      const { tools: rawTools } = await this.mcpClient.listTools();
      console.log(`[BlenderMCP] Got ${rawTools.length} tools`);
      console.log('[BlenderMCP] Tools:', rawTools.map((t: any) => t.name).join(', '));
      this.tools = rawTools.map((t: any) => ({
        name: t.name,
        description: t.description ?? '',
        inputSchema: t.inputSchema ?? { type: 'object', properties: {} },
      }));

      // Verify Blender's addon socket server is actually running before going green
      try {
        await this.mcpClient.callTool({ name: 'get_scene_info', arguments: {} });
      } catch (err) {
        this.mcpClient = null;
        this.setStatus('error');
        return { success: false, error: 'Blender addon server not running. In Blender, press N → BlenderMCP tab → Start Server, then reconnect.' };
      }

      this.setStatus('connected');
      return { success: true };
    } catch (err) {
      this.mcpClient = null;
      this.setStatus('error');
      return { success: false, error: err instanceof Error ? err.message : String(err) };
    }
  }

  private resolveUvPath(): string {
    const candidates = [
      'uvx',
      path.join(process.env.HOME ?? '', '.local', 'bin', 'uvx'),
      path.join(process.env.HOME ?? '', '.cargo', 'bin', 'uvx'),
      '/usr/local/bin/uvx',
    ];
    for (const p of candidates) {
      try {
        execSync(`"${p}" --version`, { stdio: 'ignore', timeout: 3000 });
        return p;
      } catch { /* try next */ }
    }
    return 'uvx'; // fallback
  }

  async stop(): Promise<void> {
    if (this.mcpClient) {
      try { await this.mcpClient.close(); } catch { /* ignore */ }
      this.mcpClient = null;
    }
    this.tools = [];
    this.setStatus('disconnected');
  }

  async callTool(name: string, args: Record<string, unknown>): Promise<MCPToolResult> {
    if (this.status !== 'connected' || !this.mcpClient) {
      return { success: false, error: 'Not connected to Blender' };
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
    return { projectName: 'Blender Scene', engineVersion: '4.x', projectPath: '' };
  }

  getAddonPath(): string {
    return this.addonPath;
  }
}
