import { RemoteExecution, RemoteExecutionConfig } from 'unreal-remote-execution';
import type { UnrealMCPStatus, MCPProjectInfo, MCPToolResult } from '../../shared/types';

type StatusCallback = (status: UnrealMCPStatus) => void;

// Inline Python script for quick project info (avoids loading external scripts)
const PROJECT_INFO_PY = `
import unreal, json
try:
    name = unreal.Paths.get_project_file_path().split("/")[-1].replace(".uproject","") if unreal.Paths.get_project_file_path() else "Unknown"
    version = unreal.SystemLibrary.get_engine_version()
    path = unreal.Paths.project_dir()
    print(json.dumps({"project_name": name, "engine_version": version, "project_path": path}))
except Exception as e:
    print(json.dumps({"error": str(e)}))
`.trim();

export class UnrealMCPService {
  private re: RemoteExecution | null = null;
  private status: UnrealMCPStatus = 'disconnected';
  private statusCallbacks: StatusCallback[] = [];

  onStatusChange(cb: StatusCallback): void {
    this.statusCallbacks.push(cb);
  }

  getStatus(): UnrealMCPStatus {
    return this.status;
  }

  private setStatus(s: UnrealMCPStatus): void {
    this.status = s;
    this.statusCallbacks.forEach(cb => cb(s));
  }

  private async cleanupInstance(): Promise<void> {
    if (this.re) {
      try { this.re.stop(); } catch { /* ignore */ }
      this.re = null;
      // Give the OS time to fully release UDP/TCP sockets before rebinding
      await new Promise(r => setTimeout(r, 600));
    }
  }

  async start(_enginePath: string, _projectPath: string): Promise<{ success: boolean; error?: string }> {
    if (this.status === 'connected' || this.status === 'starting') {
      return { success: true };
    }

    await this.cleanupInstance();
    this.setStatus('starting');
    console.log('[UnrealMCP] Starting — connecting directly to Unreal Editor via Remote Execution...');

    const MAX_ATTEMPTS = 3;
    let lastError = '';

    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
      console.log(`[UnrealMCP] Attempt ${attempt}/${MAX_ATTEMPTS}...`);
      try {
        const config = new RemoteExecutionConfig(
          1,                        // multicastTTL
          ['239.0.0.1', 6766],      // multicastGroupEndpoint
          '0.0.0.0',                // multicastBindAddress — must be 0.0.0.0 to receive multicast
        );

        this.re = new RemoteExecution(config);
        await this.re.start();

        console.log('[UnrealMCP] Searching for Unreal Editor node (8s timeout)...');
        const node = await this.re.getFirstRemoteNode(400, 8000);
        console.log('[UnrealMCP] Found node:', node.data?.project_name);

        await this.re.openCommandConnection(node);
        console.log('[UnrealMCP] Command connection open');

        this.re.events.addEventListener('commandConnectionClosed', () => {
          console.log('[UnrealMCP] Command connection closed');
          this.setStatus('disconnected');
        });

        // Quick smoke-test
        const test = await this.re.runCommand('print("buildbuddy:ok")', true);
        if (!test.success) {
          throw new Error(`Smoke test failed: ${JSON.stringify(test.result)}`);
        }

        this.setStatus('connected');
        console.log('[UnrealMCP] Connected successfully');
        return { success: true };
      } catch (err) {
        console.error(`[UnrealMCP] Attempt ${attempt} failed:`, err);
        lastError = err instanceof Error ? err.message : String(err);
        await this.cleanupInstance();

        if (attempt < MAX_ATTEMPTS) {
          console.log('[UnrealMCP] Retrying in 1.5s...');
          await new Promise(r => setTimeout(r, 1500));
        }
      }
    }

    this.setStatus('error');
    const isTimeout = lastError.toLowerCase().includes('timeout') || lastError.toLowerCase().includes('timed out');
    const error = isTimeout
      ? 'Could not find Unreal Editor after 3 attempts. Make sure:\n1. Unreal Editor is open with your project loaded\n2. Python Editor Script Plugin is enabled\n3. Remote Execution is enabled in Project Settings → Plugins → Python\n4. Multicast Bind Address is 0.0.0.0 (NOT 127.0.0.1)\n5. macOS: System Settings → Privacy & Security → Local Network → allow BuildBuddy\n6. Restart Unreal Editor after changing any settings'
      : lastError;
    return { success: false, error };
  }

  async stop(): Promise<void> {
    if (this.status === 'disconnected') return;
    console.log('[UnrealMCP] Stopping...');
    await this.cleanupInstance();
    this.setStatus('disconnected');
  }

  async callTool(name: string, args: Record<string, unknown> = {}): Promise<MCPToolResult> {
    if (!this.re || this.status !== 'connected') {
      return { success: false, error: 'Not connected to Unreal Editor' };
    }

    try {
      const python = this.buildPythonCommand(name, args);
      const result = await this.re.runCommand(python, true);
      const text = result.output.map(l => l.output).join('\n');
      return {
        success: result.success,
        data: { content: [{ type: 'text', text: text || result.result }] },
        error: result.success ? undefined : result.result,
      };
    } catch (err) {
      // If the connection dropped, update status
      if (err instanceof Error && (err.message.includes('closed') || err.message.includes('ECONNRESET'))) {
        this.setStatus('disconnected');
      }
      return { success: false, error: err instanceof Error ? err.message : String(err) };
    }
  }

  async testConnection(): Promise<MCPProjectInfo | null> {
    if (!this.re || this.status !== 'connected') return null;
    try {
      const result = await this.re.runCommand(PROJECT_INFO_PY, true);
      const text = result.output.map(l => l.output).join('').trim();
      const p = JSON.parse(text);
      if (p.error) return null;
      return {
        projectName: p.project_name ?? 'Unknown',
        engineVersion: p.engine_version ?? 'Unknown',
        projectPath: p.project_path ?? '',
      };
    } catch (err) {
      console.warn('[UnrealMCP] testConnection failed:', err);
      return null;
    }
  }

  // ===== Viewport camera info =====

  async getViewportCameraInfo(): Promise<{ x: number; y: number; z: number; pitch: number; yaw: number; roll: number } | null> {
    if (!this.re || this.status !== 'connected') return null;
    try {
      const py = `import unreal, json
try:
    sub = unreal.get_editor_subsystem(unreal.UnrealEditorSubsystem)
    loc, rot = sub.get_level_viewport_camera_info()
    print(json.dumps({"x": loc.x, "y": loc.y, "z": loc.z, "pitch": rot.pitch, "yaw": rot.yaw, "roll": rot.roll}))
except Exception as e:
    print(json.dumps({"error": str(e)}))`;
      const result = await this.re.runCommand(py, true);
      const text = result.output.map((l: { output: string }) => l.output).join('').trim();
      const parsed = JSON.parse(text);
      if (parsed.error) {
        console.warn('[UnrealMCP] getViewportCameraInfo error:', parsed.error);
        return null;
      }
      return parsed;
    } catch (err) {
      console.warn('[UnrealMCP] getViewportCameraInfo failed:', err);
      return null;
    }
  }

  // ===== Typed tool wrappers =====

  async editorRunPython(script: string): Promise<MCPToolResult> {
    return this.callTool('editor_run_python', { code: script });
  }

  async editorConsoleCommand(command: string): Promise<MCPToolResult> {
    return this.callTool('editor_console_command', { command });
  }

  async editorTakeScreenshot(): Promise<MCPToolResult> {
    return this.callTool('editor_take_screenshot', {});
  }

  async editorListAssets(assetPath = '/Game'): Promise<MCPToolResult> {
    return this.callTool('editor_list_assets', { path: assetPath });
  }

  async editorSearchAssets(query: string): Promise<MCPToolResult> {
    return this.callTool('editor_search_assets', { search_term: query });
  }

  // ===== Python command builder =====

  private buildPythonCommand(toolName: string, args: Record<string, unknown>): string {
    switch (toolName) {
      case 'editor_run_python': {
        // Support both 'code' (original tool spec) and 'script' (our wrapper)
        const code = (args.code ?? args.script ?? '') as string;
        return code;
      }

      case 'editor_console_command': {
        const cmd = (args.command ?? '') as string;
        // Escape single quotes
        const escaped = cmd.replace(/'/g, "\\'");
        return `import unreal\nunreal.SystemLibrary.execute_console_command(None, '${escaped}')`;
      }

      case 'editor_project_info':
        return PROJECT_INFO_PY;

      case 'editor_list_assets': {
        const path = (args.path ?? '/Game') as string;
        return `
import unreal, json
ar = unreal.AssetRegistryHelpers.get_asset_registry()
assets = ar.get_assets_by_path('${path}', recursive=True)
print(json.dumps([str(a.package_name) for a in assets[:200]]))
`.trim();
      }

      case 'editor_search_assets': {
        const term = ((args.search_term ?? '') as string).replace(/'/g, "\\'");
        const cls = ((args.asset_class ?? '') as string).replace(/'/g, "\\'");
        return `
import unreal, json
ar = unreal.AssetRegistryHelpers.get_asset_registry()
all_assets = ar.get_all_assets()
term = '${term}'.lower()
results = []
for a in all_assets:
    name = str(a.asset_name).lower()
    if term in name${cls ? ` and '${cls}'.lower() in str(a.asset_class).lower()` : ''}:
        results.append({'name': str(a.asset_name), 'path': str(a.package_path), 'class': str(a.asset_class)})
    if len(results) >= 50:
        break
print(json.dumps(results))
`.trim();
      }

      case 'editor_take_screenshot': {
        return `
import unreal, os, tempfile
path = os.path.join(tempfile.gettempdir(), 'ue_screenshot.png')
unreal.AutomationLibrary.take_high_res_screenshot(1920, 1080, path)
print(path)
`.trim();
      }

      default:
        throw new Error(`Unknown tool: ${toolName}`);
    }
  }
}
