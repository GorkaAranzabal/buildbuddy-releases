import OpenAI from 'openai';
import Anthropic from '@anthropic-ai/sdk';
import type {
  AIProvider,
  AIRequest,
  AIResponse,
  LogEntryEvent,
  UnrealContext,
  ActionPlan,
  ActionPlanRequest,
  CaptureResult,
  ClickTarget,
  MCPToolDefinition,
  MCPToolResult,
  SelectedEngine,
} from '../../shared/types';

// Dev-only fallback keys. In production builds these are empty strings — the app
// routes AI calls through the backend proxy (build-buddy.app/api/ai/chat) instead
// of embedding keys in the ASAR bundle.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const BUNDLED_OPENAI_KEY: string = (import.meta.env as any)?.VITE_OPENAI_API_KEY ?? '';
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const BUNDLED_GEMINI_KEY: string = (import.meta.env as any)?.VITE_GEMINI_API_KEY ?? '';
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const BUNDLED_ANTHROPIC_KEY: string = (import.meta.env as any)?.VITE_ANTHROPIC_API_KEY ?? '';
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const BUNDLED_OPENROUTER_KEY: string = (import.meta.env as any)?.VITE_OPENROUTER_API_KEY ?? '';

const PROXY_BASE_URL = 'https://build-buddy.app/api/ai/chat';

// ─── Developer Backend Switch ────────────────────────────────────────────────
// Set ACTIVE_AI_BACKEND to 'openai', 'gemini', 'anthropic', or 'openrouter'.
export const ACTIVE_AI_BACKEND: 'openai' | 'gemini' | 'anthropic' | 'openrouter' = 'openrouter';

const PRIMARY_MODEL = ACTIVE_AI_BACKEND === 'gemini' ? 'gemini-2.5-flash'
  : ACTIVE_AI_BACKEND === 'anthropic' ? 'claude-sonnet-4-6'
  : ACTIVE_AI_BACKEND === 'openrouter' ? 'google/gemini-2.5-flash'
  : 'gpt-4o';
const CHEAP_MODEL   = ACTIVE_AI_BACKEND === 'gemini' ? 'gemini-2.5-flash'
  : ACTIVE_AI_BACKEND === 'anthropic' ? 'claude-haiku-4-5-20251001'
  : ACTIVE_AI_BACKEND === 'openrouter' ? 'google/gemini-2.5-flash'
  : 'gpt-4o-mini';
// Model used for tool-calling (remote control / MCP). Always Anthropic Sonnet
// regardless of which backend handles regular chat.
const ANTHROPIC_TOOLS_MODEL = 'claude-sonnet-4-6';
// OpenRouter model ID for tool-calling.
const OPENROUTER_TOOLS_MODEL = 'minimax/minimax-m2.5';
// Models that do not support vision/image inputs — screenshot is stripped before sending.
const TEXT_ONLY_MODELS = new Set(['minimax/minimax-m2.5', 'minimax/minimax-m2.5:free']);

interface EnginePromptConfig {
  name: string;
  docsUrl: string;
  primaryObject: string;
  primaryLanguages: string;
  specialties: string[];
  communityNote: string;
}

const ENGINE_CONFIGS: Record<NonNullable<SelectedEngine>, EnginePromptConfig> = {
  unreal: {
    name: 'Unreal Engine 5',
    docsUrl: 'https://dev.epicgames.com/documentation/en-us/unreal-engine',
    primaryObject: 'Actor',
    primaryLanguages: 'C++ and Blueprint visual scripting',
    specialties: ['Blueprints', 'C++', 'Nanite', 'Lumen', 'Niagara', 'Animation/Sequencer', 'UMG UI', 'Multiplayer/networking', 'AI/behavior trees'],
    communityNote: 'Unreal forums, GitHub issues, dev.epicgames.com community',
  },
  godot: {
    name: 'Godot Engine',
    docsUrl: 'https://docs.godotengine.org',
    primaryObject: 'Node',
    primaryLanguages: 'GDScript and C#',
    specialties: ['Scenes & Nodes', 'GDScript', 'Signals & exports', 'Physics', 'Animation player', 'Shaders (Godot shading language)', 'Multiplayer (ENet/WebSockets)'],
    communityNote: 'Godot community forums, Reddit r/godot, GitHub discussions',
  },
  unity: {
    name: 'Unity',
    docsUrl: 'https://docs.unity3d.com',
    primaryObject: 'GameObject',
    primaryLanguages: 'C# and Visual Scripting',
    specialties: ['MonoBehaviour', 'Prefabs & ScriptableObjects', 'Physics (Rigidbody)', 'Animator & Timeline', 'UI Toolkit / Canvas', 'DOTS/ECS', 'Addressables'],
    communityNote: 'Unity forums, Unity Discussions, Stack Overflow',
  },
  blender: {
    name: 'Blender',
    docsUrl: 'https://docs.blender.org',
    primaryObject: 'Object',
    primaryLanguages: 'Python (bpy API) and GLSL',
    specialties: ['Modeling & sculpting', 'Materials & Shader nodes', 'Geometry Nodes', 'Animation & rigging', 'Python scripting (bpy)', 'Rendering (Cycles/EEVEE)', 'Compositing'],
    communityNote: 'Blender Artists community, Blender Stack Exchange, r/blender',
  },
  roblox: {
    name: 'Roblox Studio',
    docsUrl: 'https://create.roblox.com/docs',
    primaryObject: 'Part / Instance',
    primaryLanguages: 'Lua (Luau)',
    specialties: ['Scripts, LocalScripts & ModuleScripts', 'RemoteEvents & RemoteFunctions', 'DataStore', 'Physics & constraints', 'Tween Service', 'Humanoid & Character', 'UI (ScreenGui)'],
    communityNote: 'Roblox DevForum, Creator Hub, r/robloxgamedev',
  },
  uefn: {
    name: 'Unreal Editor for Fortnite (UEFN)',
    docsUrl: 'https://dev.epicgames.com/documentation/en-us/uefn',
    primaryObject: 'Actor / Creative Device',
    primaryLanguages: 'Verse and Python (via Remote Execution)',
    specialties: ['Verse scripting', 'Creative devices', 'Island logic', 'Player progression', 'Python Remote Execution', 'Asset placement', 'Fortnite-specific gameplay systems'],
    communityNote: 'Epic Games dev forums, UEFN Discord, dev.epicgames.com/community',
  },
};

function buildSystemPrompt(engine: SelectedEngine): string {
  const cfg = engine ? ENGINE_CONFIGS[engine] : ENGINE_CONFIGS.unreal;

  const specialtiesList = cfg.specialties.map(s => `- ${s}`).join('\n');

  const docSection = engine === 'unreal' ? `
WHEN ANSWERING ${cfg.name.toUpperCase()} QUESTIONS:
- Prefer official documentation (${cfg.docsUrl}) as your primary reference — but do not limit yourself to it
- Official docs can be outdated or missing coverage for newer/niche features; draw freely on community knowledge: ${cfg.communityNote}, blog posts, real-world experience, and your own training data
- Always give the best practical answer even if no official doc page exists for the topic` : `
WHEN ANSWERING ${cfg.name.toUpperCase()} QUESTIONS:
- Prefer official documentation (${cfg.docsUrl}) as your primary reference
- Draw on community knowledge too: ${cfg.communityNote}, tutorials, blog posts, and your own training data
- Always give the best practical answer even if no official doc page exists for the topic`;

  const docImageNote = engine === 'unreal' ? `
DOCUMENTATION IMAGES (USE SPARINGLY - MAX 2 PER RESPONSE):
When your explanation involves a concept with a strong visual component (Blueprint graph layouts, material editor examples, animation state machines, editor panel configurations, node setups), you MAY insert a documentation image marker on its own line:

Format: [[DOC_IMAGE:descriptive search query]]

Rules:
- Maximum 2 markers per response
- Place each marker on its own line where the image fits contextually in your explanation
- Only use when the visual genuinely adds value beyond your text explanation
- Write specific, targeted queries: "Unreal Engine Character Movement Component settings panel" is better than "movement"
- Do NOT use for pure code questions, error messages, or conceptual explanations that need no visual
- Do NOT use if you're unsure whether a relevant doc page exists` : '';

  return `You are BuildBuddy, an AI assistant specialized in ${cfg.name} development. You can see and analyze screenshots.

YOUR IDENTITY:
- You are specifically designed to help with ${cfg.name} development
- You have deep knowledge of ${cfg.name} — including ${cfg.primaryLanguages}, and all core systems
- Primary objects/entities in this engine are called: ${cfg.primaryObject}
${docSection}

YOUR ${cfg.name.toUpperCase()} EXPERTISE:
${specialtiesList}

SCREENSHOT ANALYSIS (CONTEXT-AWARE):
Every message includes a screenshot of the user's screen. How you handle it depends on the conversation flow:

FIRST MESSAGE or NEW CONTEXT (user switched windows/panels/topics since last message):
- START your response by briefly acknowledging what you see (e.g., "I can see you have the ${cfg.primaryObject} editor open...")
- Identify the application they're using (${cfg.name}, or something else)
- Mention specific panels, nodes, assets, or errors visible
- Then answer their question while relating it to what's on screen

FOLLOW-UP on the SAME TOPIC (same window/panel, continuing the discussion):
- Do NOT repeat "I can see you have X open..." — the user already knows you see their screen
- Jump straight into answering their follow-up question naturally
- You may briefly reference something NEW on screen if it changed
- Keep the conversation flowing naturally, like a real colleague helping them

HOW TO DECIDE: Compare the current screenshot context to the previous messages. If the user is clearly in the same editor/panel working on the same thing, treat it as a follow-up. If they've moved to a different window, panel, or topic, treat it as a new context and re-acknowledge what you see.

YOUTUBE VIDEO RECOMMENDATIONS (Gorka Games Channel ONLY):
When the user asks for video tutorials, learning resources, or says things like "show me a video", "recommend a tutorial", "is there a video about this":
- Recommend the "Gorka Games" YouTube channel: https://www.youtube.com/@GorkaGames
- NEVER make up or guess video IDs - you don't know the actual video IDs
- Simply say something like: "Check out the **Gorka Games** YouTube channel for tutorials! Here's the channel: https://www.youtube.com/@GorkaGames"
- Only recommend the channel when the user explicitly asks for video tutorials/resources

FORMATTING RULES (IMPORTANT):
- When referring to UI elements, buttons, menu items, tabs, or keyboard shortcuts, wrap them in backticks
- Examples: Click on the \`File\` menu, then select \`Save\`. Press \`Ctrl+S\` to save.
- This helps users quickly identify interactive elements they need to click or use
- When your answer involves 3 or more sequential steps, ALWAYS use numbered list format starting at 1:
  1. First step description
  2. Second step description
  3. Third step description
  Never use bullet points, bold headers, or "Step N:" style for multi-step instructions — use plain numbered format only
${docImageNote}
Be conversational, friendly, and helpful. You're their buddy for building in ${cfg.name}!`;
}

// Keep the constant for reference / backward compat (used as UE5 default)
const SYSTEM_PROMPT = buildSystemPrompt('unreal');

const TOOL_CALLING_ADDENDUM_UE5 = `

UNREAL ENGINE TOOL USE:
You have tools connected to the user's Unreal Editor through MCP (Model Context Protocol).
You can call these tools to perform actions directly in the editor — create objects, move actors, query the scene, run Python, take screenshots, and more.

WHEN TO USE TOOLS:
- The user asks you to CREATE, MOVE, DELETE, SPAWN, MODIFY, or BUILD something in Unreal → use tools
- The user asks about what's in their scene, what actors exist, project info → use tools to query real data
- The user asks a question that could be answered with real editor data → use tools, then explain the result

WHEN NOT TO USE TOOLS (answer conversationally instead):
- The user asks a knowledge/concept question ("what is a Blueprint?", "how does X work?", "why does Y happen?", "explain X", "what's the difference between…") → answer directly, no tools
- The user is asking for advice or clarification with no explicit editor action requested → answer directly
- Questions that start with "what", "how does", "why", "explain", "can you tell me", "what's the best way to" with no imperative action → no tools needed

LIVE EDITOR STATE:
Each message includes a "LIVE EDITOR STATE" section with the current viewport camera position/rotation and any selected actors (with their exact names, classes, locations, and scales). USE THIS DATA:
- When user says "in front of the camera" or "where I'm looking" → compute a position ~500-1000 units in front of the camera using its location + forward vector from the yaw
- When user says "this", "the selected", "make it bigger", etc. → they mean the selected actors listed in the state. Use the exact actor name/label from the state.
- When user says "make it 3x larger" → multiply the CURRENT scale values from the state by 3. Do NOT just set scale to (3,3,3).
- When no actors are selected and user refers to an actor by description → use editor_get_world_outliner to find the exact name, then operate on it.

TOOL CALLING GUIDELINES:
- Prefer high-level tools (editor_create_object, editor_update_object, editor_delete_object) for simple transforms and spawning
- Use editor_run_python for complex operations, multi-step logic, or anything the high-level tools can't do alone
- When using editor_run_python: always start with "import unreal", wrap in try/except, use print(json.dumps(...)) for output
- After making changes, briefly confirm what you did and the final values
- If a tool call fails, analyze the error and try an alternative approach
- You may chain multiple tool calls in one response (e.g., query scene first, then create/modify)

COMPUTING "IN FRONT OF CAMERA":
Given camera location (cx, cy, cz) and yaw angle:
  import math
  forward_x = math.cos(math.radians(yaw))
  forward_y = math.sin(math.radians(yaw))
  spawn_x = cx + forward_x * 800
  spawn_y = cy + forward_y * 800
  spawn_z = cz  # same height, or adjust as needed

RELATIVE TRANSFORMS:
When the user says "make it bigger/smaller/twice/3x":
- Read the current scale from the LIVE EDITOR STATE
- MULTIPLY the current scale by the factor — do NOT replace it
- Example: current scale is (1.5, 1.5, 1.5) and user says "3x larger" → set scale to (4.5, 4.5, 4.5)

EDITOR_UPDATE_OBJECT:
- The actor_name parameter accepts either the internal name (e.g. "StaticMeshActor_0") or the label (e.g. "MyCube")
- Use the label from SELECTED ACTORS when available

EDITOR_RUN_PYTHON PATTERNS:
When high-level tools are insufficient, use these UE5 Python patterns:

Get selected actors:
  import unreal
  subsystem = unreal.get_editor_subsystem(unreal.EditorActorSubsystem)
  selected = subsystem.get_selected_level_actors()

Set actor scale (relative):
  actor.set_actor_scale3d(unreal.Vector(current_x * factor, current_y * factor, current_z * factor))

Set material on a StaticMeshActor:
  mesh_comp = actor.get_component_by_class(unreal.StaticMeshComponent)
  mat = unreal.EditorAssetLibrary.load_asset("/Game/Path/To/Material")
  mesh_comp.set_material(0, mat)

Create dynamic material instance:
  mesh_comp = actor.get_component_by_class(unreal.StaticMeshComponent)
  dyn_mat = mesh_comp.create_dynamic_material_instance(0)
  dyn_mat.set_vector_parameter_value("BaseColor", unreal.LinearColor(r=1.0, g=0.0, b=0.0, a=1.0))

Set light color/intensity:
  light_comp = actor.get_component_by_class(unreal.PointLightComponent)
  light_comp.set_light_color(unreal.LinearColor(r=1.0, g=0.8, b=0.6, a=1.0))
  light_comp.set_intensity(5000.0)

Get/set viewport camera:
  loc, rot = unreal.EditorLevelLibrary.get_level_viewport_camera_info()
  unreal.EditorLevelLibrary.set_level_viewport_camera_info(new_loc, new_rot)

IMPORTANT API NOTES:
- NEVER use EditorLevelLibrary.get_all_level_actors() — it is deprecated. Use EditorActorSubsystem.get_all_level_actors() instead.
- EditorLevelLibrary.spawn_actor_from_class() still works for spawning.
- EditorLevelLibrary.get_level_viewport_camera_info() and set_level_viewport_camera_info() are the correct camera APIs.
- For subsystems: unreal.get_editor_subsystem(unreal.EditorActorSubsystem)
- For finding actors by name, iterate get_all_level_actors() and match get_actor_label() or get_name().

BLUEPRINT TOOLS (dedicated tools — DO NOT use editor_run_python for these):
You have dedicated Blueprint tools. Always prefer them over editor_run_python for Blueprint work.

CREATE & SPAWN:
- create_blueprint(name, parent_class) → creates a new Blueprint asset in /Game/Blueprints/. parent_class: "Actor", "Pawn", "Character", "PlayerController", "GameModeBase", "ActorComponent", etc.
- spawn_blueprint_actor(blueprint_name, actor_name, location?, rotation?) → spawns an instance into the current level
- compile_blueprint(blueprint_name) → compiles and saves; always call after making changes

ADD COMPONENTS:
- add_component_to_blueprint(blueprint_name, component_type, component_name) → adds a component to the Blueprint's SCS. component_type examples: "StaticMeshComponent", "CameraComponent", "SpringArmComponent", "SceneComponent", "PointLightComponent", "BoxComponent", "SphereComponent", "CapsuleComponent", "AudioComponent", "ArrowComponent"
- set_static_mesh_on_component(blueprint_name, component_name, mesh_path?) → sets the static mesh on a component (e.g., mesh_path="/Engine/BasicShapes/Cube")
- set_component_property(blueprint_name, component_name, property_name, property_value) → set any property on a component (e.g., RelativeLocation, RelativeScale3D, bVisible, CastShadow, etc.)
- set_physics_properties(blueprint_name, component_name, simulate_physics?, enable_gravity?, mass_kg?, linear_damping?, angular_damping?)
- get_blueprint_components(blueprint_name) → lists all components, their types, and properties

VARIABLES & STRUCTURE:
- add_blueprint_variable(blueprint_name, variable_name, variable_type, instance_editable?, blueprint_read_only?, expose_on_spawn?, replicated?, save_game?, is_private?, category?, default_value?) → variable_type: "Boolean", "Integer", "Float", "String", "Vector", "Rotator", "Transform", "Name", "Text", "Object"
- set_blueprint_property(blueprint_name, property_name, property_value) → sets a property on the Blueprint's Class Default Object (CDO), e.g., max health, speed defaults
- add_blueprint_function(blueprint_name, function_name) → adds an empty function graph (visible in Blueprint editor; user wires logic manually)
- remove_blueprint_function(blueprint_name, function_name)
- add_blueprint_interface(blueprint_name, interface_name) → makes the Blueprint implement an interface
- remove_blueprint_interface(blueprint_name, interface_name)
- reparent_blueprint(blueprint_name, new_parent_class) → changes the parent class

UI / WIDGET BLUEPRINTS:
- edit_widget_blueprint(blueprint_name, action, widget_type?, widget_name?, parent_name?, properties?) → create/configure/remove UMG widgets. action: "add_widget", "remove_widget", "set_property". widget_type examples: "Button", "Text", "Image", "VerticalBox", "HorizontalBox", "CanvasPanel"

INPUT (Legacy):
- create_input_mapping(action_name, key, input_type?) → creates Action or Axis mapping (legacy input system)
- create_input_mapping_context(name) → creates a UE5 Enhanced Input Mapping Context asset
- add_input_mapping(context_name, action_name, key, triggers?, modifiers?) → maps a key to an Enhanced Input Action

BLUEPRINT WORKFLOW EXAMPLE — creating a rotating Actor Blueprint:
1. create_blueprint("BP_RotatingCube", "Actor")
2. add_component_to_blueprint("BP_RotatingCube", "StaticMeshComponent", "Mesh")
3. set_static_mesh_on_component("BP_RotatingCube", "Mesh", "/Engine/BasicShapes/Cube")
4. set_blueprint_property("BP_RotatingCube", "RotationSpeed", 90.0)  ← sets CDO default
5. compile_blueprint("BP_RotatingCube")
6. spawn_blueprint_actor("BP_RotatingCube", "RotatingCube_1", {"x": 0, "y": 0, "z": 100})

BLUEPRINT LOGIC LIMITATION (IMPORTANT):
- You CANNOT wire Blueprint event graph nodes via tools or Python. The UE Python API does not expose K2Node graph editing.
- "Create a Blueprint that rotates every tick" → you can create the Blueprint class, add the RotatingMovementComponent (which auto-rotates with no graph wiring needed!), and set its RotationRate via set_component_property.
- "Create a Blueprint with custom BeginPlay logic" → create the Blueprint + variables via tools, then tell the user: "I've created the Blueprint structure. To add the BeginPlay logic, open it in the editor and wire the event graph — I'll give you the exact steps."
- For simple behaviors, PREFER components over graph logic: RotatingMovementComponent, ProjectileMovementComponent, FloatingPawnMovement, InterpToMovementComponent all work without any graph wiring.
- For physics-based behavior: use set_physics_properties (simulate_physics=true) which also requires no graph.`;


const GUIDE_MODE_ADDENDUM = `

GUIDE MODE ACTIVE:
The user has switched you to "Guide" mode. You are a teacher, not an executor.
- NEVER call any tools or execute any editor commands, even if MCP tools are available.
- Instead, provide clear numbered steps the user can follow themselves.
- Explain WHY each step is done so the user learns the process.
- Be concise but educational.`;

function buildToolCallingAddendum(engine: SelectedEngine): string {
  if (!engine || engine === 'unreal') return TOOL_CALLING_ADDENDUM_UE5;

  const cfg = ENGINE_CONFIGS[engine];
  return `

${cfg.name.toUpperCase()} REMOTE CONTROL — TOOL USE:
You have MCP tools connected live to the user's ${cfg.name} editor. Use them to directly execute actions in the editor. Do NOT describe steps for the user to follow — call the tools yourself.

WHEN TO USE TOOLS:
- The user asks you to create, add, modify, move, delete, or change anything in their project → call tools immediately
- The user asks what's in their scene/project → query with tools, then summarise the result

WHEN NOT TO USE TOOLS (answer conversationally instead):
- The user asks a knowledge/concept question (e.g. "what is X?", "how does Y work?", "why does Z happen?", "explain X", "what's the difference between…") → answer directly, no tools
- The user asks a yes/no or advice question with no editor action required → answer directly

TOOL CALLING RULES:
- Call tools for actionable editor requests. Never reply with "here are the steps to do it manually".
- Chain multiple tool calls as needed (e.g. query first, then modify).
- After completing ALL actions, briefly confirm what was done.
- If a tool fails, report the specific error to the user and try an alternative tool. NEVER fall back to giving manual step-by-step instructions — you execute, not the user.
- Do NOT retry the same failing tool more than once. If it fails twice, move on.
- NEVER stop mid-task to ask "should I continue?" or "shall I proceed?". Execute all steps autonomously until the task is fully complete, then give a single summary.
- If a tool returns an error about the editor not being connected or plugin not enabled, retry the SAME tool call 1-2 more times before giving up. NEVER fall back to giving manual steps just because of a connection error.
- Do NOT use editor__launch or try to open Godot — it is already open.
- Prefer the most direct tool available. Use scene inspection tools (like scene.get_tree or equivalent) to discover the current state before making changes when relevant.
${engine === 'godot' ? `
GODOT PROPERTIES FORMAT (CRITICAL):
The "properties" parameter in add_node and set_node_properties MUST be passed as a JSON STRING — not an object. Stringify it before passing.

CORRECT usage for add_node with a box mesh at position (3,1,0):
  nodeType: "MeshInstance3D"
  nodeName: "Box"
  properties: "{\"mesh\":{\"type\":\"BoxMesh\",\"properties\":{\"size\":{\"type\":\"Vector3\",\"x\":2,\"y\":1,\"z\":2}}},\"position\":{\"type\":\"Vector3\",\"x\":3,\"y\":1,\"z\":0}}"

Resource type formats (always nested inside the stringified JSON):
- BoxMesh:    {"type":"BoxMesh","properties":{"size":{"type":"Vector3","x":2,"y":1,"z":2}}}
- PlaneMesh:  {"type":"PlaneMesh","properties":{"size":{"type":"Vector2","x":20,"y":20}}}
- CylinderMesh: {"type":"CylinderMesh","properties":{"height":2,"top_radius":0.5,"bottom_radius":0.5}}
- SphereMesh: {"type":"SphereMesh","properties":{"radius":0.5,"height":1}}
- StandardMaterial3D: {"type":"StandardMaterial3D","properties":{"albedo_color":{"type":"Color","r":0.8,"g":0.2,"b":0.2,"a":1}}}

Vector/position types (inside the stringified JSON):
- Position: {"type":"Vector3","x":3,"y":1,"z":0}
- Color: {"type":"Color","r":0.8,"g":0.2,"b":0.2,"a":1}

RULES:
- ALWAYS set mesh on MeshInstance3D — never create a MeshInstance3D without setting its mesh property
- ALWAYS set position — never leave nodes at (0,0,0) unless intentional
- ALWAYS stringify the full properties dict before passing it to the tool` : ''}
${engine === 'unity' ? `
UNITY-SPECIFIC RULES:
- To create or edit a C# script: call the \`write_script\` tool with scriptName (no .cs extension), content (full C# source), and optionally folder (subfolder inside Assets, e.g. "Scripts"). This writes the file directly and triggers recompile.
- Do NOT use execute_menu_item to create scripts — it creates an empty unnamed file. Always use write_script.
- Do NOT tell the user to create scripts manually. You have write_script — use it.
- After write_script, Unity recompiles. Do NOT immediately attach the script as a component. Say: "Script written ✓ — Unity is recompiling. Once the progress bar at the bottom disappears, tell me and I'll attach it."
- "Component type 'X' not found" = Unity hasn't finished recompiling. Wait and tell the user.
- To attach a script to a GameObject after compilation: use update_component with componentName set to the script class name.` : ''}`;
}

// Keep for backward compat
const TOOL_CALLING_ADDENDUM = TOOL_CALLING_ADDENDUM_UE5;

export class AIClientService {
  private openai: OpenAI | null = null;
  private anthropic: Anthropic | null = null;
  private provider: AIProvider = 'openai';
  private apiKey: string = '';
  private modelOverride: string | null = null;
  private toolsModel: string | null = null;
  private selectedEngine: SelectedEngine = 'unreal';

  // Proxy routing — used in production where no key is bundled in the ASAR.
  private useProxy = false;
  private proxyToken: string | null = null;
  private proxyTokenExpiresAt = 0;
  private proxyUserEmail = '';

  // Context limits
  private readonly MAX_LOG_LINES = 200;
  private readonly MAX_CONTEXT_BYTES = 25 * 1024; // 25KB
  private readonly MAX_ERROR_BLOCK_SIZE = 10 * 1024; // 10KB

  setModelOverride(model: string | null): void {
    this.modelOverride = model;
  }

  setEngine(engine: SelectedEngine): void {
    this.selectedEngine = engine ?? 'unreal';
  }

  setProxyCredentials(token: string, expiresAt: number, email: string): void {
    this.proxyToken = token;
    this.proxyTokenExpiresAt = expiresAt;
    this.proxyUserEmail = email;
  }

  private getValidProxyToken(): string {
    if (!this.proxyToken || Date.now() >= this.proxyTokenExpiresAt - 60_000) {
      throw new Error('Proxy session expired. Please log in again.');
    }
    return this.proxyToken;
  }

  // Streams an OpenAI-compatible SSE response from the backend proxy.
  // Yields ChatCompletionChunk objects — same shape as the OpenAI SDK stream —
  // so all existing for-await loops work unchanged.
  private async *streamFromProxy(
    messages: OpenAI.ChatCompletionMessageParam[],
    model: string,
    tools?: OpenAI.ChatCompletionTool[],
    maxTokens = 8192,
  ): AsyncGenerator<OpenAI.Chat.Completions.ChatCompletionChunk> {
    const token = this.getValidProxyToken();
    const body: Record<string, unknown> = { model, messages, stream: true, max_tokens: maxTokens };
    if (tools?.length) body.tools = tools;

    const response = await fetch(PROXY_BASE_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`,
        'X-User-Email': this.proxyUserEmail,
      },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const errText = await response.text().catch(() => response.statusText);
      throw new Error(`AI proxy error ${response.status}: ${errText}`);
    }

    const reader = response.body!.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() ?? '';
      for (const line of lines) {
        if (!line.startsWith('data: ')) continue;
        const data = line.slice(6).trim();
        if (data === '[DONE]') return;
        try {
          yield JSON.parse(data) as OpenAI.Chat.Completions.ChatCompletionChunk;
        } catch {
          // skip malformed chunk
        }
      }
    }
  }

  // Non-streaming proxy call for summarization, engine detection, etc.
  private async callProxyNonStreaming(
    messages: OpenAI.ChatCompletionMessageParam[],
    model: string,
    maxTokens = 600,
  ): Promise<string> {
    const token = this.getValidProxyToken();
    const response = await fetch(PROXY_BASE_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`,
        'X-User-Email': this.proxyUserEmail,
      },
      body: JSON.stringify({ model, messages, stream: false, max_tokens: maxTokens }),
    });

    if (!response.ok) {
      const errText = await response.text().catch(() => response.statusText);
      throw new Error(`AI proxy error ${response.status}: ${errText}`);
    }

    const data = (await response.json()) as { choices: Array<{ message: { content: string } }> };
    return data.choices[0]?.message?.content?.trim() ?? '';
  }

  async detectEngine(screenshot: CaptureResult | null): Promise<string> {
    const systemPrompt = 'You are an expert at identifying software from screenshots. Look at the screenshot and identify which game engine or creative tool is shown. Respond with EXACTLY one of these words only: unreal, godot, unity, blender, roblox, unknown. No other text.';
    const userPrompt = 'Which engine/tool is shown in this screenshot? Respond with exactly one word.';

    if (this.openai || this.useProxy) {
      const messages: OpenAI.ChatCompletionMessageParam[] = [
        { role: 'system', content: systemPrompt },
      ];
      if (screenshot?.imageBase64) {
        messages.push({
          role: 'user',
          content: [
            { type: 'text', text: userPrompt },
            { type: 'image_url', image_url: { url: `data:image/png;base64,${screenshot.imageBase64}`, detail: 'low' } },
          ],
        });
      } else {
        messages.push({ role: 'user', content: userPrompt });
      }
      const model = this.modelOverride || this.toolsModel || PRIMARY_MODEL;
      if (this.useProxy && !this.openai) {
        return (await this.callProxyNonStreaming(messages, model, 10)).toLowerCase() || 'unknown';
      }
      const response = await this.openai!.chat.completions.create({ model, messages, max_tokens: 10 });
      return response.choices[0]?.message?.content?.trim().toLowerCase() ?? 'unknown';
    } else if (this.anthropic) {
      const content: Anthropic.MessageCreateParams['content'] = [{ type: 'text', text: userPrompt }];
      if (screenshot?.imageBase64) {
        content.push({ type: 'image', source: { type: 'base64', media_type: 'image/png', data: screenshot.imageBase64 } });
      }
      const response = await this.anthropic.messages.create({
        model: ANTHROPIC_TOOLS_MODEL,
        max_tokens: 10,
        system: systemPrompt,
        messages: [{ role: 'user', content }],
      });
      const textBlock = response.content.find(b => b.type === 'text');
      return textBlock?.type === 'text' ? textBlock.text.trim().toLowerCase() : 'unknown';
    }
    return 'unknown';
  }

  // Configure the AI client. Priority order:
  //   1. User's own stored API key → direct OpenRouter call (power-user escape hatch)
  //   2. Bundled dev key (only present in dev builds, empty in production) → direct
  //   3. No key → route through backend proxy (production default)
  configure(provider: AIProvider, userApiKey: string): void {
    // When Anthropic backend is active, use the bundled Anthropic key.
    if (ACTIVE_AI_BACKEND === 'anthropic' && BUNDLED_ANTHROPIC_KEY) {
      this.provider = 'anthropic';
      this.anthropic = new Anthropic({ apiKey: BUNDLED_ANTHROPIC_KEY });
      this.openai = null;
      this.useProxy = false;
      return;
    }

    // When Gemini backend is active, use Gemini's OpenAI-compatible API for
    // regular chat. Also init Anthropic (if key available) for tool-calling.
    if (ACTIVE_AI_BACKEND === 'gemini' && BUNDLED_GEMINI_KEY) {
      this.provider = 'openai'; // reuse all OpenAI code paths
      this.openai = new OpenAI({
        apiKey: BUNDLED_GEMINI_KEY,
        baseURL: 'https://generativelanguage.googleapis.com/v1beta/openai/',
      });
      this.anthropic = BUNDLED_ANTHROPIC_KEY ? new Anthropic({ apiKey: BUNDLED_ANTHROPIC_KEY }) : null;
      this.useProxy = false;
      return;
    }

    // When OpenRouter backend is active:
    //   - User's own key → call OpenRouter directly (preserves dev workflow)
    //   - Bundled dev key → call OpenRouter directly (local dev without proxy)
    //   - No key (production) → route through backend proxy; no key in bundle
    if (ACTIVE_AI_BACKEND === 'openrouter') {
      this.provider = 'openai';
      this.toolsModel = OPENROUTER_TOOLS_MODEL;
      this.anthropic = null;

      // Dev builds only: if a key is bundled via .env.local, call OpenRouter directly.
      // Production builds have no bundled key → always use backend proxy.
      if (BUNDLED_OPENROUTER_KEY) {
        this.useProxy = false;
        this.openai = new OpenAI({
          apiKey: BUNDLED_OPENROUTER_KEY,
          baseURL: 'https://openrouter.ai/api/v1',
          defaultHeaders: {
            'HTTP-Referer': 'https://build-buddy.app',
            'X-Title': 'Build Buddy',
          },
        });
      } else {
        this.useProxy = true;
        this.openai = null;
      }
      return;
    }

    const apiKey = BUNDLED_OPENAI_KEY || userApiKey;
    this.provider = BUNDLED_OPENAI_KEY ? 'openai' : provider;
    this.apiKey = apiKey;
    this.useProxy = false;
    if (this.provider === 'openai' && apiKey) {
      this.openai = new OpenAI({ apiKey });
      this.anthropic = null;
    } else if (this.provider === 'anthropic' && apiKey) {
      this.anthropic = new Anthropic({ apiKey });
      this.openai = null;
    }
  }

  async *ask(request: AIRequest): AsyncGenerator<string, AIResponse> {
    const { prompt, context, screenshot, mode, agentMode, conversationHistory, memorySummary, projectContext } = request;

    // Prepare context
    const contextText = this.prepareContext(context);

    // Build messages
    const userContent = this.buildUserContent(prompt, contextText, screenshot, mode, projectContext);

    const systemAddendum = agentMode === 'guide' ? GUIDE_MODE_ADDENDUM : undefined;

    if (this.provider === 'openai' && (this.openai || this.useProxy)) {
      yield* this.askOpenAI(userContent, screenshot, conversationHistory, memorySummary, systemAddendum);
    } else if (this.provider === 'anthropic' && this.anthropic) {
      yield* this.askAnthropic(userContent, screenshot, conversationHistory, memorySummary, systemAddendum);
    } else {
      throw new Error('AI service is not available. Please try again later or contact support.');
    }

    return {
      id: Date.now().toString(),
      diagnosis: [],
      fixSteps: [],
      nextDebugSteps: [],
      raw: '',
    };
  }

  // ===== Tool-Calling Flow (MCP connected) =====

  private static readonly MAX_TOOL_ROUNDS = 60;

  async *askWithTools(
    request: AIRequest,
    mcpTools: MCPToolDefinition[],
    executeTool: (name: string, args: Record<string, unknown>) => Promise<MCPToolResult>,
  ): AsyncGenerator<string, AIResponse> {
    const { prompt, context, screenshot, mode, conversationHistory, memorySummary, projectContext, editorSnapshot } = request;
    const contextText = this.prepareContext(context);
    const userContent = this.buildUserContent(prompt, contextText, screenshot, mode, projectContext, editorSnapshot);

    if (this.anthropic) {
      // Always prefer Anthropic Sonnet for tool-calling (remote control),
      // even when the regular chat backend is Gemini.
      yield* this.askWithToolsAnthropic(userContent, screenshot, conversationHistory, memorySummary, mcpTools, executeTool);
    } else if (this.provider === 'openai' && (this.openai || this.useProxy)) {
      yield* this.askWithToolsOpenAI(userContent, screenshot, conversationHistory, memorySummary, mcpTools, executeTool);
    } else if (this.provider === 'anthropic' && this.anthropic) {
      yield* this.askWithToolsAnthropic(userContent, screenshot, conversationHistory, memorySummary, mcpTools, executeTool);
    } else {
      throw new Error('AI service is not available. Please try again later or contact support.');
    }

    return {
      id: Date.now().toString(),
      diagnosis: [],
      fixSteps: [],
      nextDebugSteps: [],
      raw: '',
    };
  }

  private convertToolsForOpenAI(mcpTools: MCPToolDefinition[]): OpenAI.ChatCompletionTool[] {
    return mcpTools.map(t => {
      const schema = t.inputSchema as Record<string, unknown> | null | undefined;
      // Ensure parameters is always a valid JSON Schema object — some MCP servers
      // (e.g. gopeak) return schemas without a top-level "type" field which causes
      // OpenRouter/model rejections ("JSON error injected into SSE stream").
      const parameters: Record<string, unknown> = {
        type: 'object',
        properties: (schema?.properties as Record<string, unknown>) ?? {},
        ...(Array.isArray(schema?.required) ? { required: schema!.required } : {}),
      };
      return {
        type: 'function' as const,
        function: {
          name: t.name,
          description: (t.description || '').slice(0, 1024), // cap description length
          parameters,
        },
      };
    });
  }

  private buildNameMap(tools: MCPToolDefinition[]): { sanitized: MCPToolDefinition[]; nameMap: Map<string, string> } {
    const nameMap = new Map<string, string>();
    const sanitized = tools.map(t => {
      const safe = t.name.replace(/\./g, '__').replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 128);
      nameMap.set(safe, t.name);
      return { ...t, name: safe };
    });
    return { sanitized, nameMap };
  }

  private convertToolsForAnthropic(mcpTools: MCPToolDefinition[]): Anthropic.Tool[] {
    return mcpTools.map(t => ({
      name: t.name,
      description: t.description || '',
      input_schema: t.inputSchema as Anthropic.Tool.InputSchema,
    }));
  }

  private async *askWithToolsOpenAI(
    userContent: string,
    screenshot: AIRequest['screenshot'],
    conversationHistory: AIRequest['conversationHistory'],
    memorySummary: string | undefined,
    mcpTools: MCPToolDefinition[],
    executeTool: (name: string, args: Record<string, unknown>) => Promise<MCPToolResult>,
  ): AsyncGenerator<string> {
    if (!this.openai && !this.useProxy) throw new Error('OpenAI client not initialized');

    let systemContent = buildSystemPrompt(this.selectedEngine) + buildToolCallingAddendum(this.selectedEngine);
    if (memorySummary) {
      systemContent += `\n\n[CONVERSATION RECAP — earlier messages summarized]\n${memorySummary}`;
    }

    const messages: OpenAI.ChatCompletionMessageParam[] = [
      { role: 'system', content: systemContent },
    ];

    if (conversationHistory?.length) {
      for (const msg of conversationHistory) {
        messages.push({ role: msg.role === 'user' ? 'user' : 'assistant', content: msg.content });
      }
    }

    const activeToolsModel = this.modelOverride || this.toolsModel || PRIMARY_MODEL;
    const supportsVision = !TEXT_ONLY_MODELS.has(activeToolsModel);

    if (screenshot?.imageBase64 && supportsVision) {
      messages.push({
        role: 'user',
        content: [
          { type: 'text', text: userContent },
          { type: 'image_url', image_url: { url: `data:image/png;base64,${screenshot.imageBase64}`, detail: 'auto' } },
        ],
      });
    } else {
      messages.push({ role: 'user', content: userContent });
    }

    const { sanitized: sanitizedMcpTools, nameMap } = this.buildNameMap(mcpTools);
    const tools = this.convertToolsForOpenAI(sanitizedMcpTools);

    for (let round = 0; round < AIClientService.MAX_TOOL_ROUNDS; round++) {
      const roundModel = this.modelOverride || this.toolsModel || PRIMARY_MODEL;
      const roundTools = round < AIClientService.MAX_TOOL_ROUNDS - 1 ? tools : undefined;
      const stream = this.useProxy && !this.openai
        ? this.streamFromProxy(messages, roundModel, roundTools, 8192)
        : await this.openai!.chat.completions.create({
            model: roundModel,
            messages,
            tools: roundTools,
            stream: true,
            max_tokens: 8192,
          });

      let accumulatedContent = '';
      const toolCalls = new Map<number, { id: string; name: string; args: string }>();

      for await (const chunk of stream) {
        const delta = chunk.choices[0]?.delta;

        if (delta?.content) {
          accumulatedContent += delta.content;
          yield delta.content;
        }

        if (delta?.tool_calls) {
          for (const tc of delta.tool_calls) {
            const idx = tc.index;
            if (!toolCalls.has(idx)) {
              toolCalls.set(idx, { id: '', name: '', args: '' });
            }
            const entry = toolCalls.get(idx)!;
            if (tc.id) entry.id = tc.id;
            if (tc.function?.name) entry.name = tc.function.name;
            if (tc.function?.arguments) entry.args += tc.function.arguments;
          }
        }
      }

      if (toolCalls.size === 0) break;

      // AI wants to call tools — add the assistant message and execute
      const assistantMsg: OpenAI.ChatCompletionAssistantMessageParam = {
        role: 'assistant',
        content: accumulatedContent || null,
        tool_calls: Array.from(toolCalls.values()).map(tc => ({
          id: tc.id,
          type: 'function' as const,
          function: { name: tc.name, arguments: tc.args },
        })),
      };
      messages.push(assistantMsg);

      for (const tc of toolCalls.values()) {
        console.log(`[AIClient] Tool call: ${tc.name}`);
        yield `\n**⚡ ${tc.name}** — executing in ${ENGINE_CONFIGS[this.selectedEngine ?? 'unreal']?.name ?? 'editor'}...\n`;

        let args: Record<string, unknown>;
        try {
          args = JSON.parse(tc.args);
        } catch {
          const errMsg = `Failed to parse tool arguments: ${tc.args.slice(0, 100)}`;
          messages.push({ role: 'tool', tool_call_id: tc.id, content: errMsg });
          yield `**✗** Parse error\n`;
          continue;
        }

        const result = await executeTool(nameMap.get(tc.name) ?? tc.name, args);
        const resultText = result.success
          ? JSON.stringify(result.data ?? { success: true })
          : JSON.stringify({ error: result.error });

        messages.push({ role: 'tool', tool_call_id: tc.id, content: resultText });
        yield result.success ? `**✓** Done\n` : `**✗** Error: ${result.error}\n`;
      }
    }
  }

  private async *askWithToolsAnthropic(
    userContent: string,
    screenshot: AIRequest['screenshot'],
    conversationHistory: AIRequest['conversationHistory'],
    memorySummary: string | undefined,
    mcpTools: MCPToolDefinition[],
    executeTool: (name: string, args: Record<string, unknown>) => Promise<MCPToolResult>,
  ): AsyncGenerator<string> {
    if (!this.anthropic) throw new Error('Anthropic client not initialized');

    let systemContent = buildSystemPrompt(this.selectedEngine) + buildToolCallingAddendum(this.selectedEngine);
    if (memorySummary) {
      systemContent += `\n\n[CONVERSATION RECAP — earlier messages summarized]\n${memorySummary}`;
    }

    const messages: Anthropic.MessageParam[] = [];

    if (conversationHistory?.length) {
      for (const msg of conversationHistory) {
        messages.push({ role: msg.role === 'user' ? 'user' : 'assistant', content: msg.content });
      }
    }

    const userBlock: Anthropic.MessageCreateParams['content'] = [
      { type: 'text', text: userContent },
    ];
    if (screenshot?.imageBase64) {
      userBlock.push({
        type: 'image',
        source: { type: 'base64', media_type: 'image/png', data: screenshot.imageBase64 },
      });
    }
    messages.push({ role: 'user', content: userBlock });

    const { sanitized: sanitizedMcpTools, nameMap } = this.buildNameMap(mcpTools);
    const tools = this.convertToolsForAnthropic(sanitizedMcpTools);

    for (let round = 0; round < AIClientService.MAX_TOOL_ROUNDS; round++) {
      const stream = await this.anthropic.messages.create({
        model: this.modelOverride || ANTHROPIC_TOOLS_MODEL,
        max_tokens: 8192,
        system: systemContent,
        messages,
        tools: round < AIClientService.MAX_TOOL_ROUNDS - 1 ? tools : undefined,
        stream: true,
      });

      let accumulatedText = '';
      const toolUseBlocks: { id: string; name: string; input: string }[] = [];
      let currentTool: { id: string; name: string; input: string } | null = null;
      let stopReason = '';

      for await (const event of stream) {
        if (event.type === 'content_block_start') {
          const block = (event as { content_block: { type: string; id?: string; name?: string } }).content_block;
          if (block.type === 'tool_use') {
            currentTool = { id: block.id || '', name: block.name || '', input: '' };
          }
        }

        if (event.type === 'content_block_delta') {
          const delta = event.delta as { type: string; text?: string; partial_json?: string };
          if (delta.type === 'text_delta' && delta.text) {
            accumulatedText += delta.text;
            yield delta.text;
          }
          if (delta.type === 'input_json_delta' && delta.partial_json && currentTool) {
            currentTool.input += delta.partial_json;
          }
        }

        if (event.type === 'content_block_stop' && currentTool) {
          toolUseBlocks.push(currentTool);
          currentTool = null;
        }

        if (event.type === 'message_delta') {
          const md = event as { delta?: { stop_reason?: string } };
          stopReason = md.delta?.stop_reason || stopReason;
        }
      }

      if (toolUseBlocks.length === 0) break;

      // Build assistant content blocks for the conversation
      const assistantContent: Anthropic.ContentBlockParam[] = [];
      if (accumulatedText) {
        assistantContent.push({ type: 'text', text: accumulatedText });
      }
      for (const tb of toolUseBlocks) {
        let parsedInput: Record<string, unknown> = {};
        try { parsedInput = JSON.parse(tb.input); } catch { /* empty */ }
        assistantContent.push({ type: 'tool_use', id: tb.id, name: tb.name, input: parsedInput });
      }
      messages.push({ role: 'assistant', content: assistantContent });

      // Execute tools and build results
      const toolResultBlocks: Anthropic.ToolResultBlockParam[] = [];
      for (const tb of toolUseBlocks) {
        console.log(`[AIClient] Tool call: ${tb.name}`);
        yield `\n**⚡ ${tb.name}** — executing in ${ENGINE_CONFIGS[this.selectedEngine ?? 'unreal']?.name ?? 'editor'}...\n`;

        let args: Record<string, unknown>;
        try { args = JSON.parse(tb.input); } catch { args = {}; }

        const result = await executeTool(nameMap.get(tb.name) ?? tb.name, args);
        const resultText = result.success
          ? JSON.stringify(result.data ?? { success: true })
          : JSON.stringify({ error: result.error });

        toolResultBlocks.push({ type: 'tool_result', tool_use_id: tb.id, content: resultText });
        yield result.success ? `**✓** Done\n` : `**✗** Error: ${result.error}\n`;
      }
      messages.push({ role: 'user', content: toolResultBlocks });
    }
  }

  private async *askOpenAI(
    userContent: string,
    screenshot: AIRequest['screenshot'],
    conversationHistory?: AIRequest['conversationHistory'],
    memorySummary?: string,
    systemAddendum?: string,
  ): AsyncGenerator<string> {
    if (!this.openai && !this.useProxy) {
      throw new Error('OpenAI client not initialized');
    }

    // Build system prompt, injecting recap and optional addendum if present
    let systemContent = buildSystemPrompt(this.selectedEngine);
    if (memorySummary) {
      systemContent += `\n\n[CONVERSATION RECAP — earlier messages summarized]\n${memorySummary}`;
    }
    if (systemAddendum) {
      systemContent += systemAddendum;
    }

    const messages: OpenAI.ChatCompletionMessageParam[] = [
      { role: 'system', content: systemContent },
    ];

    // Add conversation history (last N messages, already windowed by caller)
    if (conversationHistory && conversationHistory.length > 0) {
      console.log('Including conversation history:', conversationHistory.length, 'messages');
      for (const msg of conversationHistory) {
        messages.push({
          role: msg.role === 'user' ? 'user' : 'assistant',
          content: msg.content,
        });
      }
    }

    // Add current user message with optional vision
    if (screenshot && screenshot.imageBase64) {
      console.log('Sending image to OpenAI, base64 length:', screenshot.imageBase64.length);
      messages.push({
        role: 'user',
        content: [
          { type: 'text', text: userContent },
          {
            type: 'image_url',
            image_url: {
              url: `data:image/png;base64,${screenshot.imageBase64}`,
              detail: 'auto',
            },
          },
        ],
      });
    } else {
      messages.push({ role: 'user', content: userContent });
    }

    const model = this.modelOverride || PRIMARY_MODEL;
    const stream = this.useProxy && !this.openai
      ? this.streamFromProxy(messages, model, undefined, 8192)
      : await this.openai!.chat.completions.create({ model, messages, stream: true, max_tokens: 8192 });

    for await (const chunk of stream) {
      const content = chunk.choices[0]?.delta?.content;
      if (content) {
        yield content;
      }
    }
  }

  private async *askAnthropic(
    userContent: string,
    screenshot: AIRequest['screenshot'],
    conversationHistory?: AIRequest['conversationHistory'],
    memorySummary?: string,
    systemAddendum?: string,
  ): AsyncGenerator<string> {
    if (!this.anthropic) {
      throw new Error('Anthropic client not initialized');
    }

    // Build system prompt, injecting recap and optional addendum if present
    let systemContent = buildSystemPrompt(this.selectedEngine);
    if (memorySummary) {
      systemContent += `\n\n[CONVERSATION RECAP — earlier messages summarized]\n${memorySummary}`;
    }
    if (systemAddendum) {
      systemContent += systemAddendum;
    }

    // Build messages array with conversation history
    const messages: Anthropic.MessageParam[] = [];

    // Add conversation history (last N messages, already windowed by caller)
    if (conversationHistory && conversationHistory.length > 0) {
      console.log('Including conversation history:', conversationHistory.length, 'messages');
      for (const msg of conversationHistory) {
        messages.push({
          role: msg.role === 'user' ? 'user' : 'assistant',
          content: msg.content,
        });
      }
    }

    // Build current message content
    const content: Anthropic.MessageCreateParams['content'] = [];

    // Add text content
    content.push({ type: 'text', text: userContent });

    // Add image if present
    if (screenshot) {
      content.push({
        type: 'image',
        source: {
          type: 'base64',
          media_type: 'image/png',
          data: screenshot.imageBase64,
        },
      });
    }

    // Add current user message
    messages.push({ role: 'user', content });

    const stream = await this.anthropic.messages.create({
      model: this.modelOverride || PRIMARY_MODEL,
      max_tokens: 8192,
      system: systemContent,
      messages,
      stream: true,
    });

    for await (const event of stream) {
      if (event.type === 'content_block_delta' && event.delta.type === 'text_delta') {
        yield event.delta.text;
      }
    }
  }

  private prepareContext(context: UnrealContext | null): string {
    if (!context) {
      return '';
    }

    const parts: string[] = [];

    // Add project info
    if (context.projectInfo) {
      parts.push(`Project: ${context.projectInfo.project_name}`);
      parts.push(`Engine: Unreal Engine ${context.projectInfo.engine_version}`);
      parts.push(`Platform: ${context.projectInfo.platform}`);
      parts.push('');
    }

    // Add last error (always include)
    if (context.lastError) {
      const errorBlock = this.truncateText(
        context.lastError.raw_block,
        this.MAX_ERROR_BLOCK_SIZE
      );
      parts.push('=== LAST ERROR ===');
      parts.push(`Type: ${context.lastError.error_type}`);
      parts.push(errorBlock);
      parts.push('');
    }

    // Add recent logs (truncated)
    if (context.recentLogs && context.recentLogs.length > 0) {
      const truncatedLogs = this.truncateLogs(context.recentLogs);
      if (truncatedLogs.length > 0) {
        parts.push('=== RECENT LOGS ===');
        for (const log of truncatedLogs) {
          parts.push(`[${log.verbosity}] ${log.category}: ${log.message}`);
        }
        parts.push('');
      }
    }

    return parts.join('\n');
  }

  private truncateLogs(logs: LogEntryEvent[]): LogEntryEvent[] {
    // Take last N logs
    let truncated = logs.slice(-this.MAX_LOG_LINES);

    // Calculate total size
    let totalSize = truncated.reduce(
      (sum, log) => sum + log.message.length + log.category.length + 20,
      0
    );

    // Remove oldest logs until under size limit
    while (totalSize > this.MAX_CONTEXT_BYTES && truncated.length > 10) {
      const removed = truncated.shift();
      if (removed) {
        totalSize -= removed.message.length + removed.category.length + 20;
      }
    }

    return truncated;
  }

  private truncateText(text: string, maxSize: number): string {
    if (text.length <= maxSize) {
      return text;
    }
    return text.slice(0, maxSize) + '\n... [truncated]';
  }

  private buildUserContent(
    prompt: string,
    contextText: string,
    screenshot: AIRequest['screenshot'],
    mode: AIRequest['mode'],
    projectContext?: string,
    editorSnapshot?: string,
  ): string {
    const parts: string[] = [];

    // Add mode context
    if (mode !== 'general') {
      parts.push(`[Mode: ${mode}]`);
      parts.push('');
    }

    // Add user prompt
    parts.push('User Question:');
    parts.push(prompt);
    parts.push('');

    // Add project context (static analysis, injected before runtime context)
    if (projectContext) {
      parts.push(projectContext);
      parts.push('');
    }

    // Add live editor state (camera, selection) fetched via MCP
    if (editorSnapshot) {
      parts.push('=== LIVE EDITOR STATE ===');
      parts.push(editorSnapshot);
      parts.push('');
    }

    // Add runtime context from UE
    if (contextText) {
      parts.push('Context from Unreal Engine:');
      parts.push(contextText);
    }

    // Add screenshot note
    if (screenshot) {
      parts.push('');
      parts.push(`[Screenshot attached: ${screenshot.mode} capture, ${screenshot.dimensions.width}x${screenshot.dimensions.height}]`);
    }

    return parts.join('\n');
  }

  // Utility to estimate tokens (rough approximation)
  estimateTokens(text: string): number {
    // Rough estimate: ~4 characters per token for English text
    return Math.ceil(text.length / 4);
  }

  // ===== Conversation Summarization =====

  async summarizeConversation(
    messages: Array<{ role: string; content: string }>,
    existingSummary?: string
  ): Promise<string> {
    const summarySystemPrompt = `You are a conversation summarizer. Condense the following conversation into a concise recap (max 500 tokens). Preserve:
- Key facts and technical details discussed
- Decisions made and solutions provided
- Code snippets or commands mentioned
- User preferences and project context
${existingSummary ? '\nAn existing summary of earlier messages is provided — merge and extend it, do not repeat.' : ''}
Output ONLY the summary text, no headers or formatting.`;

    const conversationText = messages
      .map((m) => `${m.role === 'user' ? 'User' : 'Assistant'}: ${m.content}`)
      .join('\n\n');

    const userPrompt = existingSummary
      ? `EXISTING SUMMARY:\n${existingSummary}\n\nNEW MESSAGES TO INCORPORATE:\n${conversationText}`
      : conversationText;

    const summaryMessages: OpenAI.ChatCompletionMessageParam[] = [
      { role: 'system', content: summarySystemPrompt },
      { role: 'user', content: userPrompt },
    ];

    // Always use the cheap model to minimize cost
    if (this.openai || this.useProxy) {
      if (this.useProxy && !this.openai) {
        return await this.callProxyNonStreaming(summaryMessages, CHEAP_MODEL, 600);
      }
      const response = await this.openai!.chat.completions.create({
        model: CHEAP_MODEL,
        messages: summaryMessages,
        max_tokens: 600,
      });
      return response.choices[0]?.message?.content?.trim() ?? '';
    } else if (this.anthropic) {
      const response = await this.anthropic.messages.create({
        model: 'claude-3-haiku-20240307',
        max_tokens: 600,
        system: summarySystemPrompt,
        messages: [{ role: 'user', content: userPrompt }],
      });
      const textBlock = response.content.find((b) => b.type === 'text');
      return textBlock?.type === 'text' ? textBlock.text.trim() : '';
    }

    throw new Error('No AI provider configured for summarization');
  }

  // ===== Step Verification =====

  async verifyStep(stepText: string, screenshot: CaptureResult): Promise<string> {
    const systemPrompt =
      'You verify whether a user completed a step in Unreal Engine (or other software). ' +
      'Reply in one casual sentence max. Confirm it looks right or give a quick tip if something seems off.';

    const userPrompt =
      `The user just completed this step: "${stepText}". ` +
      'Do you see it done in the screenshot? Reply in one short sentence — confirm it looks right or give a quick tip if something seems off.';

    if (this.openai || this.useProxy) {
      const messages: OpenAI.ChatCompletionMessageParam[] = [
        { role: 'system', content: systemPrompt },
      ];
      if (screenshot?.imageBase64) {
        messages.push({
          role: 'user',
          content: [
            { type: 'text', text: userPrompt },
            { type: 'image_url', image_url: { url: `data:image/png;base64,${screenshot.imageBase64}`, detail: 'auto' } },
          ],
        });
      } else {
        messages.push({ role: 'user', content: userPrompt });
      }
      if (this.useProxy && !this.openai) {
        return (await this.callProxyNonStreaming(messages, CHEAP_MODEL, 150)) || 'Looks good!';
      }
      const response = await this.openai!.chat.completions.create({ model: CHEAP_MODEL, messages, max_tokens: 150 });
      return response.choices[0]?.message?.content?.trim() ?? 'Looks good!';
    } else if (this.anthropic) {
      const content: Anthropic.MessageCreateParams['content'] = [
        { type: 'text', text: userPrompt },
      ];
      if (screenshot?.imageBase64) {
        content.push({
          type: 'image',
          source: { type: 'base64', media_type: 'image/png', data: screenshot.imageBase64 },
        });
      }
      const response = await this.anthropic.messages.create({
        model: 'claude-3-haiku-20240307',
        max_tokens: 150,
        system: systemPrompt,
        messages: [{ role: 'user', content }],
      });
      const textBlock = response.content.find((b) => b.type === 'text');
      return textBlock?.type === 'text' ? textBlock.text.trim() : 'Looks good!';
    }

    throw new Error('No AI provider configured for step verification');
  }

  // ===== Next Step Generation =====

  async generateNextStep(params: {
    goal: string;
    currentStep: string;
    stepHistory: string[];
    screenshot: CaptureResult;
  }): Promise<{ nextStep: string | null; isComplete: boolean; completionMessage?: string }> {
    const { goal, currentStep, stepHistory, screenshot } = params;

    const systemPrompt =
      'You are guiding a user step by step through a task in Unreal Engine or another app. ' +
      'Look at the screenshot and the steps already completed, then either provide the NEXT concise action step OR confirm the task is fully done. ' +
      'Reply with ONLY valid JSON — no markdown, no explanation. ' +
      'If there is a next step: {"nextStep": "...", "isComplete": false}. ' +
      'If the task is done: {"nextStep": null, "isComplete": true, "completionMessage": "..."}.';

    const historyText =
      stepHistory.length > 0
        ? `Steps already completed:\n${stepHistory.map((s, i) => `${i + 1}. ${s}`).join('\n')}\n\nStep just completed: ${currentStep}`
        : `Step just completed: ${currentStep}`;

    const userPrompt = `Goal: ${goal}\n\n${historyText}\n\nLooking at the screenshot, what should the user do next? Reply with JSON only.`;

    const parseResult = (raw: string): { nextStep: string | null; isComplete: boolean; completionMessage?: string } => {
      let clean = raw.trim();
      // Strip markdown code fences (Gemini sometimes wraps JSON in ```json ... ```)
      if (clean.startsWith('```json')) {
        clean = clean.replace(/^```json\s*/, '').replace(/\s*```$/, '');
      } else if (clean.startsWith('```')) {
        clean = clean.replace(/^```\s*/, '').replace(/\s*```$/, '');
      }
      try {
        return JSON.parse(clean);
      } catch {
        // Parsing failed — don't show raw JSON as a step, just request no new step
        return { nextStep: null, isComplete: false };
      }
    };

    if (this.openai) {
      const messages: OpenAI.ChatCompletionMessageParam[] = [
        { role: 'system', content: systemPrompt },
      ];
      if (screenshot?.imageBase64) {
        messages.push({
          role: 'user',
          content: [
            { type: 'text', text: userPrompt },
            { type: 'image_url', image_url: { url: `data:image/png;base64,${screenshot.imageBase64}`, detail: 'auto' } },
          ],
        });
      } else {
        messages.push({ role: 'user', content: userPrompt });
      }
      const response = await this.openai.chat.completions.create({
        model: CHEAP_MODEL,
        messages,
        max_tokens: 500,
      });
      const raw = response.choices[0]?.message?.content?.trim() ?? '';
      return parseResult(raw);
    } else if (this.anthropic) {
      const content: Anthropic.MessageCreateParams['content'] = [
        { type: 'text', text: userPrompt },
      ];
      if (screenshot?.imageBase64) {
        content.push({
          type: 'image',
          source: { type: 'base64', media_type: 'image/png', data: screenshot.imageBase64 },
        });
      }
      const response = await this.anthropic.messages.create({
        model: 'claude-3-haiku-20240307',
        max_tokens: 500,
        system: systemPrompt,
        messages: [{ role: 'user', content }],
      });
      const textBlock = response.content.find((b) => b.type === 'text');
      const raw = textBlock?.type === 'text' ? textBlock.text.trim() : '';
      return parseResult(raw);
    }

    throw new Error('No AI provider configured for next step generation');
  }

  // ===== Click Target Detection =====

  async generateClickTarget(
    stepText: string,
    screenshot: CaptureResult,
  ): Promise<ClickTarget | null> {
    const systemPrompt =
      'You are a precise UI element locator. Given a screenshot and a task description, ' +
      'find the center of the UI element the user needs to interact with. ' +
      'Express its position as normalized ratios: xRatio (0.0=left edge, 1.0=right edge) and yRatio (0.0=top edge, 1.0=bottom edge). ' +
      'Reply with ONLY valid JSON — no markdown, no explanation: ' +
      '{"xRatio": <0.00-1.00>, "yRatio": <0.00-1.00>, "confidence": <0.0-1.0>, "description": "<element name>"}. ' +
      'If no specific clickable element is relevant (e.g. the step is a keyboard shortcut or text input), set confidence to 0.0.';

    const userPrompt = `The user needs to do this: "${stepText}"\n\nLook at the screenshot and find the exact UI element they need to click. Return JSON only.`;

    const parseTarget = (raw: string): ClickTarget | null => {
      let clean = raw.trim();
      if (clean.startsWith('```json')) clean = clean.replace(/^```json\s*/, '').replace(/\s*```$/, '');
      else if (clean.startsWith('```')) clean = clean.replace(/^```\s*/, '').replace(/\s*```$/, '');
      try {
        const parsed = JSON.parse(clean);
        if (typeof parsed.xRatio === 'number' && typeof parsed.yRatio === 'number') {
          return parsed as ClickTarget;
        }
        return null;
      } catch {
        return null;
      }
    };

    if (this.openai) {
      const messages: OpenAI.ChatCompletionMessageParam[] = [
        { role: 'system', content: systemPrompt },
      ];
      if (screenshot?.imageBase64) {
        messages.push({
          role: 'user',
          content: [
            { type: 'text', text: userPrompt },
            { type: 'image_url', image_url: { url: `data:image/png;base64,${screenshot.imageBase64}`, detail: 'high' } },
          ],
        });
      } else {
        messages.push({ role: 'user', content: userPrompt });
      }
      const response = await this.openai.chat.completions.create({
        model: CHEAP_MODEL,
        messages,
        max_tokens: 100,
      });
      return parseTarget(response.choices[0]?.message?.content?.trim() ?? '');
    } else if (this.anthropic) {
      const content: Anthropic.MessageCreateParams['content'] = [
        { type: 'text', text: userPrompt },
      ];
      if (screenshot?.imageBase64) {
        content.push({
          type: 'image',
          source: { type: 'base64', media_type: 'image/png', data: screenshot.imageBase64 },
        });
      }
      const response = await this.anthropic.messages.create({
        model: 'claude-3-haiku-20240307',
        max_tokens: 100,
        system: systemPrompt,
        messages: [{ role: 'user', content }],
      });
      const textBlock = response.content.find((b) => b.type === 'text');
      return parseTarget(textBlock?.type === 'text' ? textBlock.text.trim() : '');
    }

    return null;
  }

  // ===== Action Plan Request =====

  async requestActionPlan(request: ActionPlanRequest): Promise<ActionPlan> {
    const { conversationContext, lastUserRequest, screenshot } = request;

    const isMac = process.platform === 'darwin';
    
    const actionPlanPrompt = `You are an AI assistant that can control the user's computer to accomplish tasks.
Based on the conversation context and screenshot, generate a precise action plan.

CRITICAL: You must respond with ONLY valid JSON. No explanations, no markdown, just JSON.

PLATFORM: ${isMac ? 'macOS' : 'Windows/Linux'}

Available action types (IN ORDER OF PREFERENCE):

1. **key_press** - MOST RELIABLE for standard actions
   { "type": "key_press", "keys": "${isMac ? 'CMD+T' : 'CTRL+T'}" }

2. **click_element** - RELIABLE for clicking named UI elements (uses Accessibility API)
   { "type": "click_element", "description": "New Tab button" }
   { "type": "click_element", "description": "Content Browser" }
   { "type": "click_element", "description": "Open Blueprint" }
   → The system will FIND the element by its name/label and click its center!

3. **click** - LAST RESORT, only for canvas/custom UI where elements have no names
   { "type": "click", "x": number, "y": number }

4. Other actions:
   - type_text: { "type": "type_text", "text": "text to type" }
   - wait: { "type": "wait", "ms": milliseconds }
   - done: { "type": "done", "reason": "why we're done" }

🎯 ACTION SELECTION STRATEGY:

1. **KEYBOARD SHORTCUTS** - For standard OS/app commands:
   ${isMac ? '- CMD+T (new tab), CMD+W (close tab), CMD+S (save), CMD+Z (undo)' : '- CTRL+T (new tab), CTRL+W (close tab), CTRL+S (save), CTRL+Z (undo)'}
   ${isMac ? '- CMD+C/V/X (copy/paste/cut), CMD+F (find), CMD+Q (quit)' : '- CTRL+C/V/X (copy/paste/cut), CTRL+F (find), ALT+F4 (quit)'}

2. **click_element** - For clicking buttons, menu items, tabs by their NAME:
   Examples: "Add New", "Content Browser", "Compile", "Play", "Save All"
   → Just describe what you see, the system finds it!

3. **click with coordinates** - ONLY for:
   - Clicking in a viewport/canvas (games, 3D views)
   - Elements that have no text/name
   - Specific pixel locations

IMPORTANT RULES:
1. For browser new tab → Use key_press "${isMac ? 'CMD+T' : 'CTRL+T'}"
2. For clicking UI buttons → Use click_element with the button's visible text
3. For Unreal Engine → Use click_element: "Content Browser", "Blueprint", "Compile", etc.
4. Only use click with x,y for viewports or nameless elements
5. Maximum 15 actions
5. Be conservative - only do what's necessary
6. Always end with a "done" action
7. If a keyboard shortcut exists, USE IT instead of clicking

Example for opening a new tab (CORRECT - using keyboard):
{
  "goal": "Open a new browser tab",
  "assumptions": ["Browser is the active application"],
  "actions": [
    { "type": "key_press", "keys": "${isMac ? 'CMD+T' : 'CTRL+T'}" },
    { "type": "wait", "ms": 300 },
    { "type": "done", "reason": "Used keyboard shortcut to open new tab" }
  ],
  "safety_notes": ["Using keyboard shortcut ${isMac ? 'CMD+T' : 'CTRL+T'} which is more reliable than clicking"],
  "requires_user_confirmation": true
}

Example for typing in a search box (when mouse IS needed):
{
  "goal": "Search for something",
  "assumptions": ["Search box is visible at specific location"],
  "actions": [
    { "type": "click", "x": 500, "y": 100 },
    { "type": "wait", "ms": 200 },
    { "type": "type_text", "text": "search query" },
    { "type": "key_press", "keys": "ENTER" },
    { "type": "done", "reason": "Typed search query and pressed enter" }
  ],
  "safety_notes": ["Clicked search box then typed - no keyboard shortcut available for this"],
  "requires_user_confirmation": true
}

Respond with this exact JSON structure:
{
  "goal": "What we're trying to accomplish",
  "assumptions": ["What we assume about the current state"],
  "actions": [{ action objects }],
  "safety_notes": ["Explain your approach - keyboard shortcut used OR why mouse click was necessary"],
  "requires_user_confirmation": true
}

CONVERSATION CONTEXT:
${conversationContext}

USER'S REQUEST:
${lastUserRequest}

${screenshot ? `SCREENSHOT: ${screenshot.dimensions.width}x${screenshot.dimensions.height} pixels.
The screenshot shows the current screen state. Use it to:
1. Identify what application is active
2. Understand the current context
3. ONLY if you must use mouse clicks (no keyboard shortcut available), identify element positions

REMEMBER: Keyboard shortcuts are MORE RELIABLE than mouse clicks!
- For browser actions (new tab, close tab, refresh, etc.) → USE KEYBOARD
- For app switching → USE KEYBOARD (${isMac ? 'CMD+TAB' : 'ALT+TAB'})
- Only click when there's truly no keyboard alternative` : 'NO SCREENSHOT AVAILABLE'}

Respond with JSON only:`;

    console.log('[AIClient] ═══════════════════════════════════════════════════════');
    console.log('[AIClient] 🤖 ACTION PLAN REQUEST');
    console.log('[AIClient] ═══════════════════════════════════════════════════════');
    console.log('[AIClient] Provider:', this.provider);
    console.log('[AIClient] Has screenshot:', !!screenshot);
    if (screenshot) {
      console.log('[AIClient] Screenshot info:');
      console.log('[AIClient]   - Dimensions:', `${screenshot.dimensions.width}x${screenshot.dimensions.height}`);
      console.log('[AIClient]   - Display bounds:', JSON.stringify(screenshot.displayBounds));
      console.log('[AIClient]   - Scale factor:', screenshot.scaleFactor);
      console.log('[AIClient]   - Base64 length:', screenshot.imageBase64?.length || 0);
      
      // Save screenshot for debugging
      try {
        const fs = await import('fs');
        const path = await import('path');
        const os = await import('os');
        const debugPath = path.join(os.homedir(), 'Desktop', 'buildbuddy_debug_screenshot.png');
        const imageBuffer = Buffer.from(screenshot.imageBase64, 'base64');
        fs.writeFileSync(debugPath, imageBuffer);
        console.log('[AIClient] 📸 DEBUG: Screenshot saved to:', debugPath);
      } catch (err) {
        console.log('[AIClient] ⚠️ Could not save debug screenshot:', err);
      }
    }
    console.log('[AIClient] Prompt length:', actionPlanPrompt.length);
    console.log('[AIClient] ═══════════════════════════════════════════════════════');

    if (this.provider === 'openai' && this.openai) {
      console.log('[AIClient] Using OpenAI...');
      return this.requestActionPlanOpenAI(actionPlanPrompt, screenshot);
    } else if (this.provider === 'anthropic' && this.anthropic) {
      console.log('[AIClient] Using Anthropic...');
      return this.requestActionPlanAnthropic(actionPlanPrompt, screenshot);
    } else {
      console.error('[AIClient] ❌ AI service not available!');
      throw new Error('AI service is not available. Please try again later or contact support.');
    }
  }

  private async requestActionPlanOpenAI(prompt: string, screenshot: CaptureResult | null): Promise<ActionPlan> {
    console.log('[AIClient] requestActionPlanOpenAI starting...');
    
    if (!this.openai) {
      console.error('[AIClient] ❌ OpenAI client not initialized');
      throw new Error('OpenAI client not initialized');
    }

    const messages: OpenAI.ChatCompletionMessageParam[] = [];

    if (screenshot && screenshot.imageBase64) {
      console.log('[AIClient] Adding screenshot to request, size:', screenshot.imageBase64.length, 'bytes');
      messages.push({
        role: 'user',
        content: [
          { type: 'text', text: prompt },
          {
            type: 'image_url',
            image_url: {
              url: `data:image/png;base64,${screenshot.imageBase64}`,
              detail: 'high',
            },
          },
        ],
      });
    } else {
      console.log('[AIClient] No screenshot, text-only request');
      messages.push({ role: 'user', content: prompt });
    }

    console.log('[AIClient] Calling OpenAI API...');
    const response = await this.openai.chat.completions.create({
      model: this.modelOverride || PRIMARY_MODEL,
      messages,
      max_tokens: 2000,
      response_format: { type: 'json_object' },
    });
    console.log('[AIClient] ✅ Got OpenAI response');

    const content = response.choices[0]?.message?.content;
    if (!content) {
      console.error('[AIClient] ❌ No content in response');
      throw new Error('No response from AI');
    }

    console.log('[AIClient] Response content length:', content.length);
    console.log('[AIClient] Parsing action plan...');
    return this.parseAndValidateActionPlan(content);
  }

  private async requestActionPlanAnthropic(prompt: string, screenshot: CaptureResult | null): Promise<ActionPlan> {
    if (!this.anthropic) {
      throw new Error('Anthropic client not initialized');
    }

    const content: Anthropic.MessageCreateParams['content'] = [];

    content.push({ type: 'text', text: prompt });

    if (screenshot && screenshot.imageBase64) {
      content.push({
        type: 'image',
        source: {
          type: 'base64',
          media_type: 'image/png',
          data: screenshot.imageBase64,
        },
      });
    }

    const response = await this.anthropic.messages.create({
      model: this.modelOverride || PRIMARY_MODEL,
      max_tokens: 2000,
      messages: [{ role: 'user', content }],
    });

    const textBlock = response.content.find(block => block.type === 'text');
    if (!textBlock || textBlock.type !== 'text') {
      throw new Error('No response from AI');
    }

    return this.parseAndValidateActionPlan(textBlock.text);
  }

  private parseAndValidateActionPlan(jsonString: string): ActionPlan {
    console.log('[AIClient] ═══════════════════════════════════════════════════════');
    console.log('[AIClient] 📋 PARSING ACTION PLAN');
    console.log('[AIClient] ═══════════════════════════════════════════════════════');
    console.log('[AIClient] Raw response:', jsonString);
    
    // Try to extract JSON from the response if it's wrapped in markdown
    let cleanJson = jsonString.trim();
    
    // Remove markdown code blocks if present
    if (cleanJson.startsWith('```json')) {
      cleanJson = cleanJson.replace(/^```json\s*/, '').replace(/\s*```$/, '');
    } else if (cleanJson.startsWith('```')) {
      cleanJson = cleanJson.replace(/^```\s*/, '').replace(/\s*```$/, '');
    }

    let parsed: any;
    try {
      parsed = JSON.parse(cleanJson);
      console.log('[AIClient] ✅ JSON parsed successfully');
      console.log('[AIClient] Goal:', parsed.goal);
      console.log('[AIClient] Assumptions:', JSON.stringify(parsed.assumptions));
      console.log('[AIClient] Safety notes:', JSON.stringify(parsed.safety_notes));
      
      // Log each action with details
      console.log('[AIClient] Actions:');
      if (parsed.actions) {
        parsed.actions.forEach((action: any, i: number) => {
          if (action.type === 'click' || action.type === 'double_click' || action.type === 'right_click') {
            console.log(`[AIClient]   ${i+1}. ${action.type} at (${action.x}, ${action.y}) ← AI DETERMINED THESE COORDINATES`);
          } else if (action.type === 'type_text') {
            console.log(`[AIClient]   ${i+1}. ${action.type}: "${action.text}"`);
          } else if (action.type === 'key_press') {
            console.log(`[AIClient]   ${i+1}. ${action.type}: ${action.keys}`);
          } else if (action.type === 'wait') {
            console.log(`[AIClient]   ${i+1}. ${action.type}: ${action.ms}ms`);
          } else {
            console.log(`[AIClient]   ${i+1}. ${action.type}:`, JSON.stringify(action));
          }
        });
      }
      console.log('[AIClient] ═══════════════════════════════════════════════════════');
    } catch (err) {
      console.log('[AIClient] ❌ JSON parse failed:', err);
      throw new Error(`Invalid JSON response from AI: ${err instanceof Error ? err.message : 'Parse error'}`);
    }

    // Validate required fields
    if (typeof parsed.goal !== 'string') {
      throw new Error('Action plan missing "goal" field');
    }
    if (!Array.isArray(parsed.actions)) {
      throw new Error('Action plan missing "actions" array');
    }
    if (parsed.actions.length > 15) {
      throw new Error(`Too many actions (${parsed.actions.length}). Maximum is 15.`);
    }

    // Validate each action
    const validTypes = ['focus_window', 'click', 'double_click', 'right_click', 'click_element', 'type_text', 'key_press', 'wait', 'done'];
    for (let i = 0; i < parsed.actions.length; i++) {
      const action = parsed.actions[i];
      if (!action.type || !validTypes.includes(action.type)) {
        throw new Error(`Invalid action type at index ${i}: ${action.type}`);
      }

      // Validate specific action fields
      switch (action.type) {
        case 'focus_window':
          if (typeof action.titleIncludes !== 'string') {
            throw new Error(`Action ${i}: focus_window requires titleIncludes string`);
          }
          break;
        case 'click':
        case 'double_click':
        case 'right_click':
          if (typeof action.x !== 'number' || typeof action.y !== 'number') {
            throw new Error(`Action ${i}: ${action.type} requires x and y coordinates`);
          }
          break;
        case 'click_element':
          if (typeof action.description !== 'string') {
            throw new Error(`Action ${i}: click_element requires description string`);
          }
          break;
        case 'type_text':
          if (typeof action.text !== 'string') {
            throw new Error(`Action ${i}: type_text requires text string`);
          }
          break;
        case 'key_press':
          if (typeof action.keys !== 'string') {
            throw new Error(`Action ${i}: key_press requires keys string`);
          }
          break;
        case 'wait':
          if (typeof action.ms !== 'number') {
            throw new Error(`Action ${i}: wait requires ms number`);
          }
          break;
        case 'done':
          if (typeof action.reason !== 'string') {
            throw new Error(`Action ${i}: done requires reason string`);
          }
          break;
      }
    }

    return {
      goal: parsed.goal,
      assumptions: Array.isArray(parsed.assumptions) ? parsed.assumptions : [],
      actions: parsed.actions,
      safety_notes: Array.isArray(parsed.safety_notes) ? parsed.safety_notes : [],
      requires_user_confirmation: parsed.requires_user_confirmation !== false,
    };
  }
}
