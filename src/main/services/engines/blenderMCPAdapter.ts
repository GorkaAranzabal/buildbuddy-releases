import { execSync } from 'child_process';
import path from 'path';
import fs from 'fs';
import os from 'os';
import https from 'https';
import net from 'net';
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

const STDERR_RING_MAX = 4096;
const CONNECT_TIMEOUT_MS = 15_000;
const HEALTH_PROBE_INTERVAL_MS = 5_000;
const HEALTH_PROBE_TIMEOUT_MS = 1_500;
const BLENDER_ADDON_HOST = '127.0.0.1';
const BLENDER_ADDON_PORT = 9876;

// blender-mcp's stdio subprocess stays alive even when its TCP socket to
// Blender's addon (127.0.0.1:9876) is refused. Detect that pattern in tool
// results so we can downgrade the connection status to `error` instead of
// staying falsely "connected".
const BLENDER_UNREACHABLE_RE = /Could not connect to Blender|Failed to connect to Blender|Connection refused/i;
const BLENDER_UNREACHABLE_MSG = 'Blender addon socket is not reachable — in Blender, click Disconnect then Connect on the BlenderMCP panel (or restart Blender).';

export class BlenderMCPAdapter implements IEngineMCPService {
  private status: EngineMCPStatus = 'disconnected';
  private statusCallbacks: Array<(s: EngineMCPStatus, error?: string) => void> = [];
  private mcpClient: any = null;
  private tools: MCPToolDefinition[] = [];
  private addonPath: string;
  private stderrBuf = '';
  private healthProbeTimer: ReturnType<typeof setInterval> | null = null;

  constructor() {
    this.addonPath = path.join(app.getPath('userData'), 'blender-mcp', 'addon.py');
  }

  private appendStderr(chunk: string): void {
    this.stderrBuf = (this.stderrBuf + chunk).slice(-STDERR_RING_MAX);
  }

  private stderrTail(): string {
    return this.stderrBuf.trim();
  }

  private lastStderrLine(): string {
    const trimmed = this.stderrBuf.trim();
    if (!trimmed) return '';
    const lines = trimmed.split(/\r?\n/);
    return lines[lines.length - 1] ?? '';
  }

  // GUI-launched apps inherit a minimal PATH (macOS launchd strips shell
  // config; Windows GUIs get registry PATH but sometimes miss user-install
  // dirs for tools installed after session start). Augment PATH for any
  // subprocess that needs to find uv/uvx or tools those invoke.
  private getAugmentedEnv(): NodeJS.ProcessEnv {
    const home = os.homedir();
    const isWin = process.platform === 'win32';
    const extraPaths = isWin
      ? [
          path.join(home, '.local', 'bin'),                                        // astral install.ps1
          path.join(home, '.cargo', 'bin'),                                        // cargo install
          path.join(process.env.LOCALAPPDATA ?? '', 'Microsoft', 'WinGet', 'Links'),// winget shims
          path.join(home, 'scoop', 'shims'),                                       // scoop
          'C:\\ProgramData\\chocolatey\\bin',                                      // chocolatey
        ]
      : [
          '/opt/homebrew/bin',                                                     // Apple Silicon Homebrew
          '/usr/local/bin',                                                        // Intel Homebrew / manual installs
          path.join(home, '.local', 'bin'),                                        // astral install.sh
          path.join(home, '.cargo', 'bin'),                                        // cargo install
        ];
    const existing = process.env.PATH ?? '';
    return {
      ...process.env,
      PATH: [...extraPaths.filter((p) => p && path.isAbsolute(p)), existing]
        .filter(Boolean)
        .join(path.delimiter),
    };
  }

  private logDiagnostic(line: string): void {
    try {
      const logPath = path.join(app.getPath('userData'), 'blender-mcp.log');
      fs.appendFileSync(logPath, `[${new Date().toISOString()}] ${line}\n`);
    } catch { /* best-effort */ }
  }

  private setStatus(s: EngineMCPStatus, error?: string) {
    this.status = s;
    if (s === 'connected') this.startHealthProbe();
    else this.stopHealthProbe();
    for (const cb of this.statusCallbacks) cb(s, error);
  }

  // Cheap TCP probe to Blender's addon socket. blender-mcp's stdio subprocess
  // stays alive even when the Blender addon dies, so we can't trust transport
  // events alone — probe the addon directly so the green dot can't lie.
  private startHealthProbe(): void {
    if (this.healthProbeTimer) return;
    this.healthProbeTimer = setInterval(() => {
      this.probeAddon().then((ok) => {
        if (!ok && this.status === 'connected') {
          this.logDiagnostic(`healthProbe: addon socket unreachable on ${BLENDER_ADDON_HOST}:${BLENDER_ADDON_PORT}`);
          this.setStatus('error', BLENDER_UNREACHABLE_MSG);
        }
      });
    }, HEALTH_PROBE_INTERVAL_MS);
  }

  private stopHealthProbe(): void {
    if (this.healthProbeTimer) {
      clearInterval(this.healthProbeTimer);
      this.healthProbeTimer = null;
    }
  }

  private probeAddon(): Promise<boolean> {
    return new Promise((resolve) => {
      const sock = new net.Socket();
      let settled = false;
      const finish = (ok: boolean) => {
        if (settled) return;
        settled = true;
        try { sock.destroy(); } catch { /* ignore */ }
        resolve(ok);
      };
      sock.setTimeout(HEALTH_PROBE_TIMEOUT_MS);
      sock.once('connect', () => finish(true));
      sock.once('error', () => finish(false));
      sock.once('timeout', () => finish(false));
      try {
        sock.connect(BLENDER_ADDON_PORT, BLENDER_ADDON_HOST);
      } catch {
        finish(false);
      }
    });
  }

  getStatus(): EngineMCPStatus { return this.status; }
  onStatusChange(cb: (status: EngineMCPStatus, error?: string) => void): void { this.statusCallbacks.push(cb); }

  getDiagnosticLogPath(): string {
    return path.join(app.getPath('userData'), 'blender-mcp.log');
  }
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
      execSync('uv --version', { stdio: 'ignore', timeout: 3000, env: this.getAugmentedEnv() });
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
        const env = this.getAugmentedEnv();
        if (platform === 'darwin' || platform === 'linux') {
          execSync('curl -LsSf https://astral.sh/uv/install.sh | sh', {
            stdio: 'pipe', timeout: 120000, shell: '/bin/bash', env,
          });
        } else if (platform === 'win32') {
          execSync('powershell -c "irm https://astral.sh/uv/install.ps1 | iex"', {
            stdio: 'pipe', timeout: 120000, env,
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
    // Don't double-start an in-flight connect.
    if (this.status === 'starting') return { success: true };
    // If we think we're connected, verify with a fast TCP probe — only short-circuit
    // if Blender's addon is genuinely reachable. Otherwise tear down and reconnect so
    // explicit Connect/Reconnect clicks always do real work.
    if (this.status === 'connected') {
      if (await this.probeAddon()) return { success: true };
      this.logDiagnostic('start: stale connected state, tearing down for fresh reconnect');
      await this.stop();
    }
    this.setStatus('starting');
    this.stderrBuf = '';

    try {
      if (!this.isUvInstalled()) {
        const errMsg = 'uv is not installed. Run setup first.';
        this.logDiagnostic(`start: uv pre-flight FAILED PATH=${this.getAugmentedEnv().PATH}`);
        this.setStatus('error', errMsg);
        return { success: false, error: errMsg };
      }

      // Pre-flight: probe the Blender addon socket directly. If it isn't bound,
      // fail fast — no point spawning blender-mcp just to have every call fail.
      // This also prevents the brief "MCP connected" flash users would otherwise see.
      if (!(await this.probeAddon())) {
        const errMsg = `Blender addon is not listening on ${BLENDER_ADDON_HOST}:${BLENDER_ADDON_PORT}. In Blender, open the N panel → BlenderMCP tab → Connect to MCP server.`;
        this.logDiagnostic(`start: addon pre-flight FAILED — ${BLENDER_ADDON_HOST}:${BLENDER_ADDON_PORT} unreachable`);
        this.setStatus('error', errMsg);
        return { success: false, error: errMsg };
      }

      const { Client } = _require('@modelcontextprotocol/sdk/client/index.js');
      const { StdioClientTransport } = _require('@modelcontextprotocol/sdk/client/stdio.js');

      // Resolve uv path — on macOS it installs to ~/.local/bin or ~/.cargo/bin
      const uvPath = this.resolveUvPath();
      const spawnEnv = this.getAugmentedEnv();
      this.logDiagnostic(`start: uvPath=${uvPath} PATH=${spawnEnv.PATH}`);

      const transport = new StdioClientTransport({
        command: uvPath,
        args: ['blender-mcp'],
        env: spawnEnv as Record<string, string>,
        stderr: 'pipe',
      });

      // Capture stderr from `uvx blender-mcp` — this is the only window into
      // packaged-build failures (missing python, blocked egress, stale uv cache).
      const stderrStream = transport.stderr;
      if (stderrStream) {
        stderrStream.on('data', (chunk: Buffer | string) => {
          const text = typeof chunk === 'string' ? chunk : chunk.toString('utf8');
          this.appendStderr(text);
          this.logDiagnostic(`stderr: ${text.trimEnd()}`);
        });
      }

      transport.onerror = (err: Error) => {
        const msg = err?.message ?? String(err);
        this.logDiagnostic(`transport.onerror: ${msg}`);
        if (this.status !== 'connected') {
          this.setStatus('error', this.composeErrorMessage(msg));
        }
      };

      this.mcpClient = new Client({ name: 'build-buddy', version: '1.0.0' });

      transport.onclose = () => {
        this.mcpClient = null;
        this.tools = [];
        // Only flip to disconnected if we weren't already in error — preserve the error message.
        if (this.status !== 'error') this.setStatus('disconnected');
      };

      await this.withTimeout(
        this.mcpClient.connect(transport),
        CONNECT_TIMEOUT_MS,
        'connect',
      );
      console.log('[BlenderMCP] Connected to blender-mcp server');

      const { tools: rawTools } = await this.withTimeout(
        this.mcpClient.listTools(),
        CONNECT_TIMEOUT_MS,
        'listTools',
      );
      console.log(`[BlenderMCP] Got ${rawTools.length} tools`);
      console.log('[BlenderMCP] Tools:', rawTools.map((t: any) => t.name).join(', '));
      this.tools = rawTools.map((t: any) => ({
        name: t.name,
        description: t.description ?? '',
        inputSchema: t.inputSchema ?? { type: 'object', properties: {} },
      }));

      // No post-handshake verify call — the pre-flight TCP probe already confirms
      // the addon is listening, and the MCP handshake (connect + listTools) confirms
      // blender-mcp is alive. Probing a specific tool here is fragile: upstream
      // blender-mcp changes tool schemas (e.g. get_scene_info now requires a
      // `user_prompt` arg), and a schema mismatch would falsely trip "unreachable".
      // The periodic health probe + per-call regex detection cover later failures.

      this.setStatus('connected');
      return { success: true };
    } catch (err) {
      this.mcpClient = null;
      const baseMsg = err instanceof Error ? err.message : String(err);
      const stack = err instanceof Error ? (err.stack ?? err.message) : String(err);
      this.logDiagnostic(`start: FAILED ${stack}`);
      const errMsg = this.composeErrorMessage(baseMsg);
      this.setStatus('error', errMsg);
      return { success: false, error: errMsg };
    }
  }

  // Append the last stderr line from `uvx blender-mcp` so users see WHY the
  // subprocess failed, not just the generic SDK error.
  private composeErrorMessage(base: string): string {
    const tail = this.lastStderrLine();
    if (!tail) return base;
    if (base.includes(tail)) return base;
    return `${base} — blender-mcp said: ${tail}`;
  }

  private withTimeout<T>(p: Promise<T>, ms: number, label: string): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      const t = setTimeout(() => {
        const tail = this.lastStderrLine();
        const suffix = tail ? ` Last output from blender-mcp: ${tail}` : '';
        reject(new Error(`${label} timed out after ${Math.round(ms / 1000)}s.${suffix}`));
      }, ms);
      p.then(
        (v) => { clearTimeout(t); resolve(v); },
        (e) => { clearTimeout(t); reject(e); },
      );
    });
  }

  private resolveUvPath(): string {
    const home = os.homedir();
    const isWin = process.platform === 'win32';
    const bin = isWin ? 'uvx.exe' : 'uvx';
    const localAppData = process.env.LOCALAPPDATA;
    const candidates = (isWin
      ? [
          path.join(home, '.local', 'bin', bin),
          path.join(home, '.cargo', 'bin', bin),
          localAppData ? path.join(localAppData, 'Microsoft', 'WinGet', 'Links', bin) : null,
          path.join(home, 'scoop', 'shims', bin),
          `C:\\ProgramData\\chocolatey\\bin\\${bin}`,
          'uvx', // PATH fallback
        ]
      : [
          '/opt/homebrew/bin/uvx',
          '/usr/local/bin/uvx',
          path.join(home, '.local', 'bin', 'uvx'),
          path.join(home, '.cargo', 'bin', 'uvx'),
          'uvx',
        ]).filter((p): p is string => !!p);
    const env = this.getAugmentedEnv();
    for (const p of candidates) {
      try {
        execSync(`"${p}" --version`, { stdio: 'ignore', timeout: 3000, env });
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
    const startedAt = Date.now();
    try {
      const result = await this.mcpClient.callTool({ name, arguments: args });
      const text = result.content
        ?.filter((c: any) => c.type === 'text')
        .map((c: any) => c.text)
        .join('\n') ?? '';

      // Only treat the connection as unreachable when the addon-down pattern appears.
      // `result.isError` alone can mean a schema validation error, a tool-internal
      // failure, etc. — none of which should tear down the MCP connection.
      if (BLENDER_UNREACHABLE_RE.test(text)) {
        this.logDiagnostic(`callTool unreachable: ${name} (${Date.now() - startedAt}ms) ${text.slice(0, 200)}`);
        this.setStatus('error', BLENDER_UNREACHABLE_MSG);
        return { success: false, error: BLENDER_UNREACHABLE_MSG };
      }
      if (result.isError) {
        this.logDiagnostic(`callTool tool-error: ${name} (${Date.now() - startedAt}ms) ${text.slice(0, 200)}`);
        return { success: false, error: text || `Tool ${name} returned an error` };
      }

      this.logDiagnostic(`callTool ok: ${name} (${Date.now() - startedAt}ms)`);
      return { success: true, data: text };
    } catch (err) {
      const reason = err instanceof Error ? (err.stack ?? err.message) : String(err);
      this.logDiagnostic(`callTool FAILED: ${name} (${Date.now() - startedAt}ms) ${reason}`);
      const tail = this.lastStderrLine();
      const baseMsg = err instanceof Error ? err.message : String(err);
      const msg = tail && !baseMsg.includes(tail) ? `${baseMsg} — blender-mcp said: ${tail}` : baseMsg;
      return { success: false, error: msg };
    }
  }

  async getEditorSnapshot(): Promise<string> {
    if (this.status !== 'connected' || !this.mcpClient) return '';
    try {
      const result = await this.mcpClient.callTool({ name: 'get_scene_info', arguments: {} });
      const text = result.content
        ?.filter((c: any) => c.type === 'text')
        .map((c: any) => c.text)
        .join('\n') ?? '';
      // Only flip to error on the addon-down pattern — a tool error here just
      // means we couldn't get a snapshot, not that the connection is dead.
      if (BLENDER_UNREACHABLE_RE.test(text)) {
        this.setStatus('error', BLENDER_UNREACHABLE_MSG);
        return '';
      }
      return result.isError ? '' : text;
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
