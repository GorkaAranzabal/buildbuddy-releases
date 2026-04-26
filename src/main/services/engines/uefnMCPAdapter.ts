import { existsSync, mkdirSync, writeFileSync } from 'fs';
import path from 'path';
import { UnrealMCPService } from '../unrealMCPService';
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

const UEFN_SETUP_STEPS: EngineSetupStep[] = [
  {
    n: 1,
    title: 'Enable Python Plugin',
    desc: 'In UEFN: Edit → Project Settings → Plugins → Python → enable "Python Editor Script Plugin".',
    isAutomatic: false,
  },
  {
    n: 2,
    title: 'Enable Remote Execution',
    desc: 'In the same Python settings, check "Enable Remote Execution" and set Multicast Bind Address to 0.0.0.0',
    isAutomatic: false,
  },
  {
    n: 3,
    title: 'Set UEFN Paths',
    desc: 'In Build Buddy settings, set the path to your UEFN installation and your UEFN project folder.',
    isAutomatic: false,
  },
];

// Curated UE5 tools that work in UEFN + UEFN-specific tools
const UEFN_TOOL_DEFINITIONS: MCPToolDefinition[] = [
  // ----- UE5 base tools that work in UEFN -----
  {
    name: 'editor_run_python',
    description:
      'Execute any Python within UEFN. All Python must have `import unreal` at the top. NEVER ADD COMMENTS.',
    inputSchema: {
      type: 'object',
      properties: { code: { type: 'string', description: 'Python code to execute' } },
      required: ['code'],
    },
  },
  {
    name: 'editor_project_info',
    description: 'Get detailed information about the current UEFN project.',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'editor_get_map_info',
    description: 'Get detailed information about the current UEFN map/level.',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'editor_get_world_outliner',
    description: 'Get all actors in the current UEFN world with their properties.',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'editor_search_assets',
    description: 'Search for UEFN assets by name or path with optional class filter.',
    inputSchema: {
      type: 'object',
      properties: {
        search_term: { type: 'string' },
        asset_class: { type: 'string', description: 'Optional class filter' },
      },
      required: ['search_term'],
    },
  },
  {
    name: 'editor_list_assets',
    description: 'List all assets in the UEFN project.',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'editor_console_command',
    description: 'Run a console command in UEFN.',
    inputSchema: {
      type: 'object',
      properties: { command: { type: 'string' } },
      required: ['command'],
    },
  },
  {
    name: 'editor_take_screenshot',
    description: 'Take a screenshot of the UEFN viewport.',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'editor_create_object',
    description: 'Spawn an actor in the UEFN level.',
    inputSchema: {
      type: 'object',
      properties: {
        actor_class: { type: 'string' },
        location: {
          type: 'object',
          properties: { x: { type: 'number' }, y: { type: 'number' }, z: { type: 'number' } },
        },
        name: { type: 'string' },
      },
      required: ['actor_class'],
    },
  },
  {
    name: 'editor_update_object',
    description: 'Modify actor position, rotation, scale, or properties in the UEFN level.',
    inputSchema: {
      type: 'object',
      properties: {
        name: { type: 'string' },
        location: { type: 'object' },
        rotation: { type: 'object' },
        scale: { type: 'object' },
        properties: { type: 'object' },
      },
      required: ['name'],
    },
  },
  {
    name: 'editor_delete_object',
    description: 'Delete one or more actors from the UEFN level.',
    inputSchema: {
      type: 'object',
      properties: { names: { type: 'array', items: { type: 'string' } } },
      required: ['names'],
    },
  },
  {
    name: 'editor_save_all',
    description: 'Save all unsaved assets in the UEFN project.',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'explore_assets',
    description: 'Explore UEFN assets by class, name, path, or component type.',
    inputSchema: {
      type: 'object',
      properties: {
        class_name: { type: 'string' },
        parent_class: { type: 'string' },
        name_filter: { type: 'string' },
        path_filter: { type: 'string' },
      },
    },
  },

  // ----- UEFN-specific tools -----
  {
    name: 'get_island_info',
    description: 'Get metadata about the current UEFN island (world name, map path, game settings).',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'list_devices',
    description: 'List all Creative devices currently placed in the UEFN level.',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'place_device',
    description: 'Spawn a UEFN Creative device actor by class name at a given location.',
    inputSchema: {
      type: 'object',
      properties: {
        class_name: { type: 'string', description: 'Device class (e.g. "B_EliminationDevice_C")' },
        location: {
          type: 'object',
          properties: { x: { type: 'number' }, y: { type: 'number' }, z: { type: 'number' } },
          description: 'World-space location to spawn the device',
        },
        label: { type: 'string', description: 'Optional actor label' },
      },
      required: ['class_name'],
    },
  },
  {
    name: 'compile_verse',
    description: 'Trigger Verse recompilation for the UEFN project.',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'write_verse_script',
    description:
      'Create or overwrite a Verse script file in the UEFN project Content folder. After writing, Verse recompilation is triggered automatically. Always use the .verse extension.',
    inputSchema: {
      type: 'object',
      properties: {
        file_name: {
          type: 'string',
          description: 'Filename with .verse extension (e.g. "MyDevice.verse")',
        },
        code: { type: 'string', description: 'Full Verse source code' },
        subfolder: {
          type: 'string',
          description: 'Subfolder within Content (e.g. "Verse"). Defaults to Content root.',
        },
      },
      required: ['file_name', 'code'],
    },
  },
];

// Python scripts for UEFN-specific tools
const GET_ISLAND_INFO_PY = `
import unreal, json
try:
    gs = unreal.get_editor_subsystem(unreal.UnrealEditorSubsystem)
    world = gs.get_editor_world()
    print(json.dumps({"world_name": world.get_name(), "map_path": world.get_path_name()}))
except Exception as e:
    print(json.dumps({"error": str(e)}))
`.trim();

const LIST_DEVICES_PY = `
import unreal, json
try:
    actor_sub = unreal.get_editor_subsystem(unreal.EditorActorSubsystem)
    actors = actor_sub.get_all_level_actors()
    devices = []
    for a in actors:
        cls = type(a).__name__
        label = a.get_actor_label()
        loc = a.get_actor_location()
        if 'Device' in cls or 'Creative' in cls or 'B_' in label:
            devices.append({"name": label, "class": cls, "location": {"x": loc.x, "y": loc.y, "z": loc.z}})
    print(json.dumps({"devices": devices}))
except Exception as e:
    print(json.dumps({"error": str(e)}))
`.trim();

const COMPILE_VERSE_PY = `
import unreal, json
try:
    unreal.SystemLibrary.execute_console_command(None, "verse.recompile")
    print(json.dumps({"success": True, "message": "Verse recompilation triggered"}))
except Exception as e:
    print(json.dumps({"error": str(e)}))
`.trim();

function buildPlaceDevicePy(args: Record<string, unknown>): string {
  const className = args.class_name as string;
  const loc = (args.location as { x?: number; y?: number; z?: number }) ?? {};
  const x = loc.x ?? 0;
  const y = loc.y ?? 0;
  const z = loc.z ?? 0;
  const label = args.label ? `a.set_actor_label("${args.label}")` : '';
  return `
import unreal, json
try:
    loc = unreal.Vector(${x}, ${y}, ${z})
    rot = unreal.Rotator(0, 0, 0)
    a = unreal.EditorLevelLibrary.spawn_actor_from_class(unreal.load_class(None, "/Game/${className}.${className}_C"), loc, rot)
    ${label}
    print(json.dumps({"success": True, "name": a.get_actor_label(), "class": "${className}"}))
except Exception as e:
    print(json.dumps({"error": str(e)}))
`.trim();
}

export class UEFNMCPAdapter implements IEngineMCPService {
  private service: UnrealMCPService;
  private uefnProjectPath: string = '';

  constructor() {
    this.service = new UnrealMCPService();
  }

  getStatus(): EngineMCPStatus {
    return this.service.getStatus() as EngineMCPStatus;
  }

  start(settings: UserSettings): Promise<{ success: boolean; error?: string }> {
    this.uefnProjectPath = settings.uefnProjectPath ?? '';
    return this.service.start(settings.uefnEnginePath ?? '', settings.uefnProjectPath ?? '');
  }

  stop(): Promise<void> {
    return this.service.stop();
  }

  getTools(): MCPToolDefinition[] {
    return UEFN_TOOL_DEFINITIONS;
  }

  async callTool(name: string, args: Record<string, unknown>): Promise<MCPToolResult> {
    switch (name) {
      case 'write_verse_script':
        return this.handleWriteVerseScript(args);
      case 'get_island_info':
        return this.service.callTool('editor_run_python', { code: GET_ISLAND_INFO_PY });
      case 'list_devices':
        return this.service.callTool('editor_run_python', { code: LIST_DEVICES_PY });
      case 'place_device':
        return this.service.callTool('editor_run_python', { code: buildPlaceDevicePy(args) });
      case 'compile_verse':
        return this.service.callTool('editor_run_python', { code: COMPILE_VERSE_PY });
      default:
        return this.service.callTool(name, args);
    }
  }

  private async handleWriteVerseScript(args: Record<string, unknown>): Promise<MCPToolResult> {
    const fileName = args.file_name as string;
    const code = args.code as string;
    const subfolder = (args.subfolder as string | undefined) ?? '';

    if (!this.uefnProjectPath) {
      return { success: false, error: 'UEFN project path not configured. Set uefnProjectPath in settings.' };
    }
    if (!fileName) {
      return { success: false, error: 'file_name is required' };
    }

    const contentDir = subfolder
      ? path.join(this.uefnProjectPath, 'Content', subfolder)
      : path.join(this.uefnProjectPath, 'Content');

    if (!existsSync(contentDir)) {
      mkdirSync(contentDir, { recursive: true });
    }

    const filePath = path.join(contentDir, fileName);
    writeFileSync(filePath, code, 'utf8');

    // Trigger Verse recompilation
    await this.service.callTool('editor_run_python', { code: COMPILE_VERSE_PY });

    return { success: true, data: { filePath, message: `Wrote ${fileName} and triggered Verse recompilation` } };
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
    return UEFN_SETUP_STEPS;
  }

  async checkSetup(): Promise<EngineSetupStatus> {
    return { engine: 'uefn', stepsComplete: false, pendingSteps: UEFN_SETUP_STEPS };
  }

  async installDeps(): Promise<{ success: boolean; error?: string }> {
    return { success: true };
  }
}
