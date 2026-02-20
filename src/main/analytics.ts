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
