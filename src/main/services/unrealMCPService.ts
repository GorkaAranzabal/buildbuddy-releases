import { RemoteExecution, RemoteExecutionConfig } from 'unreal-remote-execution';
import { createRequire } from 'module';
import path from 'path';
import fs from 'fs';
import dgram from 'dgram';
import dns from 'dns';
import type { UnrealMCPStatus, MCPProjectInfo, MCPToolResult, MCPToolDefinition } from '../../shared/types';

const _require = createRequire(import.meta.url);

type StatusCallback = (status: UnrealMCPStatus) => void;

function templateScript(tmpl: string, vars: Record<string, string>): string {
  let result = tmpl;
  for (const [key, value] of Object.entries(vars)) {
    result = result.replaceAll(`\${${key}}`, value);
  }
  return result;
}

function resolveScriptsDir(): string {
  try {
    const pkgEntry = _require.resolve('@runreal/unreal-mcp/dist/editor/tools.js');
    return path.join(path.dirname(pkgEntry), 'scripts');
  } catch {
    return '';
  }
}

function readScript(scriptsDir: string, filename: string): string {
  return fs.readFileSync(path.join(scriptsDir, filename), 'utf8');
}

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

// Helper: find a Blueprint by name, ensure SCS exists (critical fix from AgentIntegrationKit)
const FIND_BP_PY = `
def _find_bp(name):
    bp = None
    if '/' in name:
        bp = unreal.EditorAssetLibrary.load_asset(name)
        if bp and not isinstance(bp, unreal.Blueprint):
            bp = None
    if not bp:
        for prefix in ['/Game/Blueprints/', '/Game/', '/Game/UI/']:
            try:
                obj = unreal.EditorAssetLibrary.load_asset(prefix + name)
                if obj and isinstance(obj, unreal.Blueprint):
                    bp = obj
                    break
            except:
                pass
    if not bp:
        ar = unreal.AssetRegistryHelpers.get_asset_registry()
        for a in ar.get_assets_by_path('/Game', recursive=True):
            if str(a.asset_name) == name:
                obj = unreal.EditorAssetLibrary.load_asset(str(a.package_name))
                if obj and isinstance(obj, unreal.Blueprint):
                    bp = obj
                    break
    if bp:
        if bp.simple_construction_script is None:
            try:
                scs = unreal.SimpleConstructionScript(outer=bp)
                bp.set_editor_property('SimpleConstructionScript', scs)
            except:
                pass
    return bp
`;

// Helper: find an SCS component node inside a Blueprint by component name
const FIND_SCS_NODE_PY = `
def _find_scs_node(bp, comp_name):
    scs = bp.simple_construction_script
    if not scs:
        return None
    for node in scs.get_all_nodes():
        vn = str(node.get_variable_name()) if hasattr(node, 'get_variable_name') else ''
        tn = str(node.component_template.get_name()) if node.component_template else ''
        if comp_name in (vn, tn) or comp_name.lower() in (vn.lower(), tn.lower()):
            return node
    return None
`;

// Helper: find an actor in the level by name or label
const FIND_ACTOR_PY = `
def _find_actor(name):
    all_actors = unreal.get_editor_subsystem(unreal.EditorActorSubsystem).get_all_level_actors()
    for a in all_actors:
        if a.get_name() == name or a.get_actor_label() == name:
            return a
    name_lower = name.lower()
    for a in all_actors:
        if a.get_name().lower() == name_lower or a.get_actor_label().lower() == name_lower:
            return a
    return None
`;

// Helper: load any asset by name or path (searches /Game recursively)
const FIND_ASSET_PY = `
def _find_asset(name):
    if '/' in name:
        obj = unreal.EditorAssetLibrary.load_asset(name)
        if obj:
            return obj
    for prefix in ['/Game/', '/Game/Blueprints/', '/Game/Materials/', '/Game/UI/', '/Engine/']:
        try:
            obj = unreal.EditorAssetLibrary.load_asset(prefix + name)
            if obj:
                return obj
        except:
            pass
    ar = unreal.AssetRegistryHelpers.get_asset_registry()
    for a in ar.get_assets_by_path('/Game', recursive=True):
        if str(a.asset_name) == name:
            return unreal.EditorAssetLibrary.load_asset(str(a.package_name))
    return None
`;

// ===== Tool definitions — all via Remote Execution (Python) =====

const TOOL_DEFINITIONS: MCPToolDefinition[] = [
  // ----- Editor tools (original) -----
  {
    name: 'editor_run_python',
    description: 'Execute any python within the Unreal Editor. All python must have `import unreal` at the top. NEVER EVER ADD COMMENTS',
    inputSchema: {
      type: 'object',
      properties: { code: { type: 'string', description: 'Python code to execute' } },
      required: ['code'],
    },
  },
  {
    name: 'editor_list_assets',
    description: "List all Unreal assets. Returns a Python list of asset paths.",
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'editor_export_asset',
    description: 'Export an Unreal asset to text.',
    inputSchema: {
      type: 'object',
      properties: { asset_path: { type: 'string' } },
      required: ['asset_path'],
    },
  },
  {
    name: 'editor_get_asset_info',
    description: 'Get information about an asset, including LOD levels for mesh assets.',
    inputSchema: {
      type: 'object',
      properties: { asset_path: { type: 'string' } },
      required: ['asset_path'],
    },
  },
  {
    name: 'editor_get_asset_references',
    description: 'Get references for an asset.',
    inputSchema: {
      type: 'object',
      properties: { asset_path: { type: 'string' } },
      required: ['asset_path'],
    },
  },
  {
    name: 'editor_console_command',
    description: 'Run a console command in Unreal.',
    inputSchema: {
      type: 'object',
      properties: { command: { type: 'string' } },
      required: ['command'],
    },
  },
  {
    name: 'editor_project_info',
    description: 'Get detailed information about the current project.',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'editor_get_map_info',
    description: 'Get detailed information about the current map/level.',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'editor_search_assets',
    description: 'Search for assets by name or path with optional class filter.',
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
    name: 'editor_get_world_outliner',
    description: 'Get all actors in the current world with their properties.',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'editor_validate_assets',
    description: 'Validate assets in the project to check for errors.',
    inputSchema: {
      type: 'object',
      properties: { asset_paths: { type: 'string', description: 'Optional comma-separated asset paths' } },
    },
  },
  {
    name: 'editor_create_object',
    description: "Create a new object/actor in the world.",
    inputSchema: {
      type: 'object',
      properties: {
        object_class: { type: 'string', description: "Unreal class name (e.g., 'StaticMeshActor', 'DirectionalLight')" },
        object_name: { type: 'string', description: 'Name/label for the created object' },
        location: {
          type: 'object',
          properties: { x: { type: 'number' }, y: { type: 'number' }, z: { type: 'number' } },
          description: 'World position coordinates',
        },
        rotation: {
          type: 'object',
          properties: { pitch: { type: 'number' }, yaw: { type: 'number' }, roll: { type: 'number' } },
          description: 'Rotation in degrees',
        },
        scale: {
          type: 'object',
          properties: { x: { type: 'number' }, y: { type: 'number' }, z: { type: 'number' } },
          description: 'Scale multipliers',
        },
        properties: {
          type: 'object',
          description: 'Additional actor properties. For StaticMeshActor: use "StaticMesh" for mesh path, "Material" for single material path, or "Materials" for array of material paths.',
        },
      },
      required: ['object_class', 'object_name'],
    },
  },
  {
    name: 'editor_update_object',
    description: "Update an existing object/actor in the world.",
    inputSchema: {
      type: 'object',
      properties: {
        actor_name: { type: 'string', description: 'Name or label of the actor to update' },
        location: {
          type: 'object',
          properties: { x: { type: 'number' }, y: { type: 'number' }, z: { type: 'number' } },
          description: 'New world position coordinates',
        },
        rotation: {
          type: 'object',
          properties: { pitch: { type: 'number' }, yaw: { type: 'number' }, roll: { type: 'number' } },
          description: 'New rotation in degrees',
        },
        scale: {
          type: 'object',
          properties: { x: { type: 'number' }, y: { type: 'number' }, z: { type: 'number' } },
          description: 'New scale multipliers',
        },
        properties: { type: 'object', description: 'Additional actor properties to update.' },
        new_name: { type: 'string', description: 'New name/label for the actor' },
      },
      required: ['actor_name'],
    },
  },
  {
    name: 'editor_delete_object',
    description: 'Delete an object/actor from the world.',
    inputSchema: {
      type: 'object',
      properties: { actor_names: { type: 'string', description: 'Actor name(s) to delete' } },
      required: ['actor_names'],
    },
  },
  {
    name: 'editor_take_screenshot',
    description: 'Take a screenshot of the Unreal Editor viewport.',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'editor_move_camera',
    description: 'Move the viewport camera to a specific location and rotation.',
    inputSchema: {
      type: 'object',
      properties: {
        location: {
          type: 'object',
          properties: { x: { type: 'number' }, y: { type: 'number' }, z: { type: 'number' } },
          description: 'Camera world position coordinates',
        },
        rotation: {
          type: 'object',
          properties: { pitch: { type: 'number' }, yaw: { type: 'number' }, roll: { type: 'number' } },
          description: 'Camera rotation in degrees',
        },
      },
      required: ['location', 'rotation'],
    },
  },

  // ----- Blueprint tools (Python-based, no plugin required) -----
  {
    name: 'create_blueprint',
    description: 'Create a new Blueprint class. parent_class can be: Actor, Pawn, Character, PlayerController, GameModeBase, etc.',
    inputSchema: {
      type: 'object',
      properties: {
        name: { type: 'string', description: 'Blueprint name' },
        parent_class: { type: 'string', description: 'Parent class (Actor, Pawn, Character, etc.)' },
      },
      required: ['name', 'parent_class'],
    },
  },
  {
    name: 'add_component_to_blueprint',
    description: 'Add a component to a Blueprint (e.g. StaticMeshComponent, CameraComponent, SpringArmComponent, SceneComponent).',
    inputSchema: {
      type: 'object',
      properties: {
        blueprint_name: { type: 'string' },
        component_type: { type: 'string', description: 'Component class name (e.g. StaticMeshComponent)' },
        component_name: { type: 'string' },
      },
      required: ['blueprint_name', 'component_type', 'component_name'],
    },
  },
  {
    name: 'set_static_mesh_properties',
    description: 'Set the static mesh asset on a StaticMeshComponent in a Blueprint.',
    inputSchema: {
      type: 'object',
      properties: {
        blueprint_name: { type: 'string' },
        component_name: { type: 'string' },
        static_mesh: { type: 'string', description: 'Mesh asset path (e.g. /Engine/BasicShapes/Cube.Cube)' },
      },
      required: ['blueprint_name', 'component_name'],
    },
  },
  {
    name: 'set_component_property',
    description: 'Set a property on a component within a Blueprint.',
    inputSchema: {
      type: 'object',
      properties: {
        blueprint_name: { type: 'string' },
        component_name: { type: 'string' },
        property_name: { type: 'string' },
        property_value: { description: 'Value to set' },
      },
      required: ['blueprint_name', 'component_name', 'property_name', 'property_value'],
    },
  },
  {
    name: 'set_physics_properties',
    description: 'Configure physics on a component in a Blueprint (simulate physics, gravity, mass, damping).',
    inputSchema: {
      type: 'object',
      properties: {
        blueprint_name: { type: 'string' },
        component_name: { type: 'string' },
        simulate_physics: { type: 'boolean' },
        gravity_enabled: { type: 'boolean' },
        mass: { type: 'number' },
        linear_damping: { type: 'number' },
        angular_damping: { type: 'number' },
      },
      required: ['blueprint_name', 'component_name'],
    },
  },
  {
    name: 'compile_blueprint',
    description: 'Compile a Blueprint so changes take effect.',
    inputSchema: {
      type: 'object',
      properties: { blueprint_name: { type: 'string' } },
      required: ['blueprint_name'],
    },
  },
  {
    name: 'set_blueprint_property',
    description: 'Set a property on a Blueprint class default object.',
    inputSchema: {
      type: 'object',
      properties: {
        blueprint_name: { type: 'string' },
        property_name: { type: 'string' },
        property_value: { description: 'Value to set' },
      },
      required: ['blueprint_name', 'property_name', 'property_value'],
    },
  },
  {
    name: 'spawn_blueprint_actor',
    description: 'Spawn an instance of a Blueprint class into the current level.',
    inputSchema: {
      type: 'object',
      properties: {
        blueprint_name: { type: 'string', description: 'Name of the Blueprint asset' },
        actor_name: { type: 'string', description: 'Label for the spawned actor' },
        location: {
          type: 'object',
          properties: { x: { type: 'number' }, y: { type: 'number' }, z: { type: 'number' } },
        },
        rotation: {
          type: 'object',
          properties: { pitch: { type: 'number' }, yaw: { type: 'number' }, roll: { type: 'number' } },
        },
      },
      required: ['blueprint_name', 'actor_name'],
    },
  },
  {
    name: 'add_blueprint_variable',
    description: 'Add a variable to a Blueprint with full flag support (Boolean, Integer, Float, String, Vector, Rotator, Transform, Name, Text, Object).',
    inputSchema: {
      type: 'object',
      properties: {
        blueprint_name: { type: 'string' },
        variable_name: { type: 'string' },
        variable_type: { type: 'string', description: 'Type: bool, int, float, string, Vector, Rotator, Transform, Name, Text, Object' },
        instance_editable: { type: 'boolean', description: 'Make editable per instance (expose on spawn)' },
        blueprint_read_only: { type: 'boolean', description: 'Read only in Blueprint graphs' },
        expose_on_spawn: { type: 'boolean', description: 'Expose as pin when spawning' },
        replicated: { type: 'boolean', description: 'Replicate over network' },
        save_game: { type: 'boolean', description: 'Include in save game serialization' },
        is_private: { type: 'boolean', description: 'Mark as private' },
        category: { type: 'string', description: 'Variable category for organization' },
        default_value: { description: 'Default value for the variable' },
      },
      required: ['blueprint_name', 'variable_name', 'variable_type'],
    },
  },
  {
    name: 'create_input_mapping',
    description: 'Create an input action or axis mapping for the project.',
    inputSchema: {
      type: 'object',
      properties: {
        action_name: { type: 'string' },
        key: { type: 'string', description: 'Key name (SpaceBar, LeftMouseButton, W, A, S, D, etc.)' },
        input_type: { type: 'string', description: 'Action or Axis (default: Action)' },
      },
      required: ['action_name', 'key'],
    },
  },

  // ----- Material tools -----
  {
    name: 'set_actor_material',
    description: 'Set a material on an actor in the level. Works on StaticMeshActors and any actor with a mesh component.',
    inputSchema: {
      type: 'object',
      properties: {
        actor_name: { type: 'string', description: 'Name or label of the actor' },
        material_path: { type: 'string', description: 'Material asset path (e.g. /Game/Materials/M_MyMaterial or /Engine/BasicShapes/BasicShapeMaterial)' },
        slot_index: { type: 'number', description: 'Material slot index (default: 0)' },
      },
      required: ['actor_name', 'material_path'],
    },
  },
  {
    name: 'create_material_instance',
    description: 'Create a Material Instance Constant from a parent material, optionally setting scalar/vector/texture parameters.',
    inputSchema: {
      type: 'object',
      properties: {
        name: { type: 'string', description: 'Name for the new material instance' },
        parent_material: { type: 'string', description: 'Parent material path (e.g. /Engine/BasicShapes/BasicShapeMaterial)' },
        scalar_params: { type: 'object', description: 'Key-value pairs of scalar parameter names and float values' },
        vector_params: { type: 'object', description: 'Key-value pairs of vector parameter names and {r,g,b,a} values' },
        texture_params: { type: 'object', description: 'Key-value pairs of texture parameter names and texture asset paths' },
      },
      required: ['name', 'parent_material'],
    },
  },

  // ----- Actor utility tools -----
  {
    name: 'duplicate_actor',
    description: 'Duplicate an existing actor in the level with an optional offset.',
    inputSchema: {
      type: 'object',
      properties: {
        actor_name: { type: 'string', description: 'Name or label of actor to duplicate' },
        new_label: { type: 'string', description: 'Label for the duplicated actor' },
        offset: {
          type: 'object',
          properties: { x: { type: 'number' }, y: { type: 'number' }, z: { type: 'number' } },
          description: 'Position offset from original (default: 200 on X)',
        },
      },
      required: ['actor_name'],
    },
  },
  {
    name: 'set_actor_mobility',
    description: 'Set the mobility of an actor (Static, Movable, or Stationary).',
    inputSchema: {
      type: 'object',
      properties: {
        actor_name: { type: 'string' },
        mobility: { type: 'string', description: 'Static, Movable, or Stationary' },
      },
      required: ['actor_name', 'mobility'],
    },
  },
  {
    name: 'focus_viewport_on_actor',
    description: 'Move the viewport camera to focus on a specific actor.',
    inputSchema: {
      type: 'object',
      properties: {
        actor_name: { type: 'string', description: 'Name or label of the actor to focus on' },
        distance: { type: 'number', description: 'Distance from actor (default: 500)' },
      },
      required: ['actor_name'],
    },
  },
  {
    name: 'get_blueprint_components',
    description: 'List all components of a Blueprint, including their types and properties.',
    inputSchema: {
      type: 'object',
      properties: { blueprint_name: { type: 'string' } },
      required: ['blueprint_name'],
    },
  },
  {
    name: 'rename_actor',
    description: 'Rename an actor in the level (changes its label).',
    inputSchema: {
      type: 'object',
      properties: {
        actor_name: { type: 'string', description: 'Current name or label' },
        new_name: { type: 'string', description: 'New label' },
      },
      required: ['actor_name', 'new_name'],
    },
  },
  {
    name: 'set_actor_collision',
    description: 'Set collision properties on an actor (collision enabled, profile, object type).',
    inputSchema: {
      type: 'object',
      properties: {
        actor_name: { type: 'string' },
        collision_enabled: { type: 'string', description: 'NoCollision, QueryOnly, PhysicsOnly, QueryAndPhysics' },
        collision_profile: { type: 'string', description: 'Preset name: BlockAll, OverlapAll, BlockAllDynamic, NoCollision, Pawn, etc.' },
      },
      required: ['actor_name'],
    },
  },
  {
    name: 'import_asset',
    description: 'Import an external file (FBX, OBJ, PNG, WAV, etc.) into the project as an Unreal asset.',
    inputSchema: {
      type: 'object',
      properties: {
        source_path: { type: 'string', description: 'Full path to the file on disk' },
        destination_path: { type: 'string', description: 'Content Browser destination (default: /Game/Imported)' },
      },
      required: ['source_path'],
    },
  },

  // ----- Universal property configuration (inspired by AgentIntegrationKit ConfigureAssetTool) -----
  {
    name: 'configure_asset',
    description: 'Universal property getter/setter/lister for ANY Unreal asset. Can target the asset itself, its CDO, or a specific subobject (component/widget). Supports booleans, numbers, strings, enums, structs, and object references.',
    inputSchema: {
      type: 'object',
      properties: {
        asset_name: { type: 'string', description: 'Asset name or full path (e.g. "MyBlueprint" or "/Game/Blueprints/BP_Hero")' },
        subobject: { type: 'string', description: 'Optional subobject to target: component name, "CDO" for class defaults, or widget name' },
        changes: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              property: { type: 'string', description: 'Property name (e.g. "RelativeLocation", "bSimulatePhysics")' },
              value: { description: 'Value to set (type depends on property: bool, number, string, struct string, asset path)' },
            },
            required: ['property', 'value'],
          },
          description: 'Array of property changes to apply',
        },
        list_properties: { type: 'boolean', description: 'If true, lists all editable properties on the target' },
        get_properties: {
          type: 'array',
          items: { type: 'string' },
          description: 'Array of property names to read and return',
        },
      },
      required: ['asset_name'],
    },
  },

  // ----- Enhanced Input tools (UE5) -----
  {
    name: 'create_input_action',
    description: 'Create a UE5 Enhanced Input Action asset with a specified value type and optional triggers/modifiers.',
    inputSchema: {
      type: 'object',
      properties: {
        name: { type: 'string', description: 'Name for the InputAction asset' },
        value_type: { type: 'string', description: 'Boolean, Axis1D, Axis2D, or Axis3D (default: Boolean)' },
        triggers: {
          type: 'array',
          items: { type: 'string' },
          description: 'Trigger types: Down, Pressed, Released, Hold, HoldAndRelease, Tap, Pulse',
        },
        modifiers: {
          type: 'array',
          items: { type: 'string' },
          description: 'Modifier types: DeadZone, FOVScaling, Negate, Scalar, ScaleByDeltaTime, Swizzle, Smooth',
        },
        path: { type: 'string', description: 'Content Browser path (default: /Game/Input)' },
      },
      required: ['name'],
    },
  },
  {
    name: 'create_input_mapping_context',
    description: 'Create a UE5 Enhanced Input Mapping Context asset.',
    inputSchema: {
      type: 'object',
      properties: {
        name: { type: 'string', description: 'Name for the InputMappingContext asset' },
        path: { type: 'string', description: 'Content Browser path (default: /Game/Input)' },
      },
      required: ['name'],
    },
  },
  {
    name: 'add_input_mapping',
    description: 'Map a key to an InputAction within an InputMappingContext (UE5 Enhanced Input).',
    inputSchema: {
      type: 'object',
      properties: {
        context_name: { type: 'string', description: 'Name or path of the InputMappingContext asset' },
        action_name: { type: 'string', description: 'Name or path of the InputAction asset' },
        key: { type: 'string', description: 'Key name (SpaceBar, W, A, S, D, LeftMouseButton, Gamepad_LeftX, etc.)' },
        triggers: {
          type: 'array',
          items: { type: 'string' },
          description: 'Trigger overrides for this mapping',
        },
        modifiers: {
          type: 'array',
          items: { type: 'string' },
          description: 'Modifier overrides for this mapping',
        },
      },
      required: ['context_name', 'action_name', 'key'],
    },
  },

  // ----- Widget Blueprint tools -----
  {
    name: 'edit_widget_blueprint',
    description: 'Add, remove, or configure widgets inside a Widget Blueprint (UMG). Can create widgets, add them to panels, set properties, and remove them.',
    inputSchema: {
      type: 'object',
      properties: {
        blueprint_name: { type: 'string', description: 'Name or path of the Widget Blueprint' },
        action: { type: 'string', description: 'add_widget, remove_widget, set_widget_property, list_widgets' },
        widget_class: { type: 'string', description: 'For add_widget: class name (TextBlock, Button, Image, VerticalBox, HorizontalBox, CanvasPanel, etc.)' },
        widget_name: { type: 'string', description: 'Name for the widget (used in add/remove/set_property)' },
        parent_name: { type: 'string', description: 'For add_widget: name of parent panel widget (omit to add to root)' },
        property_name: { type: 'string', description: 'For set_widget_property: property to set' },
        property_value: { description: 'For set_widget_property: value to set' },
      },
      required: ['blueprint_name', 'action'],
    },
  },

  // ----- Blueprint structure tools -----
  {
    name: 'add_blueprint_function',
    description: 'Add a new function graph to a Blueprint (UE 5.4+). Creates an empty function that can be used for custom logic.',
    inputSchema: {
      type: 'object',
      properties: {
        blueprint_name: { type: 'string' },
        function_name: { type: 'string', description: 'Name for the new function' },
      },
      required: ['blueprint_name', 'function_name'],
    },
  },
  {
    name: 'remove_blueprint_function',
    description: 'Remove a function graph from a Blueprint.',
    inputSchema: {
      type: 'object',
      properties: {
        blueprint_name: { type: 'string' },
        function_name: { type: 'string', description: 'Name of the function to remove' },
      },
      required: ['blueprint_name', 'function_name'],
    },
  },
  {
    name: 'add_blueprint_interface',
    description: 'Make a Blueprint implement an interface.',
    inputSchema: {
      type: 'object',
      properties: {
        blueprint_name: { type: 'string' },
        interface_name: { type: 'string', description: 'Interface class name or path (e.g. "BPI_Damageable" or "/Game/Interfaces/BPI_Interactable")' },
      },
      required: ['blueprint_name', 'interface_name'],
    },
  },
  {
    name: 'remove_blueprint_interface',
    description: 'Remove an implemented interface from a Blueprint.',
    inputSchema: {
      type: 'object',
      properties: {
        blueprint_name: { type: 'string' },
        interface_name: { type: 'string', description: 'Interface class name to remove' },
      },
      required: ['blueprint_name', 'interface_name'],
    },
  },
  {
    name: 'reparent_blueprint',
    description: 'Change the parent class of a Blueprint.',
    inputSchema: {
      type: 'object',
      properties: {
        blueprint_name: { type: 'string' },
        new_parent_class: { type: 'string', description: 'New parent class name (Actor, Pawn, Character, PlayerController, etc.)' },
      },
      required: ['blueprint_name', 'new_parent_class'],
    },
  },

  // ----- Asset exploration -----
  {
    name: 'explore_assets',
    description: 'Search and explore assets with powerful filters: by class, parent class, name, path, component type, implemented interface, and more.',
    inputSchema: {
      type: 'object',
      properties: {
        search_path: { type: 'string', description: 'Content path to search (default: /Game)' },
        class_filter: { type: 'string', description: 'Filter by asset class (Blueprint, Material, StaticMesh, Texture2D, SoundWave, etc.)' },
        parent_class: { type: 'string', description: 'For Blueprints: filter by parent class (Actor, Pawn, Character, etc.)' },
        name_filter: { type: 'string', description: 'Text filter on asset name (case-insensitive contains)' },
        has_component: { type: 'string', description: 'For Blueprints: filter by component type (e.g. StaticMeshComponent)' },
        implements_interface: { type: 'string', description: 'For Blueprints: filter by implemented interface name' },
        max_results: { type: 'number', description: 'Maximum results to return (default: 50)' },
      },
    },
  },

  // ----- Synthetic tool: Build Buddy blueprint composer -----
  // Handled locally in main process — never forwarded to Unreal as raw Python.
  {
    name: 'compose_blueprint',
    description: 'Compose a custom blueprint by unioning one or more Build Buddy library snippets. Writes composed T3D to the clipboard, creates required variables, opens the target blueprint, and prompts the user to press Cmd/Ctrl+V in the event graph. Only use snippet IDs from the Blueprint Snippet Catalog — never invent IDs. Snippets with parameters accept per-snippet overrides via the params field.',
    inputSchema: {
      type: 'object',
      properties: {
        snippet_ids: {
          type: 'array',
          items: { type: 'string' },
          description: 'One or more snippet IDs from the Blueprint Snippet Catalog. Pick the smallest set that covers the user\'s ask.',
        },
        params: {
          type: 'object',
          description: 'Per-snippet parameter overrides keyed by snippet ID. Example: { "quit-on-escape": { "key": "H" } }. Only use parameter names listed for that snippet in the catalog.',
          additionalProperties: {
            type: 'object',
            additionalProperties: { type: 'string' },
          },
        },
      },
      required: ['snippet_ids'],
    },
  },
  {
    name: 'build_blueprint_freeform',
    description: 'Last-resort Blueprint generator for asks no library snippet covers, even with parameter overrides. Accepts a structured intent (trigger + linear action chain + optional variables). Only call AFTER confirming compose_blueprint cannot work. Functions must come from the whitelist in the system prompt.',
    inputSchema: {
      type: 'object',
      properties: {
        intent: {
          type: 'object',
          description: 'BlueprintIntent JSON — see schema in the Blueprint Snippet Catalog system prompt for valid trigger/action shapes and the function whitelist.',
        },
      },
      required: ['intent'],
    },
  },
];

export class UnrealMCPService {
  private re: RemoteExecution | null = null;
  private status: UnrealMCPStatus = 'disconnected';
  private statusCallbacks: StatusCallback[] = [];
  private tools: MCPToolDefinition[] = [];
  private scriptsDir: string = '';

  onStatusChange(cb: StatusCallback): void {
    this.statusCallbacks.push(cb);
  }

  getStatus(): UnrealMCPStatus {
    return this.status;
  }

  getTools(): MCPToolDefinition[] {
    return this.tools;
  }

  private setStatus(s: UnrealMCPStatus): void {
    this.status = s;
    this.statusCallbacks.forEach(cb => cb(s));
  }

  private async cleanupInstance(): Promise<void> {
    if (this.re) {
      try { this.re.closeCommandConnection(); } catch { /* ignore */ }
      try { this.re.stop(); } catch { /* ignore */ }
      this.re = null;
      await new Promise(r => setTimeout(r, 600));
    }
    this.tools = [];
  }

  /**
   * On macOS, raw UDP multicast doesn't reliably trigger the Local Network
   * permission dialog. Performing an mDNS lookup forces macOS to check the
   * permission and show the prompt if it hasn't been granted yet.
   */
  private async ensureLocalNetworkPermission(): Promise<void> {
    if (process.platform !== 'darwin') return;

    console.log('[UnrealMCP] Triggering macOS Local Network permission check...');
    await Promise.allSettled([
      new Promise<void>((resolve) => {
        dns.resolve4('buildbuddy-probe.local', () => resolve());
        setTimeout(resolve, 2000);
      }),
      new Promise<void>((resolve) => {
        try {
          const sock = dgram.createSocket({ type: 'udp4', reuseAddr: true });
          sock.bind(0, '0.0.0.0', () => {
            try {
              sock.addMembership('239.0.0.1');
            } catch { /* ok */ }
            setTimeout(() => {
              try { sock.close(); } catch { /* ok */ }
              resolve();
            }, 1500);
          });
          sock.on('error', () => {
            try { sock.close(); } catch { /* ok */ }
            resolve();
          });
        } catch {
          resolve();
        }
      }),
    ]);
    console.log('[UnrealMCP] Local Network permission check complete');
  }

  async start(_enginePath: string, _projectPath: string): Promise<{ success: boolean; error?: string }> {
    if (this.status === 'connected' || this.status === 'starting') {
      return { success: true };
    }

    await this.cleanupInstance();
    this.setStatus('starting');
    console.log('[UnrealMCP] Starting — connecting directly to Unreal Editor via Remote Execution...');

    await this.ensureLocalNetworkPermission();

    try {
      this.scriptsDir = resolveScriptsDir();
      if (this.scriptsDir && fs.existsSync(this.scriptsDir)) {
        console.log('[UnrealMCP] Scripts dir:', this.scriptsDir);
      } else {
        this.scriptsDir = '';
        console.log('[UnrealMCP] @runreal/unreal-mcp scripts not found, using inline fallbacks');
      }
    } catch {
      this.scriptsDir = '';
    }

    const MAX_ATTEMPTS = 3;
    let lastError = '';

    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
      console.log(`[UnrealMCP] Attempt ${attempt}/${MAX_ATTEMPTS}...`);
      try {
        const config = new RemoteExecutionConfig(
          1,                        // multicastTTL
          ['239.0.0.1', 6766],      // multicastGroupEndpoint
          '0.0.0.0',                // multicastBindAddress
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
          this.tools = [];
        });

        const test = await this.re.runCommand('print("buildbuddy:ok")', true);
        if (!test.success) {
          throw new Error(`Smoke test failed: ${JSON.stringify(test.result)}`);
        }

        this.tools = [...TOOL_DEFINITIONS];
        this.setStatus('connected');
        console.log(`[UnrealMCP] Connected successfully. ${this.tools.length} tools available.`);
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
      ? 'Could not find Unreal Editor. Try these steps:\n1. Restart Unreal Editor (its Remote Execution can become unresponsive after repeated connections)\n2. Make sure your project is fully loaded\n3. Verify: Project Settings → Plugins → Python → Remote Execution is enabled\n4. Verify: Multicast Bind Address is 0.0.0.0\n5. macOS: System Settings → Privacy & Security → Local Network → allow BuildBuddy'
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
      const text = result.output.map((l: { output: string }) => l.output).join('\n');
      return {
        success: result.success,
        data: { content: [{ type: 'text', text: text || result.result }] },
        error: result.success ? undefined : result.result,
      };
    } catch (err) {
      if (err instanceof Error && (err.message.includes('closed') || err.message.includes('ECONNRESET'))) {
        this.setStatus('disconnected');
        this.tools = [];
      }
      return { success: false, error: err instanceof Error ? err.message : String(err) };
    }
  }

  async testConnection(): Promise<MCPProjectInfo | null> {
    if (!this.re || this.status !== 'connected') return null;
    try {
      const result = await this.re.runCommand(PROJECT_INFO_PY, true);
      const text = result.output.map((l: { output: string }) => l.output).join('').trim();
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

  async getEditorSnapshot(): Promise<string> {
    if (!this.re || this.status !== 'connected') return '';

    const script = `import unreal, json

result = {}

try:
    loc, rot = unreal.EditorLevelLibrary.get_level_viewport_camera_info()
    result["camera"] = {
        "location": {"x": round(loc.x, 1), "y": round(loc.y, 1), "z": round(loc.z, 1)},
        "rotation": {"pitch": round(rot.pitch, 1), "yaw": round(rot.yaw, 1), "roll": round(rot.roll, 1)}
    }
except Exception:
    pass

try:
    subsystem = unreal.get_editor_subsystem(unreal.EditorActorSubsystem)
    selected = subsystem.get_selected_level_actors()
    actors = []
    for a in selected:
        info = {
            "name": a.get_name(),
            "label": a.get_actor_label(),
            "class": a.get_class().get_name(),
            "location": {"x": round(a.get_actor_location().x, 1), "y": round(a.get_actor_location().y, 1), "z": round(a.get_actor_location().z, 1)},
            "rotation": {"pitch": round(a.get_actor_rotation().pitch, 1), "yaw": round(a.get_actor_rotation().yaw, 1), "roll": round(a.get_actor_rotation().roll, 1)},
            "scale": {"x": round(a.get_actor_scale3d().x, 4), "y": round(a.get_actor_scale3d().y, 4), "z": round(a.get_actor_scale3d().z, 4)}
        }
        actors.append(info)
    result["selected_actors"] = actors
except Exception:
    pass

print(json.dumps(result))`;

    try {
      const result = await this.re.runCommand(script, true);
      const text = result.output.map((l: { output: string }) => l.output).join('').trim();
      const parsed = JSON.parse(text);
      const parts: string[] = [];

      if (parsed.camera) {
        const c = parsed.camera;
        parts.push(`VIEWPORT CAMERA: location=(${c.location.x}, ${c.location.y}, ${c.location.z}) rotation=(pitch=${c.rotation.pitch}, yaw=${c.rotation.yaw}, roll=${c.rotation.roll})`);
      }

      if (parsed.selected_actors?.length) {
        parts.push(`SELECTED ACTORS (${parsed.selected_actors.length}):`);
        for (const a of parsed.selected_actors) {
          parts.push(`  - "${a.label}" (${a.class}) at (${a.location.x}, ${a.location.y}, ${a.location.z}), scale=(${a.scale.x}, ${a.scale.y}, ${a.scale.z})`);
        }
      } else {
        parts.push('SELECTED ACTORS: none');
      }

      return parts.join('\n');
    } catch (err) {
      console.warn('[UnrealMCP] getEditorSnapshot failed:', err);
      return '';
    }
  }

  // ===== Python command builder =====

  private buildPythonCommand(toolName: string, args: Record<string, unknown>): string {
    const s = this.scriptsDir;
    const str = (v: unknown) => typeof v === 'string' ? v : JSON.stringify(v);
    const esc = (v: unknown) => String(v ?? '').replace(/\\/g, '\\\\').replace(/'/g, "\\'");

    switch (toolName) {
      case 'editor_run_python':
        return (args.code ?? args.script ?? '') as string;

      case 'editor_console_command': {
        if (s) return templateScript(readScript(s, 'ue_console_command.py'), { command: str(args.command) });
        const cmd = (args.command ?? '') as string;
        const escaped = cmd.replace(/'/g, "\\'");
        return `import unreal\nunreal.SystemLibrary.execute_console_command(None, '${escaped}')`;
      }

      case 'editor_project_info':
        if (s) return readScript(s, 'ue_get_project_info.py');
        return PROJECT_INFO_PY;

      case 'editor_get_map_info':
        if (s) return readScript(s, 'ue_get_map_info.py');
        return `import unreal, json
try:
    world = unreal.get_editor_subsystem(unreal.UnrealEditorSubsystem).get_editor_world()
    if not world:
        print(json.dumps({"error": "No world loaded"}))
    else:
        all_actors = unreal.get_editor_subsystem(unreal.EditorActorSubsystem).get_all_level_actors()
        actor_types = {}
        for a in all_actors:
            cn = a.get_class().get_name()
            actor_types[cn] = actor_types.get(cn, 0) + 1
        top = dict(sorted(actor_types.items(), key=lambda x: x[1], reverse=True)[:15])
        dl = sum(1 for a in all_actors if a.get_class().get_name() == 'DirectionalLight')
        pl = sum(1 for a in all_actors if a.get_class().get_name() == 'PointLight')
        sl = sum(1 for a in all_actors if a.get_class().get_name() == 'SpotLight')
        print(json.dumps({"map_name": world.get_name(), "map_path": world.get_path_name(), "total_actors": len(all_actors), "actor_types": top, "lighting": {"directional_lights": dl, "point_lights": pl, "spot_lights": sl}}))
except Exception as e:
    print(json.dumps({"error": str(e)}))`;

      case 'editor_list_assets': {
        if (s) return readScript(s, 'ue_list_assets.py');
        const assetPath = (args.path ?? '/Game') as string;
        return `import unreal, json\nar = unreal.AssetRegistryHelpers.get_asset_registry()\nassets = ar.get_assets_by_path('${assetPath}', recursive=True)\nprint(json.dumps([str(a.package_name) for a in assets[:200]]))`;
      }

      case 'editor_search_assets': {
        if (s) return templateScript(readScript(s, 'ue_search_assets.py'), {
          search_term: str(args.search_term),
          asset_class: str(args.asset_class || ''),
        });
        const term = ((args.search_term ?? '') as string).replace(/'/g, "\\'");
        return `import unreal, json\nar = unreal.AssetRegistryHelpers.get_asset_registry()\nall_assets = ar.get_all_assets()\nterm = '${term}'.lower()\nresults = []\nfor a in all_assets:\n    name = str(a.asset_name).lower()\n    if term in name:\n        results.append({'name': str(a.asset_name), 'path': str(a.package_path), 'class': str(a.asset_class)})\n    if len(results) >= 50:\n        break\nprint(json.dumps(results))`;
      }

      case 'editor_get_world_outliner':
        if (s) return readScript(s, 'ue_get_world_outliner.py');
        return `import unreal, json
try:
    all_actors = unreal.get_editor_subsystem(unreal.EditorActorSubsystem).get_all_level_actors()
    actors = []
    for a in all_actors:
        try:
            info = {"name": a.get_name(), "label": a.get_actor_label(), "class": a.get_class().get_name(), "location": {"x": round(a.get_actor_location().x,1), "y": round(a.get_actor_location().y,1), "z": round(a.get_actor_location().z,1)}, "rotation": {"pitch": round(a.get_actor_rotation().pitch,1), "yaw": round(a.get_actor_rotation().yaw,1), "roll": round(a.get_actor_rotation().roll,1)}, "scale": {"x": round(a.get_actor_scale3d().x,4), "y": round(a.get_actor_scale3d().y,4), "z": round(a.get_actor_scale3d().z,4)}}
            comps = a.get_components_by_class(unreal.ActorComponent)
            if comps:
                info["components"] = [c.get_class().get_name() for c in comps[:5]]
            actors.append(info)
        except:
            pass
    actors.sort(key=lambda x: x["name"])
    print(json.dumps({"total_actors": len(actors), "actors": actors}))
except Exception as e:
    print(json.dumps({"error": str(e)}))`;

      case 'editor_get_asset_info': {
        if (s) return templateScript(readScript(s, 'ue_get_asset_info.py'), { asset_path: str(args.asset_path) });
        const ap = esc(args.asset_path);
        return `import unreal, json
try:
    ad = unreal.EditorAssetLibrary.find_asset_data('${ap}')
    if ad.is_valid():
        obj = ad.get_asset()
        info = {"name": obj.get_name(), "class": obj.get_class().get_name(), "path": obj.get_path_name()}
        if isinstance(obj, unreal.StaticMesh):
            try:
                info["num_lods"] = obj.get_num_lods()
            except:
                pass
        print(json.dumps(info))
    else:
        print(json.dumps({"error": "Asset not found: ${ap}"}))
except Exception as e:
    print(json.dumps({"error": str(e)}))`;
      }

      case 'editor_get_asset_references': {
        if (s) return templateScript(readScript(s, 'ue_get_asset_references.py'), { asset_path: str(args.asset_path) });
        const arp = esc(args.asset_path);
        return `import unreal, json
try:
    ar = unreal.AssetRegistryHelpers.get_asset_registry()
    ad = ar.get_asset_by_object_path('${arp}')
    refs = ar.get_referencers(ad.package_name, unreal.AssetRegistryDependencyOptions())
    result = []
    for r in refs:
        assets = ar.get_assets_by_package_name(r)
        for a in assets:
            parts = a.get_full_name().split(' ', 1)
            result.append({"class": parts[0], "name": parts[1] if len(parts) > 1 else str(r)})
    print(json.dumps(result))
except Exception as e:
    print(json.dumps({"error": str(e)}))`;
      }

      case 'editor_export_asset': {
        if (s) return templateScript(readScript(s, 'ue_export_asset.py'), { asset_path: str(args.asset_path) });
        const ep = esc(args.asset_path);
        return `import unreal, json, tempfile, os
try:
    asset = unreal.EditorAssetLibrary.load_asset('${ep}')
    if not asset:
        print(json.dumps({"error": "Asset not found: ${ep}"}))
    else:
        task = unreal.AssetExportTask()
        task.automated = True
        task.prompt = False
        task.replace_identical = True
        task.object = asset
        tmp = os.path.join(tempfile.gettempdir(), 'ue_export_tmp')
        task.filename = tmp
        ok = unreal.Exporter.run_asset_export_task(task)
        if ok and os.path.exists(tmp):
            with open(tmp, 'r', errors='replace') as f:
                print(f.read()[:50000])
        else:
            print(json.dumps({"error": "Export failed"}))
except Exception as e:
    print(json.dumps({"error": str(e)}))`;
      }

      case 'editor_validate_assets': {
        if (s) return templateScript(readScript(s, 'ue_validate_assets.py'), { asset_paths: str(args.asset_paths || '') });
        const vp = esc(args.asset_paths || '');
        return `import unreal, json
try:
    paths_str = '${vp}'
    if paths_str:
        paths = [p.strip() for p in paths_str.split(',')]
    else:
        ar = unreal.AssetRegistryHelpers.get_asset_registry()
        all_a = ar.get_all_assets()
        paths = [str(a.package_path) + '/' + str(a.asset_name) for a in all_a[:100]]
    valid = []
    invalid = []
    for p in paths:
        try:
            if not unreal.EditorAssetLibrary.does_asset_exist(p):
                invalid.append({"path": p, "error": "Does not exist"})
                continue
            a = unreal.EditorAssetLibrary.load_asset(p)
            if a:
                valid.append({"path": p, "class": a.get_class().get_name()})
            else:
                invalid.append({"path": p, "error": "Failed to load"})
        except Exception as ex:
            invalid.append({"path": p, "error": str(ex)})
    total = len(valid) + len(invalid)
    print(json.dumps({"total": total, "valid": len(valid), "invalid": len(invalid), "invalid_assets": invalid}))
except Exception as e:
    print(json.dumps({"error": str(e)}))`;
      }

      case 'editor_create_object': {
        if (s) return templateScript(readScript(s, 'ue_create_object.py'), {
          object_class: str(args.object_class),
          object_name: str(args.object_name),
          location: args.location ? JSON.stringify(args.location) : 'null',
          rotation: args.rotation ? JSON.stringify(args.rotation) : 'null',
          scale: args.scale ? JSON.stringify(args.scale) : 'null',
          properties: args.properties ? JSON.stringify(args.properties) : 'null',
        });
        const oc = esc(args.object_class);
        const on = esc(args.object_name);
        const ol = args.location ? JSON.stringify(args.location) : 'None';
        const orot = args.rotation ? JSON.stringify(args.rotation) : 'None';
        const osc = args.scale ? JSON.stringify(args.scale) : 'None';
        const oprops = args.properties ? JSON.stringify(args.properties) : 'None';
        return `import unreal, json
try:
    class_map = {"StaticMeshActor": unreal.StaticMeshActor, "SkeletalMeshActor": unreal.SkeletalMeshActor, "DirectionalLight": unreal.DirectionalLight, "PointLight": unreal.PointLight, "SpotLight": unreal.SpotLight, "Camera": unreal.CameraActor, "CameraActor": unreal.CameraActor, "Pawn": unreal.Pawn, "Character": unreal.Character, "PlayerStart": unreal.PlayerStart}
    actor_class = class_map.get('${oc}', None)
    if not actor_class:
        try:
            actor_class = unreal.load_class(None, '${oc}')
        except:
            pass
    if not actor_class:
        try:
            actor_class = getattr(unreal, '${oc}', None)
        except:
            pass
    if not actor_class:
        print(json.dumps({"error": "Could not find class: ${oc}"}))
    else:
        loc_d = ${ol}
        rot_d = ${orot}
        scl_d = ${osc}
        props = ${oprops}
        loc = unreal.Vector(loc_d.get('x',0), loc_d.get('y',0), loc_d.get('z',0)) if loc_d else unreal.Vector(0,0,0)
        rot = unreal.Rotator(rot_d.get('pitch',0), rot_d.get('yaw',0), rot_d.get('roll',0)) if rot_d else unreal.Rotator(0,0,0)
        actor = unreal.EditorLevelLibrary.spawn_actor_from_class(actor_class, loc, rot)
        if not actor:
            print(json.dumps({"error": "Failed to spawn actor"}))
        else:
            if '${on}':
                actor.set_actor_label('${on}')
            if scl_d:
                actor.set_actor_scale3d(unreal.Vector(scl_d.get('x',1), scl_d.get('y',1), scl_d.get('z',1)))
            if actor.get_class().get_name() == 'StaticMeshActor':
                mc = actor.get_component_by_class(unreal.StaticMeshComponent)
                if mc and not props:
                    name_lower = '${on}'.lower()
                    mesh_path = '/Engine/BasicShapes/Cube'
                    if 'sphere' in name_lower or 'ball' in name_lower:
                        mesh_path = '/Engine/BasicShapes/Sphere'
                    elif 'cylinder' in name_lower:
                        mesh_path = '/Engine/BasicShapes/Cylinder'
                    elif 'cone' in name_lower:
                        mesh_path = '/Engine/BasicShapes/Cone'
                    elif 'plane' in name_lower:
                        mesh_path = '/Engine/BasicShapes/Plane'
                    m = unreal.EditorAssetLibrary.load_asset(mesh_path)
                    if m:
                        mc.set_static_mesh(m)
                    mat = unreal.EditorAssetLibrary.load_asset('/Engine/BasicShapes/BasicShapeMaterial')
                    if mat:
                        mc.set_material(0, mat)
            if props:
                for pn, pv in props.items():
                    try:
                        if pn == 'StaticMesh' and actor.get_class().get_name() == 'StaticMeshActor':
                            sm = unreal.EditorAssetLibrary.load_asset(pv)
                            if sm:
                                actor.get_component_by_class(unreal.StaticMeshComponent).set_static_mesh(sm)
                        elif pn == 'Material' and actor.get_class().get_name() == 'StaticMeshActor':
                            mt = unreal.EditorAssetLibrary.load_asset(pv)
                            if mt:
                                actor.get_component_by_class(unreal.StaticMeshComponent).set_material(0, mt)
                        elif hasattr(actor, pn):
                            setattr(actor, pn, pv)
                    except:
                        pass
            al = actor.get_actor_location()
            ar2 = actor.get_actor_rotation()
            asc = actor.get_actor_scale3d()
            print(json.dumps({"success": True, "actor_name": actor.get_name(), "actor_label": actor.get_actor_label(), "class": actor.get_class().get_name(), "location": {"x": al.x, "y": al.y, "z": al.z}, "rotation": {"pitch": ar2.pitch, "yaw": ar2.yaw, "roll": ar2.roll}, "scale": {"x": asc.x, "y": asc.y, "z": asc.z}}))
except Exception as e:
    print(json.dumps({"error": str(e)}))`;
      }

      case 'editor_update_object': {
        if (s) return templateScript(readScript(s, 'ue_update_object.py'), {
          actor_name: str(args.actor_name),
          location: args.location ? JSON.stringify(args.location) : 'null',
          rotation: args.rotation ? JSON.stringify(args.rotation) : 'null',
          scale: args.scale ? JSON.stringify(args.scale) : 'null',
          properties: args.properties ? JSON.stringify(args.properties) : 'null',
          new_name: args.new_name ? str(args.new_name) : 'null',
        });
        const uan = esc(args.actor_name);
        const ul = args.location ? JSON.stringify(args.location) : 'None';
        const ur = args.rotation ? JSON.stringify(args.rotation) : 'None';
        const usc = args.scale ? JSON.stringify(args.scale) : 'None';
        const up = args.properties ? JSON.stringify(args.properties) : 'None';
        const unn = args.new_name ? `'${esc(args.new_name)}'` : 'None';
        return `import unreal, json
try:
    all_actors = unreal.get_editor_subsystem(unreal.EditorActorSubsystem).get_all_level_actors()
    target = None
    for a in all_actors:
        if a.get_name() == '${uan}' or a.get_actor_label() == '${uan}':
            target = a
            break
    if not target:
        print(json.dumps({"error": "Actor not found: ${uan}"}))
    else:
        loc_d = ${ul}
        rot_d = ${ur}
        scl_d = ${usc}
        props = ${up}
        nn = ${unn}
        if loc_d:
            target.set_actor_location(unreal.Vector(loc_d.get('x', target.get_actor_location().x), loc_d.get('y', target.get_actor_location().y), loc_d.get('z', target.get_actor_location().z)), False, False)
        if rot_d:
            target.set_actor_rotation(unreal.Rotator(rot_d.get('pitch', 0), rot_d.get('yaw', 0), rot_d.get('roll', 0)), False)
        if scl_d:
            target.set_actor_scale3d(unreal.Vector(scl_d.get('x',1), scl_d.get('y',1), scl_d.get('z',1)))
        if nn:
            target.set_actor_label(nn)
        if props:
            for pn, pv in props.items():
                try:
                    if hasattr(target, pn):
                        setattr(target, pn, pv)
                except:
                    pass
        al = target.get_actor_location()
        ar2 = target.get_actor_rotation()
        asc = target.get_actor_scale3d()
        print(json.dumps({"success": True, "actor_name": target.get_name(), "actor_label": target.get_actor_label(), "location": {"x": al.x, "y": al.y, "z": al.z}, "rotation": {"pitch": ar2.pitch, "yaw": ar2.yaw, "roll": ar2.roll}, "scale": {"x": asc.x, "y": asc.y, "z": asc.z}}))
except Exception as e:
    print(json.dumps({"error": str(e)}))`;
      }

      case 'editor_delete_object': {
        if (s) return templateScript(readScript(s, 'ue_delete_object.py'), { actor_names: str(args.actor_names) });
        const dan = esc(args.actor_names);
        return `import unreal, json, ast
try:
    names_input = '${dan}'
    try:
        names_list = ast.literal_eval(names_input)
        if not isinstance(names_list, list):
            names_list = [str(names_list)]
    except:
        names_list = [names_input]
    all_actors = unreal.get_editor_subsystem(unreal.EditorActorSubsystem).get_all_level_actors()
    results = []
    for name in names_list:
        found = None
        for a in all_actors:
            if a.get_name() == name or a.get_actor_label() == name:
                found = a
                break
        if found:
            ok = unreal.get_editor_subsystem(unreal.EditorActorSubsystem).destroy_actor(found)
            results.append({"name": name, "deleted": ok})
        else:
            results.append({"name": name, "error": "Not found"})
    print(json.dumps({"success": True, "results": results}))
except Exception as e:
    print(json.dumps({"error": str(e)}))`;
      }

      case 'editor_take_screenshot': {
        if (s) return readScript(s, 'ue_take_screenshot.py');
        return `import unreal, os, tempfile\npath = os.path.join(tempfile.gettempdir(), 'ue_screenshot.png')\nunreal.AutomationLibrary.take_high_res_screenshot(1920, 1080, path)\nprint(path)`;
      }

      case 'editor_move_camera': {
        if (s) return templateScript(readScript(s, 'ue_move_camera.py'), {
          location: JSON.stringify(args.location),
          rotation: JSON.stringify(args.rotation),
        });
        const cl = JSON.stringify(args.location);
        const cr = JSON.stringify(args.rotation);
        return `import unreal, json
try:
    loc_d = ${cl}
    rot_d = ${cr}
    if loc_d and rot_d:
        loc = unreal.Vector(loc_d['x'], loc_d['y'], loc_d['z'])
        rot = unreal.Rotator(rot_d.get('roll',0), rot_d.get('pitch',0), rot_d.get('yaw',0))
        unreal.EditorLevelLibrary.set_level_viewport_camera_info(loc, rot)
        print(json.dumps({"success": True, "location": loc_d, "rotation": rot_d}))
    else:
        print(json.dumps({"error": "Location and rotation are required"}))
except Exception as e:
    print(json.dumps({"error": str(e)}))`;
      }

      // ===== Blueprint tools =====

      case 'create_blueprint': {
        const bpName = esc(args.name);
        const parentClass = esc(args.parent_class);
        return `import unreal, json
try:
    factory = unreal.BlueprintFactory()
    parent = getattr(unreal, '${parentClass}', None)
    if parent is None:
        parent = unreal.load_class(None, '/Script/Engine.${parentClass}')
    if parent is None:
        parent = unreal.load_class(None, '/Script/GameplayAbilities.${parentClass}')
    if parent is None:
        print(json.dumps({"success": False, "error": "Unknown parent class: ${parentClass}"}))
    else:
        factory.set_editor_property('ParentClass', parent)
        asset_tools = unreal.AssetToolsHelpers.get_asset_tools()
        bp = asset_tools.create_asset('${bpName}', '/Game/Blueprints', unreal.Blueprint, factory)
        if bp:
            unreal.EditorAssetLibrary.save_asset(bp.get_path_name(), False)
            print(json.dumps({"success": True, "name": bp.get_name(), "path": bp.get_path_name()}))
        else:
            print(json.dumps({"success": False, "error": "create_asset returned None"}))
except Exception as e:
    print(json.dumps({"success": False, "error": str(e)}))`;
      }

      case 'add_component_to_blueprint': {
        const bpName = esc(args.blueprint_name);
        const compType = esc(args.component_type);
        const compName = esc(args.component_name);
        return `import unreal, json
${FIND_BP_PY}
try:
    bp = _find_bp('${bpName}')
    if not bp:
        print(json.dumps({"success": False, "error": "Blueprint not found: ${bpName}"}))
    else:
        comp_class = None
        candidates = ['${compType}']
        base = '${compType}'
        if not base.endswith('Component'):
            candidates.append(base + 'Component')
        for c in candidates:
            comp_class = getattr(unreal, c, None)
            if comp_class:
                break
        if not comp_class:
            for c in candidates:
                for mod in ['/Script/Engine.', '/Script/UMG.', '/Script/NavigationSystem.', '/Script/AIModule.']:
                    try:
                        comp_class = unreal.load_class(None, mod + c)
                        if comp_class:
                            break
                    except:
                        pass
                if comp_class:
                    break
        if not comp_class:
            print(json.dumps({"success": False, "error": "Unknown component type: ${compType}. Try full name like StaticMeshComponent."}))
        else:
            scs = bp.simple_construction_script
            if scs is None:
                try:
                    scs = bp.get_editor_property('SimpleConstructionScript')
                except:
                    pass
            if scs is None:
                subsys = unreal.get_engine_subsystem(unreal.SubobjectDataSubsystem)
                if subsys:
                    handles = subsys.k2_gather_subobject_data_for_blueprint(bp)
                    handle = subsys.add_new_subobject(unreal.AddNewSubobjectParams(parent_handle=handles[0] if handles else unreal.SubobjectDataHandle(), new_class=comp_class, blueprint_context=bp))
                    if handle.is_valid():
                        unreal.BlueprintEditorLibrary.compile_blueprint(bp)
                        unreal.EditorAssetLibrary.save_asset(bp.get_path_name(), False)
                        print(json.dumps({"success": True, "component": '${compName}', "type": '${compType}', "method": "SubobjectDataSubsystem"}))
                    else:
                        print(json.dumps({"success": False, "error": "SubobjectDataSubsystem failed to add component. SCS also unavailable."}))
                else:
                    print(json.dumps({"success": False, "error": "Blueprint has no SimpleConstructionScript and SubobjectDataSubsystem unavailable."}))
            else:
                node = scs.create_node(comp_class, '${compName}')
                if node:
                    root = scs.get_default_scene_root_node()
                    if root:
                        node.set_parent(root)
                    else:
                        scs.add_node(node)
                    unreal.BlueprintEditorLibrary.compile_blueprint(bp)
                    unreal.EditorAssetLibrary.save_asset(bp.get_path_name(), False)
                    print(json.dumps({"success": True, "component": '${compName}', "type": str(comp_class.get_name() if hasattr(comp_class, 'get_name') else '${compType}'), "method": "SCS"}))
                else:
                    print(json.dumps({"success": False, "error": "SCS.create_node returned None for " + str(comp_class)}))
except Exception as e:
    print(json.dumps({"success": False, "error": str(e)}))`;
      }

      case 'set_static_mesh_properties': {
        const bpName = esc(args.blueprint_name);
        const compName = esc(args.component_name);
        const meshPath = esc(args.static_mesh ?? '/Engine/BasicShapes/Cube.Cube');
        return `import unreal, json
${FIND_BP_PY}
${FIND_SCS_NODE_PY}
try:
    bp = _find_bp('${bpName}')
    if not bp:
        print(json.dumps({"success": False, "error": "Blueprint not found: ${bpName}"}))
    else:
        node = _find_scs_node(bp, '${compName}')
        if not node or not node.component_template:
            print(json.dumps({"success": False, "error": "Component not found: ${compName}"}))
        else:
            mesh = unreal.load_asset('${meshPath}')
            if mesh:
                tpl = node.component_template
                tpl.modify()
                tpl.pre_edit_change(None)
                tpl.set_static_mesh(mesh)
                tpl.mark_package_dirty()
                tpl.post_edit_change()
                unreal.BlueprintEditorLibrary.compile_blueprint(bp)
                print(json.dumps({"success": True, "mesh": '${meshPath}'}))
            else:
                print(json.dumps({"success": False, "error": "Mesh not found: ${meshPath}"}))
except Exception as e:
    print(json.dumps({"success": False, "error": str(e)}))`;
      }

      case 'set_component_property': {
        const bpName = esc(args.blueprint_name);
        const compName = esc(args.component_name);
        const propName = esc(args.property_name);
        const propValue = JSON.stringify(args.property_value);
        return `import unreal, json
${FIND_BP_PY}
${FIND_SCS_NODE_PY}
try:
    bp = _find_bp('${bpName}')
    if not bp:
        print(json.dumps({"success": False, "error": "Blueprint not found: ${bpName}"}))
    else:
        node = _find_scs_node(bp, '${compName}')
        if not node or not node.component_template:
            print(json.dumps({"success": False, "error": "Component not found: ${compName}"}))
        else:
            tpl = node.component_template
            tpl.modify()
            tpl.pre_edit_change(None)
            val = ${propValue}
            if isinstance(val, str) and val.startswith('/') and '.' in val:
                loaded = unreal.EditorAssetLibrary.load_asset(val)
                if loaded:
                    val = loaded
            tpl.set_editor_property('${propName}', val)
            tpl.mark_package_dirty()
            tpl.post_edit_change()
            unreal.BlueprintEditorLibrary.compile_blueprint(bp)
            print(json.dumps({"success": True}))
except Exception as e:
    print(json.dumps({"success": False, "error": str(e)}))`;
      }

      case 'set_physics_properties': {
        const bpName = esc(args.blueprint_name);
        const compName = esc(args.component_name);
        const simPhys = args.simulate_physics ?? true;
        const gravity = args.gravity_enabled ?? true;
        const mass = args.mass ?? 1.0;
        const linDamp = args.linear_damping ?? 0.01;
        const angDamp = args.angular_damping ?? 0.0;
        return `import unreal, json
${FIND_BP_PY}
${FIND_SCS_NODE_PY}
try:
    bp = _find_bp('${bpName}')
    if not bp:
        print(json.dumps({"success": False, "error": "Blueprint not found: ${bpName}"}))
    else:
        node = _find_scs_node(bp, '${compName}')
        if not node or not node.component_template:
            print(json.dumps({"success": False, "error": "Component not found: ${compName}"}))
        else:
            tpl = node.component_template
            tpl.set_simulate_physics(${simPhys ? 'True' : 'False'})
            tpl.set_enable_gravity(${gravity ? 'True' : 'False'})
            tpl.set_mass_override_in_kg(unreal.Name('None'), ${mass})
            tpl.set_editor_property('LinearDamping', ${linDamp})
            tpl.set_editor_property('AngularDamping', ${angDamp})
            unreal.BlueprintEditorLibrary.compile_blueprint(bp)
            print(json.dumps({"success": True}))
except Exception as e:
    print(json.dumps({"success": False, "error": str(e)}))`;
      }

      case 'compile_blueprint': {
        const bpName = esc(args.blueprint_name);
        return `import unreal, json
${FIND_BP_PY}
try:
    bp = _find_bp('${bpName}')
    if not bp:
        print(json.dumps({"success": False, "error": "Blueprint not found: ${bpName}"}))
    else:
        unreal.BlueprintEditorLibrary.compile_blueprint(bp)
        unreal.EditorAssetLibrary.save_asset(bp.get_path_name(), False)
        print(json.dumps({"success": True, "name": bp.get_name()}))
except Exception as e:
    print(json.dumps({"success": False, "error": str(e)}))`;
      }

      case 'set_blueprint_property': {
        const bpName = esc(args.blueprint_name);
        const propName = esc(args.property_name);
        const propValue = JSON.stringify(args.property_value);
        return `import unreal, json
${FIND_BP_PY}
try:
    bp = _find_bp('${bpName}')
    if not bp:
        print(json.dumps({"success": False, "error": "Blueprint not found: ${bpName}"}))
    else:
        cdo = bp.generated_class.get_default_object()
        cdo.set_editor_property('${propName}', ${propValue})
        unreal.BlueprintEditorLibrary.compile_blueprint(bp)
        print(json.dumps({"success": True}))
except Exception as e:
    print(json.dumps({"success": False, "error": str(e)}))`;
      }

      case 'spawn_blueprint_actor': {
        const bpName = esc(args.blueprint_name);
        const actorName = esc(args.actor_name);
        const loc = args.location as Record<string, number> | undefined;
        const rot = args.rotation as Record<string, number> | undefined;
        const lx = loc?.x ?? 0; const ly = loc?.y ?? 0; const lz = loc?.z ?? 0;
        const rp = rot?.pitch ?? 0; const ry = rot?.yaw ?? 0; const rr = rot?.roll ?? 0;
        return `import unreal, json
${FIND_BP_PY}
try:
    bp = _find_bp('${bpName}')
    if not bp:
        print(json.dumps({"success": False, "error": "Blueprint not found: ${bpName}"}))
    else:
        loc = unreal.Vector(${lx}, ${ly}, ${lz})
        rot = unreal.Rotator(${rp}, ${ry}, ${rr})
        actor = unreal.EditorLevelLibrary.spawn_actor_from_class(bp.generated_class, loc, rot)
        if actor:
            actor.set_actor_label('${actorName}')
            print(json.dumps({"success": True, "name": actor.get_name(), "label": '${actorName}'}))
        else:
            print(json.dumps({"success": False, "error": "spawn_actor_from_class returned None"}))
except Exception as e:
    print(json.dumps({"success": False, "error": str(e)}))`;
      }

      case 'add_blueprint_variable': {
        const bpName = esc(args.blueprint_name as string);
        const varName = esc(args.variable_name);
        const varType = esc(args.variable_type);
        const instEditable = args.instance_editable === true ? 'True' : 'False';
        const bpReadOnly = args.blueprint_read_only === true ? 'True' : 'False';
        const exposeSpawn = args.expose_on_spawn === true ? 'True' : 'False';
        const replicated = args.replicated === true ? 'True' : 'False';
        const saveGame = args.save_game === true ? 'True' : 'False';
        const isPrivate = args.is_private === true ? 'True' : 'False';
        const category = args.category ? `'${esc(args.category)}'` : 'None';
        const defaultVal = args.default_value !== undefined ? JSON.stringify(args.default_value) : 'None';
        return `import unreal, json
${FIND_BP_PY}
try:
    bp = _find_bp('${bpName}')
    if not bp:
        print(json.dumps({"success": False, "error": "Blueprint not found: ${bpName}"}))
    else:
        type_map = {
            'bool': 'bool', 'boolean': 'bool',
            'int': 'int', 'integer': 'int', 'int32': 'int',
            'float': 'real', 'double': 'real',
            'string': 'string', 'str': 'string',
            'name': 'name',
            'text': 'text',
            'vector': 'struct', 'rotator': 'struct', 'transform': 'struct',
            'object': 'object',
        }
        vt = '${varType}'.lower()
        pin_cat = type_map.get(vt, vt)
        sub_cat = ''
        if vt == 'vector':
            sub_cat = '/Script/CoreUObject.Vector'
        elif vt == 'rotator':
            sub_cat = '/Script/CoreUObject.Rotator'
        elif vt == 'transform':
            sub_cat = '/Script/CoreUObject.Transform'
        success = unreal.BlueprintEditorLibrary.add_variable(bp, '${varName}', pin_cat, sub_cat)
        if success:
            flags_applied = []
            try:
                for var_desc in bp.new_variables:
                    if str(var_desc.var_name) == '${varName}':
                        if ${instEditable}:
                            var_desc.set_editor_property('PropertyFlags', var_desc.get_editor_property('PropertyFlags') | 4)
                            flags_applied.append('instance_editable')
                        if ${bpReadOnly}:
                            var_desc.set_editor_property('PropertyFlags', var_desc.get_editor_property('PropertyFlags') | 8)
                            flags_applied.append('blueprint_read_only')
                        if ${exposeSpawn}:
                            var_desc.set_editor_property('PropertyFlags', var_desc.get_editor_property('PropertyFlags') | 0x0002000000000000)
                            flags_applied.append('expose_on_spawn')
                        if ${replicated}:
                            var_desc.rep_notify_func = 'None'
                            var_desc.set_editor_property('PropertyFlags', var_desc.get_editor_property('PropertyFlags') | 0x0000008000000000)
                            flags_applied.append('replicated')
                        if ${saveGame}:
                            var_desc.set_editor_property('PropertyFlags', var_desc.get_editor_property('PropertyFlags') | 0x0001000000000000)
                            flags_applied.append('save_game')
                        if ${isPrivate}:
                            var_desc.set_editor_property('PropertyFlags', var_desc.get_editor_property('PropertyFlags') | 0x0040000000000000)
                            flags_applied.append('private')
                        cat = ${category}
                        if cat:
                            var_desc.set_editor_property('Category', unreal.Text(cat))
                            flags_applied.append('category=' + cat)
                        break
            except Exception as fe:
                flags_applied.append('flag_error: ' + str(fe))
            dv = ${defaultVal}
            if dv is not None:
                try:
                    cdo = bp.generated_class.get_default_object()
                    cdo.set_editor_property('${varName}', dv)
                    flags_applied.append('default_value_set')
                except Exception as dve:
                    flags_applied.append('default_error: ' + str(dve))
            unreal.BlueprintEditorLibrary.compile_blueprint(bp)
            print(json.dumps({"success": True, "variable": '${varName}', "type": '${varType}', "flags": flags_applied}))
        else:
            print(json.dumps({"success": False, "error": "add_variable returned False"}))
except Exception as e:
    print(json.dumps({"success": False, "error": str(e)}))`;
      }

      case 'create_input_mapping': {
        const actionName = esc(args.action_name);
        const key = esc(args.key);
        const inputType = esc(args.input_type ?? 'Action');
        return `import unreal, json
try:
    settings = unreal.InputSettings.get_input_settings()
    key_obj = unreal.Key('${key}')
    if '${inputType}'.lower() == 'axis':
        mapping = unreal.InputAxisKeyMapping('${actionName}', key_obj, 1.0)
        settings.add_axis_mapping(mapping, True)
    else:
        mapping = unreal.InputActionKeyMapping('${actionName}', False, False, False, False, key_obj)
        settings.add_action_mapping(mapping, True)
    settings.save_key_mappings()
    print(json.dumps({"success": True, "action": '${actionName}', "key": '${key}', "type": '${inputType}'}))
except Exception as e:
    print(json.dumps({"success": False, "error": str(e)}))`;
      }

      // ===== Material tools =====

      case 'set_actor_material': {
        const an = esc(args.actor_name);
        const mp = esc(args.material_path);
        const si = args.slot_index ?? 0;
        return `import unreal, json
${FIND_ACTOR_PY}
try:
    actor = _find_actor('${an}')
    if not actor:
        print(json.dumps({"success": False, "error": "Actor not found: ${an}"}))
    else:
        mat = unreal.EditorAssetLibrary.load_asset('${mp}')
        if not mat:
            mat = unreal.load_asset('${mp}')
        if not mat:
            print(json.dumps({"success": False, "error": "Material not found: ${mp}"}))
        else:
            applied = False
            for comp_class in [unreal.StaticMeshComponent, unreal.SkeletalMeshComponent]:
                mc = actor.get_component_by_class(comp_class)
                if mc:
                    mc.set_material(${si}, mat)
                    applied = True
                    break
            if not applied:
                comps = actor.get_components_by_class(unreal.PrimitiveComponent)
                for c in comps:
                    try:
                        c.set_material(${si}, mat)
                        applied = True
                        break
                    except:
                        pass
            if applied:
                print(json.dumps({"success": True, "actor": '${an}', "material": '${mp}', "slot": ${si}}))
            else:
                print(json.dumps({"success": False, "error": "No mesh component found on actor ${an}"}))
except Exception as e:
    print(json.dumps({"success": False, "error": str(e)}))`;
      }

      case 'create_material_instance': {
        const miName = esc(args.name);
        const parentMat = esc(args.parent_material);
        const scalarP = args.scalar_params ? JSON.stringify(args.scalar_params) : '{}';
        const vectorP = args.vector_params ? JSON.stringify(args.vector_params) : '{}';
        const textureP = args.texture_params ? JSON.stringify(args.texture_params) : '{}';
        return `import unreal, json
try:
    factory = unreal.MaterialInstanceConstantFactoryNew()
    asset_tools = unreal.AssetToolsHelpers.get_asset_tools()
    mi = asset_tools.create_asset('${miName}', '/Game/Materials', unreal.MaterialInstanceConstant, factory)
    if not mi:
        print(json.dumps({"success": False, "error": "Failed to create material instance"}))
    else:
        parent = unreal.EditorAssetLibrary.load_asset('${parentMat}')
        if not parent:
            parent = unreal.load_asset('${parentMat}')
        if parent:
            mi.set_editor_property('Parent', parent)
        scalars = ${scalarP}
        for name, val in scalars.items():
            mi.set_scalar_parameter_value(name, float(val))
        vectors = ${vectorP}
        for name, val in vectors.items():
            if isinstance(val, dict):
                mi.set_vector_parameter_value(name, unreal.LinearColor(val.get('r',0), val.get('g',0), val.get('b',0), val.get('a',1)))
        textures = ${textureP}
        for name, path in textures.items():
            tex = unreal.EditorAssetLibrary.load_asset(path)
            if tex:
                mi.set_texture_parameter_value(name, tex)
        unreal.EditorAssetLibrary.save_asset(mi.get_path_name(), False)
        print(json.dumps({"success": True, "name": mi.get_name(), "path": mi.get_path_name()}))
except Exception as e:
    print(json.dumps({"success": False, "error": str(e)}))`;
      }

      // ===== Actor utility tools =====

      case 'duplicate_actor': {
        const dan = esc(args.actor_name);
        const dnl = args.new_label ? `'${esc(args.new_label)}'` : 'None';
        const doff = args.offset as Record<string, number> | undefined;
        const dox = doff?.x ?? 200; const doy = doff?.y ?? 0; const doz = doff?.z ?? 0;
        return `import unreal, json
${FIND_ACTOR_PY}
try:
    actor = _find_actor('${dan}')
    if not actor:
        print(json.dumps({"success": False, "error": "Actor not found: ${dan}"}))
    else:
        subsys = unreal.get_editor_subsystem(unreal.EditorActorSubsystem)
        subsys.select_nothing()
        subsys.set_actor_selection_state(actor, True)
        subsys.duplicate_selected_actors(unreal.get_editor_subsystem(unreal.UnrealEditorSubsystem).get_editor_world())
        selected = subsys.get_selected_level_actors()
        dup = None
        for a in selected:
            if a != actor:
                dup = a
                break
        if dup:
            new_loc = actor.get_actor_location() + unreal.Vector(${dox}, ${doy}, ${doz})
            dup.set_actor_location(new_loc, False, False)
            nl = ${dnl}
            if nl:
                dup.set_actor_label(nl)
            al = dup.get_actor_location()
            print(json.dumps({"success": True, "name": dup.get_name(), "label": dup.get_actor_label(), "location": {"x": al.x, "y": al.y, "z": al.z}}))
        else:
            print(json.dumps({"success": False, "error": "Duplication failed"}))
except Exception as e:
    print(json.dumps({"success": False, "error": str(e)}))`;
      }

      case 'set_actor_mobility': {
        const man = esc(args.actor_name);
        const mob = esc(args.mobility);
        return `import unreal, json
${FIND_ACTOR_PY}
try:
    actor = _find_actor('${man}')
    if not actor:
        print(json.dumps({"success": False, "error": "Actor not found: ${man}"}))
    else:
        mob_map = {'static': unreal.ComponentMobility.STATIC, 'movable': unreal.ComponentMobility.MOVABLE, 'stationary': unreal.ComponentMobility.STATIONARY}
        mob = mob_map.get('${mob}'.lower())
        if mob is None:
            print(json.dumps({"success": False, "error": "Invalid mobility: ${mob}. Use Static, Movable, or Stationary."}))
        else:
            root = actor.get_editor_property('root_component')
            if root:
                root.set_mobility(mob)
                print(json.dumps({"success": True, "actor": '${man}', "mobility": '${mob}'}))
            else:
                print(json.dumps({"success": False, "error": "Actor has no root component"}))
except Exception as e:
    print(json.dumps({"success": False, "error": str(e)}))`;
      }

      case 'focus_viewport_on_actor': {
        const fan = esc(args.actor_name);
        const fdist = args.distance ?? 500;
        return `import unreal, json
${FIND_ACTOR_PY}
try:
    actor = _find_actor('${fan}')
    if not actor:
        print(json.dumps({"success": False, "error": "Actor not found: ${fan}"}))
    else:
        loc = actor.get_actor_location()
        cam_loc = unreal.Vector(loc.x - ${fdist}, loc.y, loc.z + ${fdist} * 0.3)
        dx = loc.x - cam_loc.x
        dy = loc.y - cam_loc.y
        dz = loc.z - cam_loc.z
        import math
        pitch = math.degrees(math.atan2(dz, math.sqrt(dx*dx + dy*dy)))
        yaw = math.degrees(math.atan2(dy, dx))
        rot = unreal.Rotator(0, pitch, yaw)
        unreal.EditorLevelLibrary.set_level_viewport_camera_info(cam_loc, rot)
        print(json.dumps({"success": True, "target": '${fan}', "camera_location": {"x": cam_loc.x, "y": cam_loc.y, "z": cam_loc.z}}))
except Exception as e:
    print(json.dumps({"success": False, "error": str(e)}))`;
      }

      case 'get_blueprint_components': {
        const gcbn = esc(args.blueprint_name);
        return `import unreal, json
${FIND_BP_PY}
try:
    bp = _find_bp('${gcbn}')
    if not bp:
        print(json.dumps({"success": False, "error": "Blueprint not found: ${gcbn}"}))
    else:
        components = []
        scs = bp.simple_construction_script
        if scs:
            for node in scs.get_all_nodes():
                info = {"variable_name": str(node.get_variable_name()) if hasattr(node, 'get_variable_name') else "unknown"}
                tpl = node.component_template
                if tpl:
                    info["class"] = tpl.get_class().get_name()
                    info["name"] = tpl.get_name()
                    if hasattr(tpl, 'relative_location'):
                        rl = tpl.relative_location
                        info["relative_location"] = {"x": rl.x, "y": rl.y, "z": rl.z}
                is_root = (node == scs.get_default_scene_root_node())
                info["is_root"] = is_root
                components.append(info)
        print(json.dumps({"success": True, "blueprint": '${gcbn}', "components": components, "count": len(components), "has_scs": scs is not None}))
except Exception as e:
    print(json.dumps({"success": False, "error": str(e)}))`;
      }

      case 'rename_actor': {
        const ran = esc(args.actor_name);
        const rnn = esc(args.new_name);
        return `import unreal, json
${FIND_ACTOR_PY}
try:
    actor = _find_actor('${ran}')
    if not actor:
        print(json.dumps({"success": False, "error": "Actor not found: ${ran}"}))
    else:
        old_label = actor.get_actor_label()
        actor.set_actor_label('${rnn}')
        print(json.dumps({"success": True, "old_label": old_label, "new_label": '${rnn}'}))
except Exception as e:
    print(json.dumps({"success": False, "error": str(e)}))`;
      }

      case 'set_actor_collision': {
        const can = esc(args.actor_name);
        const ce = args.collision_enabled ? `'${esc(args.collision_enabled)}'` : 'None';
        const cp = args.collision_profile ? `'${esc(args.collision_profile)}'` : 'None';
        return `import unreal, json
${FIND_ACTOR_PY}
try:
    actor = _find_actor('${can}')
    if not actor:
        print(json.dumps({"success": False, "error": "Actor not found: ${can}"}))
    else:
        comp = None
        for cc in [unreal.StaticMeshComponent, unreal.SkeletalMeshComponent, unreal.PrimitiveComponent]:
            comp = actor.get_component_by_class(cc)
            if comp:
                break
        if not comp:
            print(json.dumps({"success": False, "error": "No primitive component found on actor"}))
        else:
            ce_val = ${ce}
            cp_val = ${cp}
            if ce_val:
                ce_map = {'nocollision': unreal.CollisionEnabled.NO_COLLISION, 'queryonly': unreal.CollisionEnabled.QUERY_ONLY, 'physicsonly': unreal.CollisionEnabled.PHYSICS_ONLY, 'queryandphysics': unreal.CollisionEnabled.QUERY_AND_PHYSICS}
                ce_enum = ce_map.get(ce_val.lower().replace(' ', ''))
                if ce_enum is not None:
                    comp.set_collision_enabled(ce_enum)
            if cp_val:
                comp.set_collision_profile_name(cp_val)
            print(json.dumps({"success": True, "actor": '${can}'}))
except Exception as e:
    print(json.dumps({"success": False, "error": str(e)}))`;
      }

      case 'import_asset': {
        const isp = esc(args.source_path);
        const idp = esc(args.destination_path ?? '/Game/Imported');
        return `import unreal, json
try:
    task = unreal.AssetImportTask()
    task.filename = '${isp}'
    task.destination_path = '${idp}'
    task.automated = True
    task.replace_existing = True
    task.save = True
    unreal.AssetToolsHelpers.get_asset_tools().import_asset_tasks([task])
    if task.imported_object_paths:
        paths = [str(p) for p in task.imported_object_paths]
        print(json.dumps({"success": True, "imported": paths}))
    elif task.result:
        print(json.dumps({"success": True, "asset": task.result.get_path_name()}))
    else:
        print(json.dumps({"success": True, "message": "Import task completed"}))
except Exception as e:
    print(json.dumps({"success": False, "error": str(e)}))`;
      }

      // ===== Universal property configuration (configure_asset) =====

      case 'configure_asset': {
        const assetName = esc(args.asset_name);
        const subobject = args.subobject ? `'${esc(args.subobject)}'` : 'None';
        const changes = args.changes ? JSON.stringify(args.changes) : '[]';
        const listProps = args.list_properties === true ? 'True' : 'False';
        const getProps = args.get_properties ? JSON.stringify(args.get_properties) : '[]';
        return `import unreal, json
${FIND_ASSET_PY}
${FIND_BP_PY}
try:
    asset = _find_asset('${assetName}')
    if not asset:
        asset = _find_bp('${assetName}')
    if not asset:
        print(json.dumps({"success": False, "error": "Asset not found: ${assetName}"}))
    else:
        target = asset
        sub = ${subobject}
        if sub:
            if sub.upper() == 'CDO':
                if isinstance(asset, unreal.Blueprint) and asset.generated_class:
                    target = asset.generated_class.get_default_object()
                else:
                    target = asset
            elif isinstance(asset, unreal.Blueprint):
                scs = asset.simple_construction_script
                if scs:
                    for node in scs.get_all_nodes():
                        tpl = node.component_template
                        if tpl and (tpl.get_name() == sub or (hasattr(node, 'get_variable_name') and str(node.get_variable_name()) == sub)):
                            target = tpl
                            break
        result = {"success": True, "asset": asset.get_name(), "target": target.get_class().get_name()}
        if ${listProps}:
            props = []
            cls = target.get_class()
            for prop in cls.properties:
                try:
                    pname = str(prop.get_name())
                    ptype = str(prop.get_class().get_name())
                    props.append({"name": pname, "type": ptype})
                except:
                    pass
            if not props:
                try:
                    for attr in dir(target):
                        if not attr.startswith('_'):
                            try:
                                target.get_editor_property(attr)
                                props.append({"name": attr, "type": "unknown"})
                            except:
                                pass
                        if len(props) >= 200:
                            break
                except:
                    pass
            result["properties"] = props
            result["count"] = len(props)
        get_list = ${getProps}
        if get_list:
            values = {}
            for pn in get_list:
                try:
                    v = target.get_editor_property(pn)
                    if hasattr(v, 'x') and hasattr(v, 'y') and hasattr(v, 'z'):
                        values[pn] = {"x": v.x, "y": v.y, "z": v.z}
                    elif hasattr(v, 'pitch'):
                        values[pn] = {"pitch": v.pitch, "yaw": v.yaw, "roll": v.roll}
                    elif hasattr(v, 'r') and hasattr(v, 'g'):
                        values[pn] = {"r": v.r, "g": v.g, "b": v.b, "a": v.a}
                    elif isinstance(v, (bool, int, float, str)):
                        values[pn] = v
                    elif v is None:
                        values[pn] = None
                    else:
                        values[pn] = str(v)
                except Exception as ge:
                    values[pn] = {"error": str(ge)}
            result["values"] = values
        changes_list = ${changes}
        if changes_list:
            applied = []
            for ch in changes_list:
                pn = ch.get('property', '')
                pv = ch.get('value')
                try:
                    target.modify()
                    target.pre_edit_change(None)
                    if isinstance(pv, str) and pv.startswith('/') and '.' in pv:
                        loaded = unreal.EditorAssetLibrary.load_asset(pv)
                        if loaded:
                            pv = loaded
                    target.set_editor_property(pn, pv)
                    target.mark_package_dirty()
                    target.post_edit_change()
                    applied.append({"property": pn, "success": True})
                except Exception as ce:
                    applied.append({"property": pn, "success": False, "error": str(ce)})
            result["changes"] = applied
            if isinstance(asset, unreal.Blueprint):
                unreal.BlueprintEditorLibrary.compile_blueprint(asset)
        print(json.dumps(result))
except Exception as e:
    print(json.dumps({"success": False, "error": str(e)}))`;
      }

      // ===== Enhanced Input tools (UE5) =====

      case 'create_input_action': {
        const iaName = esc(args.name);
        const iaValueType = esc(args.value_type ?? 'Boolean');
        const iaPath = esc(args.path ?? '/Game/Input');
        const iaTriggers = args.triggers ? JSON.stringify(args.triggers) : '[]';
        const iaModifiers = args.modifiers ? JSON.stringify(args.modifiers) : '[]';
        return `import unreal, json
try:
    asset_tools = unreal.AssetToolsHelpers.get_asset_tools()
    factory = None
    for fname in ['InputActionFactory', 'DataAssetFactory']:
        factory = getattr(unreal, fname, None)
        if factory:
            factory = factory()
            break
    ia = asset_tools.create_asset('${iaName}', '${iaPath}', unreal.InputAction, factory)
    if not ia:
        ia = unreal.InputAction(name='${iaName}')
        if not ia:
            print(json.dumps({"success": False, "error": "Failed to create InputAction. Is Enhanced Input plugin enabled?"}))
        else:
            unreal.EditorAssetLibrary.save_asset('${iaPath}/${iaName}', False)
    if ia:
        vt_map = {
            'boolean': 0, 'bool': 0,
            'axis1d': 1, 'float': 1,
            'axis2d': 2, 'vector2d': 2,
            'axis3d': 3, 'vector': 3,
        }
        vt_key = '${iaValueType}'.lower()
        vt_idx = vt_map.get(vt_key, 0)
        try:
            vt_enum = unreal.InputActionValueType(vt_idx)
            ia.set_editor_property('ValueType', vt_enum)
        except:
            pass
        triggers = ${iaTriggers}
        if triggers:
            trigger_list = []
            trigger_map = {
                'down': 'InputTriggerDown',
                'pressed': 'InputTriggerPressed',
                'released': 'InputTriggerReleased',
                'hold': 'InputTriggerHold',
                'holdandrelease': 'InputTriggerHoldAndRelease',
                'tap': 'InputTriggerTap',
                'pulse': 'InputTriggerPulse',
            }
            for t in triggers:
                cls_name = trigger_map.get(t.lower(), t)
                cls = getattr(unreal, cls_name, None)
                if cls:
                    trigger_list.append(cls())
            if trigger_list:
                ia.set_editor_property('Triggers', trigger_list)
        modifiers = ${iaModifiers}
        if modifiers:
            mod_list = []
            mod_map = {
                'deadzone': 'InputModifierDeadZone',
                'fovscaling': 'InputModifierFOVScaling',
                'negate': 'InputModifierNegate',
                'scalar': 'InputModifierScalar',
                'scalebydelta': 'InputModifierScaleByDeltaTime',
                'scalebydeltaTime': 'InputModifierScaleByDeltaTime',
                'swizzle': 'InputModifierSwizzleAxis',
                'smooth': 'InputModifierSmooth',
            }
            for m in modifiers:
                cls_name = mod_map.get(m.lower(), m)
                cls = getattr(unreal, cls_name, None)
                if cls:
                    mod_list.append(cls())
            if mod_list:
                ia.set_editor_property('Modifiers', mod_list)
        unreal.EditorAssetLibrary.save_asset(ia.get_path_name(), False)
        print(json.dumps({"success": True, "name": ia.get_name(), "path": ia.get_path_name(), "value_type": '${iaValueType}'}))
except Exception as e:
    print(json.dumps({"success": False, "error": str(e)}))`;
      }

      case 'create_input_mapping_context': {
        const imcName = esc(args.name);
        const imcPath = esc(args.path ?? '/Game/Input');
        return `import unreal, json
try:
    asset_tools = unreal.AssetToolsHelpers.get_asset_tools()
    factory = None
    for fname in ['InputMappingContextFactory', 'DataAssetFactory']:
        factory = getattr(unreal, fname, None)
        if factory:
            factory = factory()
            break
    imc = asset_tools.create_asset('${imcName}', '${imcPath}', unreal.InputMappingContext, factory)
    if not imc:
        print(json.dumps({"success": False, "error": "Failed to create InputMappingContext. Is Enhanced Input plugin enabled?"}))
    else:
        unreal.EditorAssetLibrary.save_asset(imc.get_path_name(), False)
        print(json.dumps({"success": True, "name": imc.get_name(), "path": imc.get_path_name()}))
except Exception as e:
    print(json.dumps({"success": False, "error": str(e)}))`;
      }

      case 'add_input_mapping': {
        const aimCtx = esc(args.context_name);
        const aimAction = esc(args.action_name);
        const aimKey = esc(args.key);
        const aimTriggers = args.triggers ? JSON.stringify(args.triggers) : '[]';
        const aimModifiers = args.modifiers ? JSON.stringify(args.modifiers) : '[]';
        return `import unreal, json
${FIND_ASSET_PY}
try:
    ctx = _find_asset('${aimCtx}')
    if not ctx or not isinstance(ctx, unreal.InputMappingContext):
        print(json.dumps({"success": False, "error": "InputMappingContext not found: ${aimCtx}"}))
    else:
        action = _find_asset('${aimAction}')
        if not action or not isinstance(action, unreal.InputAction):
            print(json.dumps({"success": False, "error": "InputAction not found: ${aimAction}"}))
        else:
            key = unreal.Key('${aimKey}')
            mapping = ctx.map_key(action, key)
            triggers = ${aimTriggers}
            if triggers:
                trigger_map = {
                    'down': 'InputTriggerDown', 'pressed': 'InputTriggerPressed',
                    'released': 'InputTriggerReleased', 'hold': 'InputTriggerHold',
                    'holdandrelease': 'InputTriggerHoldAndRelease', 'tap': 'InputTriggerTap',
                    'pulse': 'InputTriggerPulse',
                }
                tlist = []
                for t in triggers:
                    cls = getattr(unreal, trigger_map.get(t.lower(), t), None)
                    if cls:
                        tlist.append(cls())
                if tlist and hasattr(mapping, 'set_editor_property'):
                    mapping.set_editor_property('Triggers', tlist)
            modifiers = ${aimModifiers}
            if modifiers:
                mod_map = {
                    'deadzone': 'InputModifierDeadZone', 'negate': 'InputModifierNegate',
                    'scalar': 'InputModifierScalar', 'swizzle': 'InputModifierSwizzleAxis',
                    'smooth': 'InputModifierSmooth',
                }
                mlist = []
                for m in modifiers:
                    cls = getattr(unreal, mod_map.get(m.lower(), m), None)
                    if cls:
                        mlist.append(cls())
                if mlist and hasattr(mapping, 'set_editor_property'):
                    mapping.set_editor_property('Modifiers', mlist)
            unreal.EditorAssetLibrary.save_asset(ctx.get_path_name(), False)
            print(json.dumps({"success": True, "context": ctx.get_name(), "action": action.get_name(), "key": '${aimKey}'}))
except Exception as e:
    print(json.dumps({"success": False, "error": str(e)}))`;
      }

      // ===== Widget Blueprint tools =====

      case 'edit_widget_blueprint': {
        const wbpName = esc(args.blueprint_name);
        const wAction = esc(args.action);
        const wClass = args.widget_class ? `'${esc(args.widget_class)}'` : 'None';
        const wName = args.widget_name ? `'${esc(args.widget_name)}'` : 'None';
        const wParent = args.parent_name ? `'${esc(args.parent_name)}'` : 'None';
        const wPropName = args.property_name ? `'${esc(args.property_name)}'` : 'None';
        const wPropValue = args.property_value !== undefined ? JSON.stringify(args.property_value) : 'None';
        return `import unreal, json
${FIND_ASSET_PY}
try:
    asset = _find_asset('${wbpName}')
    if not asset:
        for prefix in ['/Game/UI/', '/Game/Blueprints/', '/Game/']:
            try:
                asset = unreal.EditorAssetLibrary.load_asset(prefix + '${wbpName}')
                if asset:
                    break
            except:
                pass
    if not asset:
        print(json.dumps({"success": False, "error": "Widget Blueprint not found: ${wbpName}"}))
    else:
        wt = asset.widget_tree if hasattr(asset, 'widget_tree') else None
        if not wt:
            print(json.dumps({"success": False, "error": "Asset is not a Widget Blueprint or has no widget tree"}))
        else:
            action = '${wAction}'
            if action == 'list_widgets':
                widgets = []
                root = wt.root_widget
                def _walk(w, depth=0):
                    if w:
                        info = {"name": w.get_name(), "class": w.get_class().get_name(), "depth": depth}
                        widgets.append(info)
                        if hasattr(w, 'get_all_children'):
                            for child in w.get_all_children():
                                _walk(child, depth + 1)
                _walk(root)
                print(json.dumps({"success": True, "widgets": widgets, "count": len(widgets)}))
            elif action == 'add_widget':
                wc_name = ${wClass}
                wn = ${wName}
                wp = ${wParent}
                if not wc_name:
                    print(json.dumps({"success": False, "error": "widget_class is required for add_widget"}))
                else:
                    widget_cls = getattr(unreal, wc_name, None)
                    if not widget_cls:
                        for mod in ['UMG', 'SlateCore', 'Slate']:
                            try:
                                widget_cls = unreal.load_class(None, '/Script/' + mod + '.' + wc_name)
                                if widget_cls:
                                    break
                            except:
                                pass
                    if not widget_cls:
                        print(json.dumps({"success": False, "error": "Widget class not found: " + wc_name}))
                    else:
                        new_widget = wt.construct_widget(widget_cls, wn or wc_name)
                        if not new_widget:
                            print(json.dumps({"success": False, "error": "construct_widget returned None"}))
                        else:
                            parent_widget = None
                            if wp:
                                parent_widget = wt.find_widget(wp)
                            if not parent_widget:
                                parent_widget = wt.root_widget
                            if parent_widget and hasattr(parent_widget, 'add_child'):
                                parent_widget.add_child(new_widget)
                            elif not wt.root_widget:
                                wt.set_editor_property('RootWidget', new_widget)
                            unreal.EditorAssetLibrary.save_asset(asset.get_path_name(), False)
                            print(json.dumps({"success": True, "widget": new_widget.get_name(), "class": new_widget.get_class().get_name()}))
            elif action == 'remove_widget':
                wn = ${wName}
                if not wn:
                    print(json.dumps({"success": False, "error": "widget_name is required for remove_widget"}))
                else:
                    w = wt.find_widget(wn)
                    if not w:
                        print(json.dumps({"success": False, "error": "Widget not found: " + wn}))
                    else:
                        wt.remove_widget(w)
                        unreal.EditorAssetLibrary.save_asset(asset.get_path_name(), False)
                        print(json.dumps({"success": True, "removed": wn}))
            elif action == 'set_widget_property':
                wn = ${wName}
                pn = ${wPropName}
                pv = ${wPropValue}
                if not wn or not pn:
                    print(json.dumps({"success": False, "error": "widget_name and property_name required"}))
                else:
                    w = wt.find_widget(wn)
                    if not w:
                        print(json.dumps({"success": False, "error": "Widget not found: " + wn}))
                    else:
                        w.set_editor_property(pn, pv)
                        unreal.EditorAssetLibrary.save_asset(asset.get_path_name(), False)
                        print(json.dumps({"success": True, "widget": wn, "property": pn}))
            else:
                print(json.dumps({"success": False, "error": "Unknown action: " + action + ". Use add_widget, remove_widget, set_widget_property, or list_widgets."}))
except Exception as e:
    print(json.dumps({"success": False, "error": str(e)}))`;
      }

      // ===== Blueprint structure tools =====

      case 'add_blueprint_function': {
        const bfBp = esc(args.blueprint_name);
        const bfName = esc(args.function_name);
        return `import unreal, json
${FIND_BP_PY}
try:
    bp = _find_bp('${bfBp}')
    if not bp:
        print(json.dumps({"success": False, "error": "Blueprint not found: ${bfBp}"}))
    else:
        success = False
        try:
            success = unreal.BlueprintEditorLibrary.add_function(bp, '${bfName}')
        except AttributeError:
            graph = unreal.EdGraphSchema_K2.create_function_graph(bp, '${bfName}', 0, '', None) if hasattr(unreal, 'EdGraphSchema_K2') else None
            success = graph is not None
        if success:
            unreal.BlueprintEditorLibrary.compile_blueprint(bp)
            unreal.EditorAssetLibrary.save_asset(bp.get_path_name(), False)
            print(json.dumps({"success": True, "blueprint": '${bfBp}', "function": '${bfName}'}))
        else:
            print(json.dumps({"success": False, "error": "Failed to add function. This may require UE 5.4+."}))
except Exception as e:
    print(json.dumps({"success": False, "error": str(e)}))`;
      }

      case 'remove_blueprint_function': {
        const rfBp = esc(args.blueprint_name);
        const rfName = esc(args.function_name);
        return `import unreal, json
${FIND_BP_PY}
try:
    bp = _find_bp('${rfBp}')
    if not bp:
        print(json.dumps({"success": False, "error": "Blueprint not found: ${rfBp}"}))
    else:
        removed = False
        try:
            removed = unreal.BlueprintEditorLibrary.remove_function(bp, '${rfName}')
        except AttributeError:
            for g in bp.function_graphs:
                if str(g.get_name()) == '${rfName}':
                    bp.function_graphs.remove(g)
                    removed = True
                    break
        if removed:
            unreal.BlueprintEditorLibrary.compile_blueprint(bp)
            unreal.EditorAssetLibrary.save_asset(bp.get_path_name(), False)
            print(json.dumps({"success": True, "blueprint": '${rfBp}', "removed_function": '${rfName}'}))
        else:
            print(json.dumps({"success": False, "error": "Function not found or removal failed: ${rfName}"}))
except Exception as e:
    print(json.dumps({"success": False, "error": str(e)}))`;
      }

      case 'add_blueprint_interface': {
        const aiBp = esc(args.blueprint_name);
        const aiIface = esc(args.interface_name);
        return `import unreal, json
${FIND_BP_PY}
try:
    bp = _find_bp('${aiBp}')
    if not bp:
        print(json.dumps({"success": False, "error": "Blueprint not found: ${aiBp}"}))
    else:
        iface_cls = None
        for prefix in ['', '/Script/Engine.', '/Script/UMG.', '/Game/Interfaces/', '/Game/']:
            try:
                if prefix:
                    iface_cls = unreal.load_class(None, prefix + '${aiIface}')
                else:
                    iface_cls = getattr(unreal, '${aiIface}', None)
                if iface_cls:
                    break
            except:
                pass
        if not iface_cls:
            iface_asset = None
            for p in ['/Game/Interfaces/', '/Game/Blueprints/', '/Game/']:
                try:
                    iface_asset = unreal.EditorAssetLibrary.load_asset(p + '${aiIface}')
                    if iface_asset:
                        break
                except:
                    pass
            if iface_asset and hasattr(iface_asset, 'generated_class'):
                iface_cls = iface_asset.generated_class
        if not iface_cls:
            print(json.dumps({"success": False, "error": "Interface not found: ${aiIface}"}))
        else:
            added = False
            try:
                added = unreal.BlueprintEditorLibrary.add_interface(bp, iface_cls)
            except:
                try:
                    ispec = unreal.BlueprintInterfaceSpec()
                    ispec.set_editor_property('Interface', iface_cls)
                    interfaces = list(bp.get_editor_property('ImplementedInterfaces'))
                    interfaces.append(ispec)
                    bp.set_editor_property('ImplementedInterfaces', interfaces)
                    added = True
                except:
                    pass
            if added:
                unreal.BlueprintEditorLibrary.compile_blueprint(bp)
                unreal.EditorAssetLibrary.save_asset(bp.get_path_name(), False)
                print(json.dumps({"success": True, "blueprint": '${aiBp}', "interface": '${aiIface}'}))
            else:
                print(json.dumps({"success": False, "error": "Failed to add interface ${aiIface}"}))
except Exception as e:
    print(json.dumps({"success": False, "error": str(e)}))`;
      }

      case 'remove_blueprint_interface': {
        const riBp = esc(args.blueprint_name);
        const riIface = esc(args.interface_name);
        return `import unreal, json
${FIND_BP_PY}
try:
    bp = _find_bp('${riBp}')
    if not bp:
        print(json.dumps({"success": False, "error": "Blueprint not found: ${riBp}"}))
    else:
        removed = False
        try:
            removed = unreal.BlueprintEditorLibrary.remove_interface(bp, '${riIface}')
        except:
            pass
        if not removed:
            try:
                interfaces = list(bp.get_editor_property('ImplementedInterfaces'))
                new_ifaces = [i for i in interfaces if '${riIface}' not in str(i)]
                if len(new_ifaces) < len(interfaces):
                    bp.set_editor_property('ImplementedInterfaces', new_ifaces)
                    removed = True
            except:
                pass
        if removed:
            unreal.BlueprintEditorLibrary.compile_blueprint(bp)
            unreal.EditorAssetLibrary.save_asset(bp.get_path_name(), False)
            print(json.dumps({"success": True, "blueprint": '${riBp}', "removed_interface": '${riIface}'}))
        else:
            print(json.dumps({"success": False, "error": "Interface not found or removal failed: ${riIface}"}))
except Exception as e:
    print(json.dumps({"success": False, "error": str(e)}))`;
      }

      case 'reparent_blueprint': {
        const rpBp = esc(args.blueprint_name);
        const rpParent = esc(args.new_parent_class);
        return `import unreal, json
${FIND_BP_PY}
try:
    bp = _find_bp('${rpBp}')
    if not bp:
        print(json.dumps({"success": False, "error": "Blueprint not found: ${rpBp}"}))
    else:
        new_parent = getattr(unreal, '${rpParent}', None)
        if not new_parent:
            for mod in ['/Script/Engine.', '/Script/GameplayAbilities.', '/Script/AIModule.']:
                try:
                    new_parent = unreal.load_class(None, mod + '${rpParent}')
                    if new_parent:
                        break
                except:
                    pass
        if not new_parent:
            print(json.dumps({"success": False, "error": "Parent class not found: ${rpParent}"}))
        else:
            try:
                unreal.BlueprintEditorLibrary.reparent_blueprint(bp, new_parent)
            except:
                bp.set_editor_property('ParentClass', new_parent)
            unreal.BlueprintEditorLibrary.compile_blueprint(bp)
            unreal.EditorAssetLibrary.save_asset(bp.get_path_name(), False)
            print(json.dumps({"success": True, "blueprint": '${rpBp}', "new_parent": '${rpParent}'}))
except Exception as e:
    print(json.dumps({"success": False, "error": str(e)}))`;
      }

      // ===== Asset exploration =====

      case 'explore_assets': {
        const eaPath = esc(args.search_path ?? '/Game');
        const eaClass = args.class_filter ? `'${esc(args.class_filter)}'` : 'None';
        const eaParent = args.parent_class ? `'${esc(args.parent_class)}'` : 'None';
        const eaName = args.name_filter ? `'${esc(args.name_filter)}'` : 'None';
        const eaComp = args.has_component ? `'${esc(args.has_component)}'` : 'None';
        const eaIface = args.implements_interface ? `'${esc(args.implements_interface)}'` : 'None';
        const eaMax = args.max_results ?? 50;
        return `import unreal, json
try:
    ar = unreal.AssetRegistryHelpers.get_asset_registry()
    all_assets = ar.get_assets_by_path('${eaPath}', recursive=True)
    class_filter = ${eaClass}
    parent_class = ${eaParent}
    name_filter = ${eaName}
    has_comp = ${eaComp}
    has_iface = ${eaIface}
    max_results = ${eaMax}
    results = []
    for ad in all_assets:
        if len(results) >= max_results:
            break
        aname = str(ad.asset_name)
        aclass = str(ad.asset_class) if hasattr(ad, 'asset_class') else ''
        if not aclass:
            try:
                aclass = str(ad.asset_class_path.asset_name) if hasattr(ad, 'asset_class_path') else ''
            except:
                pass
        if name_filter and name_filter.lower() not in aname.lower():
            continue
        if class_filter and class_filter.lower() not in aclass.lower():
            if class_filter.lower() == 'blueprint' and 'blueprint' not in aclass.lower():
                continue
            elif class_filter.lower() != 'blueprint' and class_filter.lower() != aclass.lower():
                continue
        info = {"name": aname, "path": str(ad.package_name), "class": aclass}
        if parent_class or has_comp or has_iface:
            if 'blueprint' not in aclass.lower():
                continue
            try:
                obj = unreal.EditorAssetLibrary.load_asset(str(ad.package_name))
                if not obj or not isinstance(obj, unreal.Blueprint):
                    continue
                if parent_class:
                    pc = obj.parent_class if hasattr(obj, 'parent_class') else (obj.generated_class.get_super_class() if obj.generated_class else None)
                    if pc and parent_class.lower() not in str(pc.get_name()).lower():
                        continue
                if has_comp:
                    scs = obj.simple_construction_script
                    found_comp = False
                    if scs:
                        for node in scs.get_all_nodes():
                            tpl = node.component_template
                            if tpl and has_comp.lower() in tpl.get_class().get_name().lower():
                                found_comp = True
                                break
                    if not found_comp:
                        continue
                if has_iface:
                    ifaces = obj.get_editor_property('ImplementedInterfaces') if hasattr(obj, 'get_editor_property') else []
                    found_iface = False
                    for i in ifaces:
                        if has_iface.lower() in str(i).lower():
                            found_iface = True
                            break
                    if not found_iface:
                        continue
                info["parent_class"] = str(pc.get_name()) if pc else "unknown"
            except:
                continue
        results.append(info)
    print(json.dumps({"success": True, "results": results, "count": len(results), "search_path": '${eaPath}'}))
except Exception as e:
    print(json.dumps({"success": False, "error": str(e)}))`;
      }

      default:
        throw new Error(`Unknown tool: ${toolName}`);
    }
  }
}
