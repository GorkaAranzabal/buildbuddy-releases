import type { StorageService } from './storageService';
import type { EntitlementService } from './entitlementService';

// ============ Configuration — edit these to tune fair-use limits ============

const WINDOW_MS           = 10 * 60 * 1000;          // 10-minute sliding window
const CHAT_LIMIT          = 30;                        // max chat requests per window
const RC_LIMIT            = 12;                        // max remote-control requests per window
const VIOLATION_WINDOW_MS = 60 * 60 * 1000;           // violations within 1 h escalate timeout
const TIMEOUT_DURATIONS   = [15, 30, 60].map(m => m * 60 * 1000); // 15 → 30 → 60 min in ms

// ===========================================================================

export type FairUseRequestType = 'chat' | 'rc';

export interface FairUseCheckResult {
  allowed: boolean;
  unlockedAt?: number;
  reason?: string;
}

export class FairUseService {
  constructor(
    private storageService: StorageService,
    private entitlementService: EntitlementService,
  ) {}

  async checkRequest(type: FairUseRequestType): Promise<FairUseCheckResult> {
    // 1. devMode bypass
    const settings = await this.storageService.getSettings();
    if (settings.devMode) return { allowed: true };

    // 2. Pro-only — free users are handled by the entitlement weekly limit
    if (!this.entitlementService.isPro()) return { allowed: true };

    // 3. Load persisted state (all timestamps are absolute epoch ms → survives restarts)
    const state = await this.storageService.getFairUseState();

    const now = Date.now();

    // 4. Active timeout check
    if (state.timeoutUntil !== null && now < state.timeoutUntil) {
      return { allowed: false, unlockedAt: state.timeoutUntil, reason: 'Fair-use timeout active' };
    }

    // 5. Prune old entries
    state.chatTimestamps = state.chatTimestamps.filter(t => now - t < WINDOW_MS);
    state.rcTimestamps   = state.rcTimestamps.filter(t => now - t < WINDOW_MS);
    state.violations     = state.violations.filter(t => now - t < VIOLATION_WINDOW_MS);
    if (state.timeoutUntil !== null && now >= state.timeoutUntil) {
      state.timeoutUntil = null;
    }

    // 6. Count requests in the current window
    const timestamps = type === 'chat' ? state.chatTimestamps : state.rcTimestamps;
    const limit      = type === 'chat' ? CHAT_LIMIT : RC_LIMIT;

    if (timestamps.length >= limit) {
      // Record violation and set escalating timeout
      state.violations.push(now);
      const durIdx = Math.min(state.violations.length - 1, TIMEOUT_DURATIONS.length - 1);
      state.timeoutUntil = now + TIMEOUT_DURATIONS[durIdx];
      await this.storageService.setFairUseState(state);
      return {
        allowed: false,
        unlockedAt: state.timeoutUntil,
        reason: 'Rate limit exceeded',
      };
    }

    // 7. Allowed — record this request's timestamp
    timestamps.push(now);
    await this.storageService.setFairUseState(state);
    return { allowed: true };
  }
}
