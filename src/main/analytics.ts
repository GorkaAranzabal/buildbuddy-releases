import { PostHog } from 'posthog-node';
import { app } from 'electron';
import path from 'path';
import fs from 'fs';
import crypto from 'crypto';

const POSTHOG_KEY = 'phc_mnQ2krLb8g9PzjXTSISJkAgODsk3wl4v7T2HuuUdBWJ'; // public key, safe to commit
const POSTHOG_HOST = 'https://us.i.posthog.com';

let client: PostHog;
let deviceId: string;

function loadOrCreateDeviceId(): string {
  const filePath = path.join(app.getPath('userData'), 'device-id.txt');
  if (fs.existsSync(filePath)) {
    return fs.readFileSync(filePath, 'utf-8').trim();
  }
  const id = crypto.randomUUID();
  fs.writeFileSync(filePath, id, 'utf-8');
  return id;
}

export function initAnalytics(): void {
  deviceId = loadOrCreateDeviceId();
  client = new PostHog(POSTHOG_KEY, { host: POSTHOG_HOST });
}

export function trackAppLaunched(): void {
  client.capture({ distinctId: deviceId, event: 'app_launched' });
}

export function trackPlanIdentified(plan: 'free' | 'pro'): void {
  client.identify({ distinctId: deviceId, properties: { plan } });
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
