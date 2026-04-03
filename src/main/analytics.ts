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

export interface AIRequestEventProps {
  requestType: 'chat' | 'rc' | 'guided';
  model: string;
  engineType: string | null;
  engineConnected: boolean;
  hadScreenshot: boolean;
  promptLengthChars: number;
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
