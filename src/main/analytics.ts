import { PostHog } from 'posthog-node';
import { app } from 'electron';
import path from 'path';
import fs from 'fs';
import crypto from 'crypto';

const POSTHOG_KEY = 'phc_mnQ2krLb8g9PzjXTSISJkAgODsk3wl4v7T2HuuUdBWJ'; // public key, safe to commit
const POSTHOG_HOST = 'https://us.i.posthog.com';

let client: PostHog;
let deviceId: string;
let isNewInstall = false;

function loadOrCreateDeviceId(): void {
  const filePath = path.join(app.getPath('userData'), 'device-id.txt');
  if (fs.existsSync(filePath)) {
    deviceId = fs.readFileSync(filePath, 'utf-8').trim();
    isNewInstall = false;
  } else {
    deviceId = crypto.randomUUID();
    fs.writeFileSync(filePath, deviceId, 'utf-8');
    isNewInstall = true;
  }
}

export function initAnalytics(): void {
  loadOrCreateDeviceId();
  client = new PostHog(POSTHOG_KEY, { host: POSTHOG_HOST });
}

export function trackAppLaunched(): void {
  client.capture({ distinctId: deviceId, event: 'app_launched' });
}

/** Fires only once ever — on first launch after a fresh install. */
export function trackAppInstalled(): void {
  if (isNewInstall) {
    client.capture({ distinctId: deviceId, event: 'app_installed' });
  }
}

export function trackPlanIdentified(plan: 'free' | 'pro', email?: string): void {
  client.identify({
    distinctId: deviceId,
    properties: { plan, ...(email ? { email } : {}) },
  });
}

export function trackFeatureUsed(featureName: string): void {
  client.capture({ distinctId: deviceId, event: 'feature_used', properties: { feature: featureName } });
}

export function trackScreenCaptureTaken(mode: string): void {
  client.capture({ distinctId: deviceId, event: 'screen_capture_taken', properties: { mode } });
}

export function trackRemoteControlCommand(command: string): void {
  client.capture({ distinctId: deviceId, event: 'remote_control_command', properties: { command } });
}

export async function shutdownAnalytics(): Promise<void> {
  await client.shutdown();
}

// ─── Model cost table (per million tokens) ───────────────────────────────────

const MODEL_PRICES: Record<string, { inputPer1M: number; outputPer1M: number }> = {
  'google/gemini-2.5-flash':   { inputPer1M: 0.15, outputPer1M: 0.60 },
  'minimax/minimax-m2.5':      { inputPer1M: 0.30, outputPer1M: 0.30 },
  'minimax/minimax-m2.5:free': { inputPer1M: 0,    outputPer1M: 0    },
  'gpt-4o-mini':               { inputPer1M: 0.15, outputPer1M: 0.60 },
  'gpt-4o':                    { inputPer1M: 2.50, outputPer1M: 10.00 },
  'claude-sonnet-4-6':         { inputPer1M: 3.00, outputPer1M: 15.00 },
  'gemini-2.5-flash':          { inputPer1M: 0.15, outputPer1M: 0.60 },
};

export function estimateCostUsd(model: string, inputTokens: number, outputTokens: number): number {
  const p = MODEL_PRICES[model] ?? { inputPer1M: 0, outputPer1M: 0 };
  return (inputTokens * p.inputPer1M + outputTokens * p.outputPer1M) / 1_000_000;
}

export type PromptCategory =
  | 'scripting'
  | 'visual-design'
  | 'scene-setup'
  | 'animation'
  | 'physics'
  | 'debug-error'
  | 'audio'
  | 'learn-how'
  | 'remote-control'
  | 'other';

// Keyword-based classifier — runs locally, never sends raw prompt text off-device.
// Ordering matters: earlier matches win, so put more specific categories first.
const CATEGORY_PATTERNS: Array<{ category: PromptCategory; patterns: RegExp[] }> = [
  { category: 'debug-error', patterns: [/\b(error|errors|bug|broken|crash(ed|ing)?|fail(ed|ing|ure)?|fix|not\s+work(ing)?|won't\s+\w+|issue|problem)\b/i] },
  { category: 'learn-how',   patterns: [/\b(how\s+do\s+i|how\s+to|how\s+can|what\s+is|what's\s+the|explain|tutorial|guide\s+me|walk\s+me\s+through|teach\s+me|why\s+does)\b/i] },
  { category: 'scripting',   patterns: [/\b(blueprint|blueprints|c\+\+|cpp|header|include|gdscript|gd\s?script|python\s+script|c#|csharp|script|scripting|function|method|class|variable|compile|compiler|debug(ger)?|breakpoint)\b/i] },
  { category: 'visual-design', patterns: [/\b(material|shader|texture|lighting|light|lumen|nanite|post\s?process|color|colour|gradient|ui|widget|hud|menu|ux\s+design|vfx|niagara|particle|fog|bloom|exposure|skybox)\b/i] },
  { category: 'animation',   patterns: [/\b(anim(ate|ation|ations)?|rig(ging|ged)?|keyframe|timeline|sequencer|montage|blend\s?space|state\s?machine|skeletal|ik\b|inverse\s+kinematics|pose|root\s+motion)\b/i] },
  { category: 'physics',     patterns: [/\b(physics|collision|collid(e|er|ing)|rigidbody|rigid\s+body|gravity|force|velocity|friction|joint|constraint|ragdoll)\b/i] },
  { category: 'audio',       patterns: [/\b(audio|sound|music|sfx|wav|mp3|metasound|mixer|attenuation|reverb|volume)\b/i] },
  { category: 'scene-setup', patterns: [/\b(spawn|place|scene|level|map|prefab|actor|mesh|static\s+mesh|landscape|terrain|world\s+partition|streaming|layout|camera|viewport)\b/i] },
];

export function classifyPrompt(text: string): PromptCategory {
  if (!text) return 'other';
  const lower = text.toLowerCase();
  for (const { category, patterns } of CATEGORY_PATTERNS) {
    if (patterns.some((p) => p.test(lower))) return category;
  }
  return 'other';
}

export interface AIRequestEventProps {
  requestType: 'chat' | 'rc' | 'guided';
  model: string;
  engineType: string | null;
  engineConnected: boolean;
  hadScreenshot: boolean;
  promptLengthChars: number;
  promptCategory: PromptCategory;
  estimatedInputTokens: number;
  estimatedOutputTokens: number;
  estimatedCostUsd: number;
  plan: 'free' | 'pro';
  email: string | null;
}

export function trackAIRequest(props: AIRequestEventProps): void {
  client.capture({ distinctId: deviceId, event: 'ai_request', properties: props });
}

export function trackFairUseTimeout(props: {
  requestType: 'chat' | 'rc';
  plan: 'free' | 'pro';
  email: string | null;
  unlockedAt: number;
  violationCount: number;
}): void {
  client.capture({ distinctId: deviceId, event: 'fair_use_timeout', properties: props });
}

export function trackEngineConnected(props: {
  engineType: string;
  plan: 'free' | 'pro';
  email: string | null;
}): void {
  client.capture({ distinctId: deviceId, event: 'engine_connected', properties: props });
}

// ─── Error classification ────────────────────────────────────────────────────

export type ErrorClass = 'timeout' | 'rate_limit' | 'auth' | 'network' | 'other';

export function classifyError(err: unknown): ErrorClass {
  const msg = (err instanceof Error ? err.message : String(err ?? '')).toLowerCase();
  if (/\btimeout|timed\s*out|etimedout\b/.test(msg)) return 'timeout';
  if (/\b429|rate[\s_-]?limit|too\s+many\s+requests\b/.test(msg)) return 'rate_limit';
  if (/\b401|403|unauthorized|forbidden|auth\b/.test(msg)) return 'auth';
  if (/\benotfound|econnrefused|econnreset|network|fetch\s+failed|failed\s+to\s+fetch\b/.test(msg)) return 'network';
  return 'other';
}

// ─── New event trackers ──────────────────────────────────────────────────────

export function trackHotkeyTriggered(action: string): void {
  client.capture({ distinctId: deviceId, event: 'hotkey_triggered', properties: { action } });
}

export function trackAIRequestFailed(props: {
  requestType: 'chat' | 'rc' | 'guided';
  model: string;
  errorClass: ErrorClass;
  plan: 'free' | 'pro';
  email: string | null;
}): void {
  client.capture({ distinctId: deviceId, event: 'ai_request_failed', properties: props });
}

export function trackMCPConnectFailed(props: {
  engineType: string;
  errorClass: ErrorClass;
  plan: 'free' | 'pro';
  email: string | null;
}): void {
  client.capture({ distinctId: deviceId, event: 'mcp_connect_failed', properties: props });
}

export function trackScreenshotFailed(props: {
  mode: string;
  errorClass: ErrorClass;
}): void {
  client.capture({ distinctId: deviceId, event: 'screenshot_failed', properties: props });
}

export function trackUpgradeClicked(props: {
  source: 'weekly_limit_banner' | 'settings' | 'login_screen' | 'upgrade_prompt' | 'blueprints' | 'blueprints_locked' | 'other';
  plan: 'free' | 'pro';
  email: string | null;
}): void {
  client.capture({ distinctId: deviceId, event: 'upgrade_clicked', properties: props });
}

export function trackSnippetViewed(props: {
  snippetId: string;
  category: string;
  plan: 'free' | 'pro';
  email: string | null;
}): void {
  client.capture({ distinctId: deviceId, event: 'snippet_viewed', properties: props });
}

export function trackSnippetCopied(props: {
  snippetId: string;
  category: string;
  t3dLength: number;
  targetBlueprint: string;
  plan: 'free' | 'pro';
}): void {
  client.capture({ distinctId: deviceId, event: 'snippet_copied', properties: props });
}

export function trackSnippetUpgradeClick(props: {
  snippetId: string;
  plan: 'free' | 'pro';
}): void {
  client.capture({ distinctId: deviceId, event: 'snippet_upgrade_click', properties: props });
}

export function trackSnippetDirectBuildAttempt(props: {
  snippetId: string;
  nodeCount: number;
  plan: 'free' | 'pro';
}): void {
  client.capture({ distinctId: deviceId, event: 'snippet_direct_build_attempt', properties: props });
}

export function trackSnippetDirectBuildSuccess(props: {
  snippetId: string;
  nodeCount: number;
  plan: 'free' | 'pro';
}): void {
  client.capture({ distinctId: deviceId, event: 'snippet_direct_build_success', properties: props });
}

export function trackSnippetDirectBuildError(props: {
  snippetId: string;
  errorHead: string;
  plan: 'free' | 'pro';
}): void {
  client.capture({ distinctId: deviceId, event: 'snippet_direct_build_error', properties: props });
}

export function trackEngineSetupStarted(props: { engineType: string }): void {
  client.capture({ distinctId: deviceId, event: 'engine_setup_started', properties: props });
}

export function trackEngineSetupFailed(props: {
  engineType: string;
  stage: 'select' | 'path' | 'mcp' | 'handshake' | 'deps' | 'other';
  errorClass: ErrorClass;
}): void {
  client.capture({ distinctId: deviceId, event: 'engine_setup_failed', properties: props });
}

export function trackGuidedStepGenerated(props: {
  stepIndex: number;
  engineType: string | null;
}): void {
  client.capture({ distinctId: deviceId, event: 'guided_step_generated', properties: props });
}

export function trackGuidedStepVerified(props: {
  stepIndex: number;
  success: boolean;
  engineType: string | null;
  msSinceGenerated: number;
}): void {
  client.capture({ distinctId: deviceId, event: 'guided_step_verified', properties: props });
}

export function trackConversationStarted(props: {
  threadId: string;
  engineType: string | null;
  plan: 'free' | 'pro';
  email: string | null;
}): void {
  client.capture({ distinctId: deviceId, event: 'conversation_started', properties: props });
}

export function trackConversationEnded(props: {
  threadId: string;
  messageCount: number;
  durationMs: number;
}): void {
  client.capture({ distinctId: deviceId, event: 'conversation_ended', properties: props });
}

// Hashed threadId so we don't leak DB ids directly.
export function hashThreadId(id: string): string {
  return crypto.createHash('sha256').update(id).digest('hex').slice(0, 16);
}
