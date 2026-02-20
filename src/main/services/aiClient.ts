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
} from '../../shared/types';

// API key bundled at build time from VITE_OPENAI_API_KEY in .env.local
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const BUNDLED_OPENAI_KEY: string = (import.meta.env as any)?.VITE_OPENAI_API_KEY ?? '';

const SYSTEM_PROMPT = `You are BuildBuddy, an AI assistant specialized in Unreal Engine game development. You can see and analyze screenshots.

YOUR IDENTITY:
- You are specifically designed to help with Unreal Engine development
- You have deep knowledge of UE5, Blueprints, C++, materials, animations, and all UE systems
- When answering UE questions, reference official Unreal Engine documentation when helpful (docs.unrealengine.com)

SCREENSHOT ANALYSIS (CONTEXT-AWARE):
Every message includes a screenshot of the user's screen. How you handle it depends on the conversation flow:

FIRST MESSAGE or NEW CONTEXT (user switched windows/panels/topics since last message):
- START your response by briefly acknowledging what you see (e.g., "I can see you have the Animation Editor open with a skeleton...")
- Identify the application they're using (Unreal Engine, Blender, Unity, etc.)
- If they're in Unreal Engine, mention specific panels, nodes, assets, or errors visible
- Then answer their question while relating it to what's on screen

FOLLOW-UP on the SAME TOPIC (same window/panel, continuing the discussion):
- Do NOT repeat "I can see you have X open..." — the user already knows you see their screen
- Jump straight into answering their follow-up question naturally
- You may briefly reference something NEW on screen if it changed (e.g., "I see you've now compiled and the error is gone")
- Keep the conversation flowing naturally, like a real colleague helping them

HOW TO DECIDE: Compare the current screenshot context to the previous messages. If the user is clearly in the same editor/panel working on the same thing, treat it as a follow-up. If they've moved to a different window, panel, or topic, treat it as a new context and re-acknowledge what you see.

WHEN USER IS IN OTHER SOFTWARE:
If you detect the user is using software OTHER than Unreal Engine (like Blender, Unity, Godot, Maya, etc.):
- You CAN still help them - you're knowledgeable about game dev tools
- BUT mention briefly: "I notice you're using [Software]. While I'm primarily focused on Unreal Engine, I'm happy to help with this too!"
- Still provide helpful assistance for their question

YOUTUBE VIDEO RECOMMENDATIONS (Gorka Games Channel ONLY):
When the user asks for video tutorials, learning resources, or says things like "show me a video", "recommend a tutorial", "is there a video about this":
- Recommend the "Gorka Games" YouTube channel: https://www.youtube.com/@GorkaGames
- NEVER make up or guess video IDs - you don't know the actual video IDs
- Simply say something like: "Check out the **Gorka Games** YouTube channel for great UE5 tutorials! Here's the channel: https://www.youtube.com/@GorkaGames"
- You can mention that Gorka Games has tutorials on UE5, Blueprints, game mechanics, and more
- Only recommend the channel when the user explicitly asks for video tutorials/resources

UNREAL ENGINE EXPERTISE:
You are an expert in:
- Packaging errors, compile issues, and runtime problems
- Blueprint visual scripting and C++ development
- Materials, shaders, and rendering
- Animation, Sequencer, and cinematics
- AI, behavior trees, and navigation
- Multiplayer and networking
- UI with UMG/Slate
- Editor navigation and project settings

FORMATTING RULES (IMPORTANT):
- When referring to UI elements, buttons, menu items, tabs, or keyboard shortcuts, wrap them in backticks
- Examples: Click on the \`File\` menu, then select \`Save\`. Press \`Ctrl+S\` to save.
- Examples: Go to the \`Content Browser\` panel. Click the \`Compile\` button.
- This helps users quickly identify interactive elements they need to click or use

DOCUMENTATION IMAGES (USE SPARINGLY - MAX 2 PER RESPONSE):
When your explanation involves a UE concept with a strong visual component (Blueprint graph layouts, material editor examples, animation state machines, editor panel configurations, node setups), you MAY insert a documentation image marker on its own line:

Format: [[DOC_IMAGE:descriptive search query]]

Rules:
- Maximum 2 markers per response
- Place each marker on its own line where the image fits contextually in your explanation
- Only use when the visual genuinely adds value beyond your text explanation
- Write specific, targeted queries: "Unreal Engine Character Movement Component settings panel" is better than "movement"
- Do NOT use for pure code questions, error messages, or conceptual explanations that need no visual
- Do NOT use if you're unsure whether a relevant doc page exists

Be conversational, friendly, and helpful. You're their buddy for building games!`;

export class AIClientService {
  private openai: OpenAI | null = null;
  private anthropic: Anthropic | null = null;
  private provider: AIProvider = 'openai';
  private apiKey: string = '';
  private modelOverride: string | null = null;

  // Context limits
  private readonly MAX_LOG_LINES = 200;
  private readonly MAX_CONTEXT_BYTES = 25 * 1024; // 25KB
  private readonly MAX_ERROR_BLOCK_SIZE = 10 * 1024; // 10KB

  setModelOverride(model: string | null): void {
    this.modelOverride = model;
  }

  // Prefer the key bundled at build time; fall back to the user's stored key
  // so the app works in dev without a .env.local key.
  configure(provider: AIProvider, userApiKey: string): void {
    const apiKey = BUNDLED_OPENAI_KEY || userApiKey;
    this.provider = BUNDLED_OPENAI_KEY ? 'openai' : provider;
    this.apiKey = apiKey;
    if (this.provider === 'openai' && apiKey) {
      this.openai = new OpenAI({ apiKey });
      this.anthropic = null;
    } else if (this.provider === 'anthropic' && apiKey) {
      this.anthropic = new Anthropic({ apiKey });
      this.openai = null;
    }
  }

  async *ask(request: AIRequest): AsyncGenerator<string, AIResponse> {
    const { prompt, context, screenshot, mode, conversationHistory, projectContext } = request;

    // Prepare context
    const contextText = this.prepareContext(context);

    // Build messages
    const userContent = this.buildUserContent(prompt, contextText, screenshot, mode, projectContext);

    if (this.provider === 'openai' && this.openai) {
      yield* this.askOpenAI(userContent, screenshot, conversationHistory);
    } else if (this.provider === 'anthropic' && this.anthropic) {
      yield* this.askAnthropic(userContent, screenshot, conversationHistory);
    } else {
      throw new Error('AI service is not available. Please try again later or contact support.');
    }

    // Return final response (the generator will have yielded all chunks)
    return {
      id: Date.now().toString(),
      diagnosis: [],
      fixSteps: [],
      nextDebugSteps: [],
      raw: '',
    };
  }

  private async *askOpenAI(
    userContent: string,
    screenshot: AIRequest['screenshot'],
    conversationHistory?: AIRequest['conversationHistory']
  ): AsyncGenerator<string> {
    if (!this.openai) {
      throw new Error('OpenAI client not initialized');
    }

    const messages: OpenAI.ChatCompletionMessageParam[] = [
      { role: 'system', content: SYSTEM_PROMPT },
    ];

    // Add conversation history first (previous messages)
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

    const stream = await this.openai.chat.completions.create({
      model: this.modelOverride || 'gpt-4o',
      messages,
      stream: true,
      max_tokens: 2000,
    });

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
    conversationHistory?: AIRequest['conversationHistory']
  ): AsyncGenerator<string> {
    if (!this.anthropic) {
      throw new Error('Anthropic client not initialized');
    }

    // Build messages array with conversation history
    const messages: Anthropic.MessageParam[] = [];

    // Add conversation history first (previous messages)
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
      model: this.modelOverride || 'claude-3-opus-20240229',
      max_tokens: 2000,
      system: SYSTEM_PROMPT,
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
    projectContext?: string
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

  // ===== UE Python Script Generation =====

  async requestUEPythonScript(
    conversationHistory: { role: string; content: string }[],
    userIntent: string,
    projectInfo?: string,
    cameraInfo?: { x: number; y: number; z: number; pitch: number; yaw: number; roll: number }
  ): Promise<string> {
    // Build camera context section if available
    let cameraContext = '';
    if (cameraInfo) {
      // Compute approximate forward vector from yaw (pitch ignored for ground-plane placement)
      const yawRad = (cameraInfo.yaw * Math.PI) / 180;
      const fwdX = Math.cos(yawRad);
      const fwdY = Math.sin(yawRad);
      cameraContext = `
VIEWPORT CAMERA (use this for spatial requests like "in front of me", "here", "where I'm looking"):
  Camera position: x=${cameraInfo.x.toFixed(1)}, y=${cameraInfo.y.toFixed(1)}, z=${cameraInfo.z.toFixed(1)}
  Camera rotation: pitch=${cameraInfo.pitch.toFixed(1)}, yaw=${cameraInfo.yaw.toFixed(1)}, roll=${cameraInfo.roll.toFixed(1)}
  Forward direction (ground plane): x=${fwdX.toFixed(3)}, y=${fwdY.toFixed(3)}

  To spawn 300 units in front of camera (on the ground plane):
    spawn_x = ${cameraInfo.x.toFixed(1)} + (${fwdX.toFixed(3)} * 300)
    spawn_y = ${cameraInfo.y.toFixed(1)} + (${fwdY.toFixed(3)} * 300)
    spawn_z = ${cameraInfo.z.toFixed(1)}  # same height as camera; adjust to 0 if ground-level makes more sense
    spawn_loc = unreal.Vector(spawn_x, spawn_y, spawn_z)

  When the user says "in front of me", "here", "at my location", or similar — use spawn_loc above.
  When the user gives no location hint, use spawn_loc (camera-relative) rather than world origin.`;
    } else {
      cameraContext = `
SPAWNING LOCATION: Camera info unavailable. Spawn at Vector(0, 0, 100) as safe default.`;
    }

    const systemPrompt = `You are a Python code generator for Unreal Engine 5.
The user wants you to execute something inside Unreal Editor using Python Remote Execution.
The script runs directly on the game thread — do NOT use any threading or callback APIs.

RULES:
- Output ONLY valid Python code — no explanations, no markdown fences, no comments unless critical
- Always start with: import unreal
- Use unreal.log() or print() for status output
- Use the unreal Python API (unreal module) — assume UE5.x
- Keep the script focused, safe, and minimal
- NEVER use EditorLevelLibrary — it is deprecated and missing many functions in UE5
- NEVER invent API calls — if unsure, use a simpler known-good approach
- If the request cannot be done via Python API, print a clear explanation instead of failing silently

CORRECT UE5 PATTERNS (use these exactly):

Spawn a static mesh actor (e.g. cube):
  subsystem = unreal.get_editor_subsystem(unreal.EditorActorSubsystem)
  actor = subsystem.spawn_actor_from_class(unreal.StaticMeshActor, unreal.Vector(0, 0, 100), unreal.Rotator(0, 0, 0))
  mesh = unreal.load_asset('/Engine/BasicShapes/Cube')
  actor.static_mesh_component.set_static_mesh(mesh)

Get selected actors (ALWAYS try selection first, then fall back to find-by-class):
  subsystem = unreal.get_editor_subsystem(unreal.EditorActorSubsystem)
  actors = subsystem.get_selected_level_actors()
  # If nothing selected, find by type:
  if not actors:
      all_actors = subsystem.get_all_level_actors()
      actors = [a for a in all_actors if isinstance(a, unreal.StaticMeshActor)]

Find all actors of a specific class in the level:
  subsystem = unreal.get_editor_subsystem(unreal.EditorActorSubsystem)
  all_actors = subsystem.get_all_level_actors()
  # Filter by class — use isinstance:
  static_meshes = [a for a in all_actors if isinstance(a, unreal.StaticMeshActor)]
  dir_lights   = [a for a in all_actors if isinstance(a, unreal.DirectionalLight)]
  point_lights = [a for a in all_actors if isinstance(a, unreal.PointLight)]
  spot_lights  = [a for a in all_actors if isinstance(a, unreal.SpotLight)]
  sky_lights   = [a for a in all_actors if isinstance(a, unreal.SkyLight)]

Find actor by name/label:
  subsystem = unreal.get_editor_subsystem(unreal.EditorActorSubsystem)
  all_actors = subsystem.get_all_level_actors()
  actor = next((a for a in all_actors if a.get_actor_label().lower() == 'myname'), None)

LIGHTING — always search the level for existing lights first, never assume selection:

  Change directional light (sun) intensity / colour:
    subsystem = unreal.get_editor_subsystem(unreal.EditorActorSubsystem)
    all_actors = subsystem.get_all_level_actors()
    dir_lights = [a for a in all_actors if isinstance(a, unreal.DirectionalLight)]
    if dir_lights:
        light = dir_lights[0]
        light.light_component.set_intensity(10.0)          # lux; typical daylight = 10
        light.light_component.set_light_color(unreal.LinearColor(1.0, 0.95, 0.8, 1.0))
        light.set_actor_rotation(unreal.Rotator(-45, 0, 0))  # pitch controls sun angle
    else:
        print('No DirectionalLight found in level')

  Change sky light intensity:
    sky_lights = [a for a in all_actors if isinstance(a, unreal.SkyLight)]
    if sky_lights:
        sky_lights[0].sky_light_component.set_intensity(1.0)

  Change point light intensity / colour:
    point_lights = [a for a in all_actors if isinstance(a, unreal.PointLight)]
    for l in point_lights:
        l.point_light_component.set_intensity(1500.0)
        l.point_light_component.set_light_color(unreal.LinearColor(1.0, 0.8, 0.6, 1.0))
        l.point_light_component.set_attenuation_radius(500.0)

  Spawn a new point light:
    subsystem = unreal.get_editor_subsystem(unreal.EditorActorSubsystem)
    light = subsystem.spawn_actor_from_class(unreal.PointLight, unreal.Vector(0, 0, 300), unreal.Rotator(0, 0, 0))
    light.point_light_component.set_intensity(1500.0)
    light.point_light_component.set_light_color(unreal.LinearColor(1.0, 1.0, 1.0, 1.0))
    light.point_light_component.set_attenuation_radius(500.0)

  Spawn a spot light:
    light = subsystem.spawn_actor_from_class(unreal.SpotLight, unreal.Vector(0, 0, 400), unreal.Rotator(-90, 0, 0))
    light.spot_light_component.set_intensity(2000.0)
    light.spot_light_component.set_outer_cone_angle(45.0)

  Spawn a directional light (sun):
    light = subsystem.spawn_actor_from_class(unreal.DirectionalLight, unreal.Vector(0, 0, 300), unreal.Rotator(-45, 0, 0))
    light.light_component.set_intensity(10.0)

CONTENT BROWSER — folders and assets:

  Create a folder (ALWAYS scan after creation so it appears in Content Browser immediately):
    unreal.EditorAssetLibrary.make_directory('/Game/MyFolder')
    unreal.AssetRegistryHelpers.get_asset_registry().scan_paths_synchronous(['/Game/MyFolder'], True)
    print('Folder created: /Game/MyFolder')

  List assets in a folder:
    ar = unreal.AssetRegistryHelpers.get_asset_registry()
    assets = ar.get_assets_by_path('/Game/MyFolder', recursive=True)
    for a in assets:
        print(str(a.asset_name))

  Duplicate an asset:
    unreal.EditorAssetLibrary.duplicate_asset('/Game/Source/MyAsset', '/Game/Dest/MyAssetCopy')

  Delete an asset:
    unreal.EditorAssetLibrary.delete_asset('/Game/MyFolder/MyAsset')

Move / rotate / scale an actor:
  actor.set_actor_location(unreal.Vector(x, y, z))
  actor.set_actor_rotation(unreal.Rotator(pitch, yaw, roll))
  actor.set_actor_scale3d(unreal.Vector(x, y, z))

Load asset:
  unreal.load_asset('/Game/path/to/asset')
  unreal.load_asset('/Engine/BasicShapes/Cube')
  unreal.load_asset('/Engine/BasicShapes/Sphere')
  unreal.load_asset('/Engine/BasicShapes/Cylinder')
  unreal.load_asset('/Engine/BasicShapes/Cone')
  unreal.load_asset('/Engine/BasicShapes/Plane')

Get asset registry:
  ar = unreal.AssetRegistryHelpers.get_asset_registry()

Save all:
  unreal.EditorLoadingAndSavingUtils.save_dirty_packages(True, True)

Run console command:
  unreal.SystemLibrary.execute_console_command(None, 'stat fps')

Delete an actor:
  subsystem = unreal.get_editor_subsystem(unreal.EditorActorSubsystem)
  subsystem.destroy_actor(actor)

Set material on actor — NEVER use actor.static_mesh_component directly (breaks on Blueprint actors).
ALWAYS use get_component_by_class which works on ANY actor type:
  mesh_comp = actor.get_component_by_class(unreal.StaticMeshComponent)
  if mesh_comp:
      mat = unreal.load_asset('/Game/path/to/material')
      mesh_comp.set_material(0, mat)

Set material on selected actors (full safe pattern):
  import unreal, json
  try:
      subsystem = unreal.get_editor_subsystem(unreal.EditorActorSubsystem)
      actors = subsystem.get_selected_level_actors()
      if not actors:
          print(json.dumps({'success': False, 'error': 'No actors selected'}))
      else:
          mat = unreal.load_asset('/Game/path/to/material')
          changed = 0
          for actor in actors:
              mesh_comp = actor.get_component_by_class(unreal.StaticMeshComponent)
              if mesh_comp and mat:
                  mesh_comp.set_material(0, mat)
                  changed += 1
          print(json.dumps({'success': True, 'changed': changed}))
  except Exception as e:
      print(json.dumps({'success': False, 'error': str(e)}))

Find a material by name and apply it to selected actors (when user doesn't know exact path):
  import unreal, json
  try:
      subsystem = unreal.get_editor_subsystem(unreal.EditorActorSubsystem)
      actors = subsystem.get_selected_level_actors()
      ar = unreal.AssetRegistryHelpers.get_asset_registry()
      all_assets = ar.get_all_assets()
      term = 'rock'.lower()
      mats = [a for a in all_assets if 'material' in str(a.asset_class).lower() and term in str(a.asset_name).lower()]
      if not mats:
          print(json.dumps({'success': False, 'error': f'No material matching "{term}" found'}))
      else:
          mat = unreal.load_asset(str(mats[0].object_path))
          for actor in actors:
              mesh_comp = actor.get_component_by_class(unreal.StaticMeshComponent)
              if mesh_comp:
                  mesh_comp.set_material(0, mat)
          print(json.dumps({'success': True, 'material': str(mats[0].asset_name)}))
  except Exception as e:
      print(json.dumps({'success': False, 'error': str(e)}))

SELECTION & VIEWPORT:

  Select actors by name or class (makes them visible in UE outliner):
    subsystem = unreal.get_editor_subsystem(unreal.EditorActorSubsystem)
    all_actors = subsystem.get_all_level_actors()
    targets = [a for a in all_actors if a.get_actor_label().lower() == 'cube_01']
    subsystem.set_selected_level_actors(targets)

  Deselect all:
    subsystem = unreal.get_editor_subsystem(unreal.EditorActorSubsystem)
    subsystem.set_selected_level_actors([])

  Focus viewport on selected actor:
    unreal.SystemLibrary.execute_console_command(None, 'actor focus')

ACTOR OPERATIONS:

  Rename an actor (change its label in the Outliner):
    actor.set_actor_label('NewName')

  Hide / show an actor in the editor viewport:
    actor.set_is_temporarily_hidden_in_editor(True)   # hide
    actor.set_is_temporarily_hidden_in_editor(False)  # show

  Duplicate selected actors:
    subsystem = unreal.get_editor_subsystem(unreal.EditorActorSubsystem)
    duplicates = subsystem.duplicate_selected_actors(unreal.Vector(100, 0, 0))  # offset

  Attach actor B to actor A (parent/child):
    actor_b.attach_to_actor(actor_a, '', unreal.AttachmentRule.KEEP_WORLD, unreal.AttachmentRule.KEEP_WORLD, unreal.AttachmentRule.KEEP_WORLD, False)

  Detach actor from parent:
    actor.detach_from_actor(unreal.DetachmentRule.KEEP_WORLD, unreal.DetachmentRule.KEEP_WORLD, unreal.DetachmentRule.KEEP_WORLD)

  Set actor mobility (must be done via set_editor_property):
    actor.root_component.set_editor_property('mobility', unreal.ComponentMobility.MOVABLE)
    # Options: STATIC, STATIONARY, MOVABLE

  Enable/disable physics on a static mesh actor:
    actor.static_mesh_component.set_simulate_physics(True)
    actor.static_mesh_component.set_editor_property('collision_enabled', unreal.CollisionEnabled.QUERY_AND_PHYSICS)

  Generic property setter (use when no dedicated setter exists):
    actor.set_editor_property('hidden', True)
    actor.set_editor_property('tags', ['mytag'])
    component.set_editor_property('cast_shadow', False)

BLUEPRINT:

  Create a new Blueprint asset (does NOT edit the graph — only creates the asset):
    import unreal
    factory = unreal.BlueprintFactory()
    factory.set_editor_property('parent_class', unreal.Actor)
    asset_tools = unreal.AssetToolsHelpers.get_asset_tools()
    bp = asset_tools.create_asset('MyBlueprint', '/Game/Blueprints', unreal.Blueprint, factory)
    unreal.EditorAssetLibrary.save_asset(bp.get_path_name())
    print('Blueprint created: ' + bp.get_path_name())

  Open an asset (Blueprint, Material, etc.) in its editor:
    unreal.AssetEditorSubsystem().open_editor_for_assets([unreal.load_asset('/Game/Blueprints/MyBlueprint')])

  Compile all Blueprints:
    unreal.SystemLibrary.execute_console_command(None, 'blueprints compileall')

WORLD ENVIRONMENT:

  Exponential height fog — find or spawn:
    subsystem = unreal.get_editor_subsystem(unreal.EditorActorSubsystem)
    all_actors = subsystem.get_all_level_actors()
    fogs = [a for a in all_actors if isinstance(a, unreal.ExponentialHeightFog)]
    if fogs:
        fog_comp = fogs[0].get_component_by_class(unreal.ExponentialHeightFogComponent)
        fog_comp.set_editor_property('fog_density', 0.02)
        fog_comp.set_editor_property('fog_inscattering_color', unreal.LinearColor(0.5, 0.6, 0.7, 1.0))
    else:
        fog = subsystem.spawn_actor_from_class(unreal.ExponentialHeightFog, unreal.Vector(0,0,0), unreal.Rotator(0,0,0))

  Sky atmosphere — find and adjust:
    sky_atm = [a for a in all_actors if isinstance(a, unreal.SkyAtmosphere)]
    if sky_atm:
        comp = sky_atm[0].get_component_by_class(unreal.SkyAtmosphereComponent)
        comp.set_editor_property('rayleigh_scattering_scale', 0.0331)

  Post Process Volume — find and adjust (bloom, exposure, colour grading):
    ppvs = [a for a in all_actors if isinstance(a, unreal.PostProcessVolume)]
    if ppvs:
        ppv = ppvs[0]
        settings = ppv.settings
        settings.set_editor_property('bloom_intensity', 1.5)
        settings.set_editor_property('auto_exposure_bias', 1.0)
        settings.set_editor_property('vignette_intensity', 0.4)
        ppv.settings = settings
    else:
        ppv = subsystem.spawn_actor_from_class(unreal.PostProcessVolume, unreal.Vector(0,0,0), unreal.Rotator(0,0,0))
        ppv.set_editor_property('infinite_extent', True)

ADDITIONAL LIGHT TYPES:

  Rect light (area light):
    subsystem = unreal.get_editor_subsystem(unreal.EditorActorSubsystem)
    light = subsystem.spawn_actor_from_class(unreal.RectLight, unreal.Vector(0, 0, 300), unreal.Rotator(-90, 0, 0))
    light.rect_light_component.set_intensity(2000.0)
    light.rect_light_component.set_editor_property('source_width', 100.0)
    light.rect_light_component.set_editor_property('source_height', 50.0)

LEVEL MANAGEMENT:

  Get current level name:
    import unreal, json
    world = unreal.EditorLevelUtils if False else None
    sub = unreal.get_editor_subsystem(unreal.UnrealEditorSubsystem)
    print(json.dumps({'level': str(sub.get_editor_world().get_name())}))

  Open a level:
    unreal.EditorLoadingAndSavingUtils.load_map('/Game/Maps/MyLevel')

  Play in Editor (PIE):
    unreal.SystemLibrary.execute_console_command(None, 'ce StartPlay')
    # Or use: editor subsystem
    unreal.get_editor_subsystem(unreal.UnrealEditorSubsystem).play_in_editor()

  Stop PIE:
    unreal.get_editor_subsystem(unreal.UnrealEditorSubsystem).eject_pilot_level_actor()
    unreal.SystemLibrary.execute_console_command(None, 'ce StopPlay')

ALWAYS wrap scripts in try/except and print results as JSON:
  import unreal, json
  try:
      # ... your code ...
      print(json.dumps({'success': True, 'message': 'Done'}))
  except Exception as e:
      print(json.dumps({'success': False, 'error': str(e)}))
${cameraContext}
${projectInfo ? `PROJECT CONTEXT:\n${projectInfo}\n` : ''}Output ONLY the Python script:`;

    const messages: { role: string; content: string }[] = [
      ...conversationHistory.slice(-10), // last 10 messages for context
      { role: 'user', content: userIntent },
    ];

    if (this.provider === 'openai' && this.openai) {
      const response = await this.openai.chat.completions.create({
        model: this.modelOverride || 'gpt-4o',
        messages: [
          { role: 'system', content: systemPrompt },
          ...messages.map(m => ({ role: m.role as 'user' | 'assistant', content: m.content })),
        ],
        max_tokens: 1500,
      });
      const script = response.choices[0]?.message?.content?.trim() ?? '';
      // Strip markdown fences if model added them anyway
      return script.replace(/^```python\s*/i, '').replace(/^```\s*/i, '').replace(/\s*```$/, '').trim();
    } else if (this.provider === 'anthropic' && this.anthropic) {
      const response = await this.anthropic.messages.create({
        model: this.modelOverride || 'claude-opus-4-6',
        max_tokens: 1500,
        system: systemPrompt,
        messages: messages.map(m => ({ role: m.role as 'user' | 'assistant', content: m.content })),
      });
      const textBlock = response.content.find(b => b.type === 'text');
      const script = textBlock?.type === 'text' ? textBlock.text.trim() : '';
      return script.replace(/^```python\s*/i, '').replace(/^```\s*/i, '').replace(/\s*```$/, '').trim();
    } else {
      throw new Error('AI provider not configured');
    }
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
      model: this.modelOverride || 'gpt-4o',
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
      model: this.modelOverride || 'claude-3-opus-20240229',
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
