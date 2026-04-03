import type { AuthState, EntitlementData, DailyUsage } from '../../shared/types';
import { StorageService } from './storageService';

const ENTITLEMENT_API_URL = 'https://build-buddy.app/api/entitlements';
const PROXY_SESSION_API_URL = 'https://build-buddy.app/api/session';
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

    // Clear stale cache so we always do a fresh fetch on login
    this.cachedEntitlement = null;
    this.cacheTimestamp = 0;

    let entitlement: EntitlementData;
    try {
      entitlement = await this.fetchEntitlement(normalizedEmail);

      // If the API returned non-pro, retry up to 2 more times with a short delay.
      // This covers users who just purchased (webhook may not have fired yet) or
      // transient network hiccups that can cause the API to return stale data.
      if (!entitlement.active) {
        for (let attempt = 1; attempt <= 2; attempt++) {
          await new Promise(resolve => setTimeout(resolve, 2000 * attempt));
          try {
            const retry = await this.fetchEntitlement(normalizedEmail);
            if (retry.active) {
              entitlement = retry;
              break;
            }
          } catch {
            // ignore retry error, keep previous result
          }
        }
      }
    } catch (error) {
      console.error('[Entitlement] API unavailable during login, falling back to free tier:', error);
      entitlement = this.getDefaultFreeEntitlement(normalizedEmail);
    }

    this.cachedEntitlement = entitlement;
    this.cacheTimestamp = Date.now();

    // Fetch a proxy session token so AI calls can be routed through the backend
    // proxy without embedding API keys in the app bundle. Failure is non-fatal —
    // the app falls back to any bundled key that may exist (dev builds).
    try {
      await this.refreshProxyToken(normalizedEmail);
    } catch (error) {
      console.warn('[Entitlement] Could not fetch proxy session token:', error);
    }

    return {
      email: normalizedEmail,
      entitlement,
      isLoggedIn: true,
    };
  }

  async logout(): Promise<void> {
    await this.storageService.setAuthEmail(null);
    await this.storageService.clearProxyToken();
    this.cachedEntitlement = null;
    this.cacheTimestamp = 0;
  }

  async getProxyToken(): Promise<{ token: string; expiresAt: number } | null> {
    return this.storageService.getProxyToken();
  }

  async refreshProxyToken(email: string): Promise<{ token: string; expiresAt: number }> {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 8000);

    const response = await fetch(PROXY_SESSION_API_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email }),
      signal: controller.signal,
    }).finally(() => clearTimeout(timeoutId));

    if (!response.ok) {
      throw new Error(`Session API error: ${response.status}`);
    }

    const data = (await response.json()) as { token: string; expiresAt: number };
    await this.storageService.setProxyToken(data.token, data.expiresAt);
    return data;
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
    if (authState.entitlement.active && authState.entitlement.features?.unlimited_asks) {
      return { allowed: true };
    }

    // Free users: check weekly limit
    const usage = await this.storageService.getDailyUsage();
    const limit = authState.entitlement.features?.daily_limit ?? FREE_WEEKLY_LIMIT;
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
      const entitlement = await this.fetchEntitlement(normalizedEmail);
      // Always update the cache so subsequent checkCanAsk() calls use the fresh result
      this.cachedEntitlement = entitlement;
      this.cacheTimestamp = Date.now();
      return entitlement;
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

    const data = (await response.json()) as EntitlementData;
    if (!data.features) {
      data.features = {
        unlimited_asks: false,
        faster_responses: false,
        best_model: false,
        daily_limit: FREE_WEEKLY_LIMIT,
      };
    }
    return data;
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
