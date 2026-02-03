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

const SYSTEM_PROMPT = `You are a helpful AI assistant that can see and analyze screenshots.

When the user sends a screenshot:
- ALWAYS describe what you see on their screen
- Identify any applications, windows, text, or UI elements visible
- If they ask about their screen, describe it in detail

You are also an expert in Unreal Engine and can help with:
- Packaging errors, compile issues, and runtime problems
- Blueprint and C++ development
- Editor navigation and settings

When helping with technical issues, provide:
- Clear diagnosis of the problem
- Step-by-step fix instructions
- Code snippets when needed

Be conversational and helpful. If you see a screenshot, acknowledge what's visible on their screen.`;

export class AIClientService {
  private openai: OpenAI | null = null;
  private anthropic: Anthropic | null = null;
  private provider: AIProvider = 'openai';
  private apiKey: string = '';

  // Context limits
  private readonly MAX_LOG_LINES = 200;
  private readonly MAX_CONTEXT_BYTES = 25 * 1024; // 25KB
  private readonly MAX_ERROR_BLOCK_SIZE = 10 * 1024; // 10KB

  configure(provider: AIProvider, apiKey: string): void {
    this.provider = provider;
    this.apiKey = apiKey;

    if (provider === 'openai' && apiKey) {
      this.openai = new OpenAI({ apiKey });
      this.anthropic = null;
    } else if (provider === 'anthropic' && apiKey) {
      this.anthropic = new Anthropic({ apiKey });
      this.openai = null;
    }
  }

  async *ask(request: AIRequest): AsyncGenerator<string, AIResponse> {
    const { prompt, context, screenshot, mode } = request;

    // Prepare context
    const contextText = this.prepareContext(context);

    // Build messages
    const userContent = this.buildUserContent(prompt, contextText, screenshot, mode);

    if (this.provider === 'openai' && this.openai) {
      yield* this.askOpenAI(userContent, screenshot);
    } else if (this.provider === 'anthropic' && this.anthropic) {
      yield* this.askAnthropic(userContent, screenshot);
    } else {
      throw new Error('AI provider not configured. Please set your API key in settings.');
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
    screenshot: AIRequest['screenshot']
  ): AsyncGenerator<string> {
    if (!this.openai) {
      throw new Error('OpenAI client not initialized');
    }

    const messages: OpenAI.ChatCompletionMessageParam[] = [
      { role: 'system', content: SYSTEM_PROMPT },
    ];

    // Add user message with optional vision
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
      model: 'gpt-4o',
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
    screenshot: AIRequest['screenshot']
  ): AsyncGenerator<string> {
    if (!this.anthropic) {
      throw new Error('Anthropic client not initialized');
    }

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

    const stream = await this.anthropic.messages.create({
      model: 'claude-3-opus-20240229',
      max_tokens: 2000,
      system: SYSTEM_PROMPT,
      messages: [{ role: 'user', content }],
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
    mode: AIRequest['mode']
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

    // Add context
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
      console.error('[AIClient] ❌ AI provider not configured!');
      throw new Error('AI provider not configured. Please set your API key in settings.');
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
      model: 'gpt-4o',
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
      model: 'claude-3-opus-20240229',
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
