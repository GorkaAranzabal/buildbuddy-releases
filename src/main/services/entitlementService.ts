import type { AuthState, EntitlementData, DailyUsage } from '../../shared/types';
import { StorageService } from './storageService';

const ENTITLEMENT_API_URL = 'https://build-buddy.app/api/entitlements';
const FREE_WEEKLY_LIMIT = 10;
const CACHE_DURATION_MS = 5 * 60 * 1000; // 5 minutes

export class EntitlementService {
  private storageService: StorageService;
  private cachedEntitlement: EntitlementData | null = null;
  private cacheTimestamp: number = 0;

  constructor(storageService: StorageService) {
    this.storageService = storageService;
  }

  async login(email: string): Promise<AuthState> {
    const normalizedEmail = email.trim().toLowerCase();

    await this.storageService.setAuthEmail(normalizedEmail);
    await this.storageService.resetDailyUsage();

    let entitlement: EntitlementData;
    try {
      entitlement = await this.fetchEntitlement(normalizedEmail);
    } catch (error) {
      console.error('[Entitlement] API unavailable during login, falling back to free tier:', error);
      entitlement = this.getDefaultFreeEntitlement(normalizedEmail);
    }

    this.cachedEntitlement = entitlement;
    this.cacheTimestamp = Date.now();

    return {
      email: normalizedEmail,
      entitlement,
      isLoggedIn: true,
    };
  }

  async logout(): Promise<void> {
    await this.storageService.setAuthEmail(null);
    this.cachedEntitlement = null;
    this.cacheTimestamp = 0;
  }

  async getAuthState(): Promise<AuthState> {
    const email = await this.storageService.getAuthEmail();

    if (!email) {
      return { email: null, entitlement: null, isLoggedIn: false };
    }

    // Use cache if fresh
    if (this.cachedEntitlement && (Date.now() - this.cacheTimestamp) < CACHE_DURATION_MS) {
      return { email, entitlement: this.cachedEntitlement, isLoggedIn: true };
    }

    try {
      const entitlement = await this.fetchEntitlement(email);
      this.cachedEntitlement = entitlement;
      this.cacheTimestamp = Date.now();
      return { email, entitlement, isLoggedIn: true };
    } catch (error) {
      console.error('[Entitlement] Failed to fetch entitlement:', error);
      // Graceful degradation: fall back to free tier
      const fallback = this.getDefaultFreeEntitlement(email);
      this.cachedEntitlement = fallback;
      this.cacheTimestamp = Date.now();
      return { email, entitlement: fallback, isLoggedIn: true };
    }
  }

  async checkCanAsk(): Promise<{ allowed: boolean; reason?: string; remainingAsks?: number }> {
    // Dev mode: bypass all limits
    const settings = await this.storageService.getSettings();
    if (settings.devMode) {
      return { allowed: true };
    }

    const authState = await this.getAuthState();

    if (!authState.isLoggedIn || !authState.entitlement) {
      return { allowed: false, reason: 'Not logged in' };
    }

    // Pro users: always allowed
    if (authState.entitlement.active && authState.entitlement.features.unlimited_asks) {
      return { allowed: true };
    }

    // Free users: check weekly limit
    const usage = await this.storageService.getDailyUsage();
    const limit = authState.entitlement.features.daily_limit ?? FREE_WEEKLY_LIMIT;
    const remaining = limit - usage.askCount;

    if (remaining <= 0) {
      return {
        allowed: false,
        reason: `You've used all ${limit} free asks for this week. Upgrade to Pro for unlimited asks!`,
        remainingAsks: 0,
      };
    }

    return { allowed: true, remainingAsks: remaining };
  }

  async recordAsk(): Promise<DailyUsage> {
    return this.storageService.incrementDailyUsage();
  }

  async checkEntitlement(email: string): Promise<EntitlementData> {
    const normalizedEmail = email.trim().toLowerCase();
    try {
      return await this.fetchEntitlement(normalizedEmail);
    } catch {
      return this.getDefaultFreeEntitlement(normalizedEmail);
    }
  }

  isPro(): boolean {
    return this.cachedEntitlement?.active === true;
  }

  private async fetchEntitlement(email: string): Promise<EntitlementData> {
    const url = `${ENTITLEMENT_API_URL}?email=${encodeURIComponent(email)}`;

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 8000);

    const response = await fetch(url, {
      method: 'GET',
      headers: { 'Content-Type': 'application/json' },
      signal: controller.signal,
    }).finally(() => clearTimeout(timeoutId));

    if (!response.ok) {
      throw new Error(`Entitlement API error: ${response.status} ${response.statusText}`);
    }

    return (await response.json()) as EntitlementData;
  }

  private getDefaultFreeEntitlement(email: string): EntitlementData {
    return {
      active: false,
      plan: 'free',
      email,
      features: {
        unlimited_asks: false,
        faster_responses: false,
        best_model: false,
        daily_limit: FREE_WEEKLY_LIMIT,
      },
    };
  }
}
