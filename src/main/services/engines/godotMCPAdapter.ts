import { existsSync, cpSync, mkdirSync, readdirSync } from 'fs';
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
    title: 'Install addon to your Godot project',
    desc: 'Build Buddy will copy the MCP plugin into your project. Click "Do it for me" and select your Godot project folder.',
    isAutomatic: false,
    warn: 'In Godot: Project → Project Settings → Plugins\nEnable all 3 plugins:\n• Godot MCP Auto Reload\n• Godot MCP Editor\n• Godot MCP Runtime',
  },
];

export class GodotMCPAdapter implements IEngineMCPService {
  private status: EngineMCPStatus = 'disconnected';
  private statusCallbacks: Array<(s: EngineMCPStatus, error?: string) => void> = [];
  private mcpClient: any = null;
  private tools: MCPToolDefinition[] = [];
  private gopeakCliPath: string = '';
  private lastSettings: UserSettings | null = null;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  // Captured from gopeak's stderr ("Godot ready: <path>") once the editor plugin
  // reports its project. The AI uses this to pass a real `directory` arg to
  // project__* tools instead of gopeak's container default `/workspace`.
  private projectPath: string | null = null;

  setGopeakCliPath(p: string): void {
    this.gopeakCliPath = p;
  }

  private setStatus(s: EngineMCPStatus) {
    this.status = s;
    for (const cb of this.statusCallbacks) cb(s);
  }

  getStatus(): EngineMCPStatus { return this.status; }
  onStatusChange(cb: (status: EngineMCPStatus, error?: string) => void): void { this.statusCallbacks.push(cb); }
  // These tools are broken or destructive: editor.status always parse-errors,
  // editor.launch opens a second Godot window, editor.run/stop/debug_output are not needed.
  private static readonly BLOCKED_TOOLS = new Set([
    'editor.status', 'editor.launch', 'editor.run', 'editor.stop', 'editor.debug_output',
  ]);

  getTools(): MCPToolDefinition[] {
    return this.tools.filter(t => !GodotMCPAdapter.BLOCKED_TOOLS.has(t.name));
  }
  getSetupSteps(): EngineSetupStep[] { return SETUP_STEPS; }

  async checkSetup(): Promise<EngineSetupStatus> {
    // Addon step is always shown — can't verify it was copied + enabled from outside Godot
    return {
      engine: 'godot',
      stepsComplete: false,
      pendingSteps: [SETUP_STEPS[0]],
    };
  }

  async installDeps(): Promise<{ success: boolean; error?: string }> {
    // gopeak is bundled with the app — no global install needed
    return { success: true };
  }

  /** Copy the bundled Godot addon files into the user's Godot project's addons/ folder. */
  installAddonToProject(addonSrc: string, projectPath: string): { success: boolean; error?: string } {
    try {
      if (!existsSync(addonSrc)) {
        return { success: false, error: `Addon source not found at: ${addonSrc}` };
      }
      const addonDest = path.join(projectPath, 'addons');
      mkdirSync(addonDest, { recursive: true });
      cpSync(addonSrc, addonDest, { recursive: true });
      return { success: true };
    } catch (err) {
      return { success: false, error: err instanceof Error ? err.message : String(err) };
    }
  }

  private detectGodotPath(): string | null {
    const home = process.env.HOME ?? '';
    const searchDirs = ['/Applications', `${home}/Applications`, `${home}/Downloads`, `${home}/Desktop`];
    for (const dir of searchDirs) {
      try {
        const apps = readdirSync(dir).filter(
          (name) => name.toLowerCase().startsWith('godot') && name.endsWith('.app')
        );
        for (const app of apps) {
          const bin = path.join(dir, app, 'Contents', 'MacOS', 'Godot');
          if (existsSync(bin)) {
            console.log('[GodotMCP] Detected Godot path:', bin);
            return bin;
          }
        }
      } catch { /* dir doesn't exist or unreadable */ }
    }
    return null;
  }

  async start(_settings: UserSettings): Promise<{ success: boolean; error?: string }> {
    if (this.status === 'connected' || this.status === 'starting') return { success: true };
    this.lastSettings = _settings;
    this.setStatus('starting');

    try {
      // Resolve gopeak CLI: use explicitly set path, or fall back to node_modules relative to cwd
      const cliPath = this.gopeakCliPath ||
        path.join(process.cwd(), 'node_modules', 'gopeak', 'build', 'cli.js');

      if (!existsSync(cliPath)) {
        this.setStatus('error');
        return { success: false, error: `GoPeak CLI not found at: ${cliPath}` };
      }
      console.log('[GodotMCP] Spawning gopeak CLI from:', cliPath, '(packaged:', !!process.resourcesPath, ')');

      // Use MCP SDK Client + StdioClientTransport to connect to gopeak
      const { Client } = _require('@modelcontextprotocol/sdk/client/index.js');
      const { StdioClientTransport } = _require('@modelcontextprotocol/sdk/client/stdio.js');

      const godotPath = this.detectGodotPath();
      const env: Record<string, string> = {
        ...(process.env as Record<string, string>),
        ELECTRON_RUN_AS_NODE: '1', // run process.execPath as plain Node, not Electron
        GOPEAK_TOOL_PROFILE: 'compact',
      };
      if (godotPath) env.GODOT_PATH = godotPath;

      const transport = new StdioClientTransport({
        command: process.execPath, // node (Electron binary running as Node via ELECTRON_RUN_AS_NODE)
        args: [cliPath],
        env,
        stderr: 'pipe',
      });

      const stderrStream = (transport as any).stderr;
      if (stderrStream) {
        stderrStream.on('data', (chunk: Buffer | string) => {
          const text = typeof chunk === 'string' ? chunk : chunk.toString('utf8');
          const m = text.match(/Godot ready:\s*(\S+)/);
          if (m) {
            this.projectPath = m[1].replace(/\/+$/, '');
            console.log('[GodotMCP] Captured project path:', this.projectPath);
          }
          console.log('[GodotMCP][gopeak stderr]', text.trimEnd());
        });
      }

      this.mcpClient = new Client({ name: 'build-buddy', version: '1.0.0' });

      // Handle transport close → auto-reconnect (Godot reloads scripts/scenes which drops the connection)
      transport.onclose = () => {
        console.log('[GodotMCP] Transport closed (gopeak subprocess exited)');
        this.mcpClient = null;
        this.projectPath = null; // re-captured on reconnect from gopeak stderr
        // Keep this.tools so the AI still sees tools and keeps calling them during reconnect
        if (this.status !== 'disconnected') {
          console.log('[GodotMCP] Connection dropped, auto-reconnecting in 3s...');
          this.setStatus('starting');
          if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
          this.reconnectTimer = setTimeout(() => {
            this.reconnectTimer = null;
            this.start(this.lastSettings!).catch(() => {
              this.tools = [];
              this.setStatus('disconnected');
            });
          }, 3000);
        }
      };

      await Promise.race([
        this.mcpClient.connect(transport),
        new Promise((_, reject) =>
          setTimeout(() => reject(new Error('gopeak MCP connect timed out after 20s')), 20_000)
        ),
      ]);
      console.log('[GodotMCP] Connected to gopeak MCP server');

      // Fetch the real tool list from gopeak
      const { tools: rawTools } = await this.mcpClient.listTools();
      console.log(`[GodotMCP] Got ${rawTools.length} tools from gopeak`);
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
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    if (this.mcpClient) {
      try { await this.mcpClient.close(); } catch { /* ignore */ }
      this.mcpClient = null;
    }
    this.tools = []; // intentional stop — clear tools
    this.projectPath = null;
    this.setStatus('disconnected');
  }

  async callTool(name: string, args: Record<string, unknown>): Promise<MCPToolResult> {
    // If reconnecting after transport drop, wait up to 10s for gopeak to come back
    if (this.status === 'starting') {
      console.log('[GodotMCP] Waiting for reconnect before calling tool...');
      for (let i = 0; i < 20; i++) {
        await new Promise(r => setTimeout(r, 500));
        if (this.status === 'connected') break;
      }
    }
    if (this.status !== 'connected' || !this.mcpClient) {
      return { success: false, error: 'Not connected to Godot editor — Godot may still be reloading. Please wait a moment and try again.' };
    }
    try {
      const result = await this.mcpClient.callTool({ name, arguments: args });
      const text = result.content
        ?.filter((c: any) => c.type === 'text')
        .map((c: any) => c.text)
        .join('\n') ?? '';

      // Detect gopeak "editor not connected" responses and retry up to 8 times (covers 30s max backoff)
      const isEditorDisconnected = /not connected|no client|plugin.*not.*enabled|editor.*not.*running|connection.*refused|failed to connect|bridge.*error|bridge.*not/i.test(text);
      if (isEditorDisconnected) {
        console.log('[GodotMCP] Editor not connected, retrying in 4s...');
        for (let attempt = 0; attempt < 8; attempt++) {
          await new Promise(r => setTimeout(r, 4000));
          if (this.status !== 'connected' || !this.mcpClient) break;
          const retry = await this.mcpClient.callTool({ name, arguments: args });
          const retryText = retry.content?.filter((c: any) => c.type === 'text').map((c: any) => c.text).join('\n') ?? '';
          const stillDisconnected = /not connected|no client|plugin.*not.*enabled|editor.*not.*running|connection.*refused|failed to connect|bridge.*error|bridge.*not/i.test(retryText);
          if (!stillDisconnected) return { success: true, data: retryText };
        }
        return { success: false, error: `Godot editor plugin is not responding. Make sure the 3 MCP plugins are enabled in Project → Project Settings → Plugins, then reload the project and try again.` };
      }

      return { success: true, data: text };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      const isTimeout = msg.includes('timed out') || msg.includes('timeout') || msg.includes('-32001');
      if (isTimeout) {
        // Bridge timed out — editor plugin likely in backoff cycle. Retry up to 8x (covers 30s max).
        const BRIDGE_ERROR = /not connected|no client|plugin.*not.*enabled|editor.*not.*running|connection.*refused|failed to connect|bridge.*error|bridge.*not/i;
        for (let attempt = 0; attempt < 8; attempt++) {
          await new Promise(r => setTimeout(r, 4000));
          if (this.status !== 'connected' || !this.mcpClient) break;
          try {
            const retry = await this.mcpClient.callTool({ name, arguments: args });
            const retryText = retry.content?.filter((c: any) => c.type === 'text').map((c: any) => c.text).join('\n') ?? '';
            if (!BRIDGE_ERROR.test(retryText)) return { success: true, data: retryText };
          } catch (retryErr) {
            const retryMsg = retryErr instanceof Error ? retryErr.message : String(retryErr);
            const stillTimeout = retryMsg.includes('timed out') || retryMsg.includes('timeout') || retryMsg.includes('-32001');
            if (!stillTimeout) return { success: false, error: retryMsg };
            // still timing out → continue retrying
          }
        }
        return { success: false, error: `Godot editor plugin is not responding. Make sure the 3 MCP plugins are enabled in Project → Project Settings → Plugins, then reload the project and try again.` };
      }
      return { success: false, error: msg };
    }
  }

  async getEditorSnapshot(): Promise<string> {
    if (this.status !== 'connected' || !this.mcpClient) return '';
    const lines: string[] = [];
    if (this.projectPath) {
      lines.push(`Godot project root: ${this.projectPath}`);
      lines.push(
        `IMPORTANT: when calling project__list, project__read, project__write, or any project__* tool, ALWAYS pass directory: "${this.projectPath}" (or a subpath of it). Do NOT use "/workspace" — that is gopeak's Docker default and does not exist on this machine.`
      );
    } else {
      lines.push('Godot project path not yet known — call project__info first to discover it before any project__list / project__read calls. Do NOT pass "/workspace" as a directory.');
    }
    try {
      const result = await this.mcpClient.callTool({
        name: 'scene__get_tree',
        arguments: {},
      });
      const tree = result.content
        ?.filter((c: any) => c.type === 'text')
        .map((c: any) => c.text)
        .join('\n') ?? '';
      if (tree) {
        lines.push('');
        lines.push('Current scene tree:');
        lines.push(tree);
      }
    } catch { /* tree fetch is best-effort */ }
    return lines.join('\n');
  }

  async testConnection(): Promise<MCPProjectInfo | null> {
    if (this.status !== 'connected' || !this.mcpClient) return null;
    try {
      const result = await this.mcpClient.callTool({ name: 'project.get_info', arguments: {} });
      const text = result.content?.find((c: any) => c.type === 'text')?.text ?? '';
      return { projectName: text || 'Godot Project', engineVersion: '4.x', projectPath: '' };
    } catch {
      return { projectName: 'Godot Project', engineVersion: '4.x', projectPath: '' };
    }
  }
}
