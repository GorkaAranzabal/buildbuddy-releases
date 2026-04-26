import { spawn, type ChildProcess } from 'child_process';
import path from 'path';
import fs from 'fs';
import https from 'https';
import { app } from 'electron';
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

const BINARY_BASE_URL = 'https://github.com/Roblox/studio-rust-mcp-server/releases/latest/download';

function getBinaryInfo(): { filename: string; downloadUrl: string } {
  if (process.platform === 'win32') {
    return {
      filename: 'rbx-studio-mcp.exe',
      downloadUrl: `${BINARY_BASE_URL}/rbx-studio-mcp.exe`,
    };
  }
  // macOS — zip file
  return {
    filename: 'rbx-studio-mcp',
    downloadUrl: `${BINARY_BASE_URL}/macOS-rbx-studio-mcp.zip`,
  };
}

const SETUP_STEPS: EngineSetupStep[] = [
  {
    n: 1,
    title: 'Download Roblox MCP server (automatic)',
    desc: 'Build Buddy will automatically download the official Roblox Studio MCP server binary.',
    isAutomatic: true,
  },
  {
    n: 2,
    title: 'Restart Roblox Studio',
    desc: 'After the server downloads, restart Roblox Studio once. The MCP server will auto-connect to Studio on next launch.',
    isAutomatic: false,
  },
];

export class RobloxMCPAdapter implements IEngineMCPService {
  private status: EngineMCPStatus = 'disconnected';
  private statusCallbacks: Array<(s: EngineMCPStatus, error?: string) => void> = [];
  private process: ChildProcess | null = null;
  private tools: MCPToolDefinition[] = [];
  private binaryDir: string;
  private binaryPath: string;

  constructor() {
    this.binaryDir = path.join(app.getPath('userData'), 'roblox-mcp');
    const { filename } = getBinaryInfo();
    this.binaryPath = path.join(this.binaryDir, filename);
  }

  private setStatus(s: EngineMCPStatus) {
    this.status = s;
    for (const cb of this.statusCallbacks) cb(s);
  }

  getStatus(): EngineMCPStatus { return this.status; }

  onStatusChange(cb: (status: EngineMCPStatus, error?: string) => void): void {
    this.statusCallbacks.push(cb);
  }

  getTools(): MCPToolDefinition[] { return this.tools; }

  getSetupSteps(): EngineSetupStep[] { return SETUP_STEPS; }

  async checkSetup(): Promise<EngineSetupStatus> {
    const pendingSteps: EngineSetupStep[] = [];

    if (!fs.existsSync(this.binaryPath)) {
      pendingSteps.push(SETUP_STEPS[0]);
    }

    // Step 2 (restart Studio) always shows on first setup
    pendingSteps.push(SETUP_STEPS[1]);

    return {
      engine: 'roblox',
      stepsComplete: pendingSteps.length === 0,
      pendingSteps,
    };
  }

  private downloadFile(url: string, destPath: string): Promise<void> {
    return new Promise((resolve, reject) => {
      if (!fs.existsSync(this.binaryDir)) {
        fs.mkdirSync(this.binaryDir, { recursive: true });
      }

      const file = fs.createWriteStream(destPath);

      const request = (requestUrl: string, depth = 0) => {
        if (depth > 5) { reject(new Error('Too many redirects')); return; }
        https.get(requestUrl, (res) => {
          if (res.statusCode === 301 || res.statusCode === 302) {
            request(res.headers.location!, depth + 1);
            return;
          }
          res.pipe(file);
          file.on('finish', () => { file.close(); resolve(); });
        }).on('error', (err) => {
          fs.unlink(destPath, () => {});
          reject(err);
        });
      };

      request(url);
    });
  }

  async installDeps(): Promise<{ success: boolean; error?: string }> {
    try {
      if (fs.existsSync(this.binaryPath)) return { success: true };

      const { downloadUrl, filename } = getBinaryInfo();

      if (process.platform === 'win32') {
        await this.downloadFile(downloadUrl, this.binaryPath);
      } else {
        // macOS: download zip and extract
        const zipPath = path.join(this.binaryDir, 'rbx-studio-mcp.zip');
        await this.downloadFile(downloadUrl, zipPath);

        const { execSync } = await import('child_process');
        execSync(`unzip -o "${zipPath}" -d "${this.binaryDir}"`, { stdio: 'pipe' });
        fs.unlinkSync(zipPath);

        // Make binary executable
        fs.chmodSync(this.binaryPath, 0o755);
      }

      console.log(`[RobloxMCP] Binary downloaded to ${this.binaryPath}`);
      return { success: true };
    } catch (err) {
      return { success: false, error: err instanceof Error ? err.message : String(err) };
    }
  }

  async start(_settings: UserSettings): Promise<{ success: boolean; error?: string }> {
    if (this.status === 'connected' || this.status === 'starting') return { success: true };
    this.setStatus('starting');

    try {
      if (!fs.existsSync(this.binaryPath)) {
        this.setStatus('error');
        return { success: false, error: 'Roblox MCP binary not found. Run setup first.' };
      }

      this.process = spawn(this.binaryPath, [], { stdio: ['pipe', 'pipe', 'pipe'] });

      this.process.on('exit', () => {
        this.setStatus('disconnected');
        this.tools = [];
        this.process = null;
      });

      this.process.on('error', (err) => {
        console.error('[RobloxMCP] Process error:', err);
        this.setStatus('error');
      });

      await new Promise(r => setTimeout(r, 1500));

      if (!this.process || this.process.exitCode !== null) {
        this.setStatus('error');
        return { success: false, error: 'Roblox MCP server failed to start. Make sure Roblox Studio is open.' };
      }

      this.tools = ROBLOX_TOOLS;
      this.setStatus('connected');
      return { success: true };
    } catch (err) {
      this.setStatus('error');
      return { success: false, error: err instanceof Error ? err.message : String(err) };
    }
  }

  async stop(): Promise<void> {
    if (this.process) {
      this.process.kill();
      this.process = null;
    }
    this.tools = [];
    this.setStatus('disconnected');
  }

  async callTool(name: string, _args: Record<string, unknown>): Promise<MCPToolResult> {
    if (this.status !== 'connected') {
      return { success: false, error: 'Not connected to Roblox Studio' };
    }
    return { success: false, error: `Tool ${name} not yet implemented for Roblox` };
  }

  async getEditorSnapshot(): Promise<string> {
    return '';
  }

  async testConnection(): Promise<MCPProjectInfo | null> {
    if (this.status !== 'connected') return null;
    return { projectName: 'Roblox Place', engineVersion: 'Studio', projectPath: '' };
  }
}

const ROBLOX_TOOLS: MCPToolDefinition[] = [
  {
    name: 'roblox_run_code',
    description: 'Execute Lua code in Roblox Studio',
    inputSchema: { type: 'object', properties: { code: { type: 'string' } }, required: ['code'] },
  },
  {
    name: 'roblox_get_workspace',
    description: 'Get the current workspace hierarchy',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'roblox_insert_model',
    description: 'Insert a model into the workspace',
    inputSchema: {
      type: 'object',
      properties: { assetId: { type: 'string' }, name: { type: 'string' } },
      required: ['assetId'],
    },
  },
];
