/**
 * @kronos/edge-switchboard — Switchboard (main façade)
 *
 * The Switchboard class is the primary public API. It composes the Router,
 * HealthChecker, and KeyCarousel into a single unified interface for:
 *   - Provider management (add/remove/swap)
 *   - Request routing with health-aware load balancing
 *   - Health monitoring
 *   - Key carousel integration
 *   - Hot-swap provider replacement
 */

import type {
  Provider,
  SwitchboardConfig,
  ProviderHealth,
  SwapRequest,
  SwapResult,
  KeySelectRequest,
  KeySelection,
  KeyRecord,
} from './types';
import { HealthChecker } from './health-checker';
import { Router } from './router';
import { KeyCarousel } from './key-carousel';

export class Switchboard {
  private providers: Provider[];
  private readonly healthChecker: HealthChecker;
  private readonly router: Router;
  private readonly keyCarousel: KeyCarousel;
  private readonly defaultHealthCheckIntervalMs: number;
  private healthInterval: ReturnType<typeof setInterval> | null = null;

  constructor(config: SwitchboardConfig) {
    this.providers = [...config.providers];
    this.defaultHealthCheckIntervalMs = config.healthCheckIntervalMs ?? 30000;

    this.healthChecker = new HealthChecker({
      maxConsecutiveFailures: config.maxConsecutiveFailures,
      healthCheckTimeoutMs: config.healthCheckTimeoutMs,
    });

    this.router = new Router(this.healthChecker, {
      strategy: config.strategy,
      stickySessions: config.stickySessions,
    });

    this.keyCarousel = new KeyCarousel();
  }

  // ── Routing ────────────────────────────────────────────────────────────────

  /**
   * Route a request to the best available provider.
   *
   * @param model       Optional model name to filter providers.
   * @param sessionKey  Optional sticky session key.
   * @returns           The selected provider, or null if none are healthy.
   */
  route(model?: string, sessionKey?: string): Provider | null {
    return this.router.select(this.providers, sessionKey, model);
  }

  // ── Health ─────────────────────────────────────────────────────────────────

  /** Run a single health check cycle across all providers. */
  async checkHealth(): Promise<ProviderHealth[]> {
    return this.healthChecker.checkAll(this.providers);
  }

  /** Get current health state for all providers. */
  health(): ProviderHealth[] {
    return this.healthChecker.allHealth();
  }

  /** Get health for a specific provider. */
  providerHealth(providerId: string): ProviderHealth | undefined {
    return this.healthChecker.getHealth(providerId);
  }

  /**
   * Start periodic health checks.
   * @param intervalMs  Check interval in ms. Defaults to config.healthCheckIntervalMs or 30000.
   */
  startHealthChecks(intervalMs?: number): void {
    const interval = intervalMs ?? this.defaultHealthCheckIntervalMs;
    this.stopHealthChecks();
    this.healthInterval = setInterval(() => {
      this.checkHealth().catch(() => {});
    }, interval);
  }

  /** Stop periodic health checks. */
  stopHealthChecks(): void {
    if (this.healthInterval !== null) {
      clearInterval(this.healthInterval);
      this.healthInterval = null;
    }
  }

  // ── Provider Management ────────────────────────────────────────────────────

  /** List all configured providers. */
  listProviders(): ReadonlyArray<Readonly<Provider>> {
    return this.providers;
  }

  /** Add a new provider. */
  addProvider(provider: Provider): void {
    const existing = this.providers.findIndex(p => p.id === provider.id);
    if (existing !== -1) {
      this.providers[existing] = provider;
    } else {
      this.providers.push(provider);
    }
  }

  /** Remove a provider by ID. Returns true if found and removed. */
  removeProvider(providerId: string): boolean {
    const idx = this.providers.findIndex(p => p.id === providerId);
    if (idx === -1) return false;
    this.providers.splice(idx, 1);
    this.healthChecker.reset(providerId);
    return true;
  }

  // ── Hot-Swap ───────────────────────────────────────────────────────────────

  /**
   * Hot-swap a provider's configuration without downtime.
   * Merges partial updates into the existing provider config.
   */
  swap(request: SwapRequest): SwapResult {
    const idx = this.providers.findIndex(p => p.id === request.providerId);
    const previous = idx !== -1 ? { ...this.providers[idx] } : null;

    const merged: Provider = previous
      ? { ...previous, ...request.update, id: request.providerId }
      : { id: request.providerId, name: request.providerId, baseUrl: '', weight: 1, enabled: true, ...request.update };

    if (idx !== -1) {
      this.providers[idx] = merged;
    } else {
      this.providers.push(merged);
    }

    // Reset health state for the swapped provider
    this.healthChecker.reset(request.providerId);

    return {
      providerId: request.providerId,
      previousConfig: previous,
      newConfig: merged,
      timestamp: Date.now(),
    };
  }

  // ── Key Carousel ───────────────────────────────────────────────────────────

  /** Register a key in the carousel. */
  registerKey(record: Omit<KeyRecord, 'usedToday' | 'usedThisMinute' | 'requestsThisMinute' | 'lastMinuteMark'>): void {
    this.keyCarousel.registerKey(record);
  }

  /** Select the best key for a request. */
  selectKey(request: KeySelectRequest): KeySelection | null {
    return this.keyCarousel.select(request);
  }

  /** Report actual key usage after request completion. */
  reportKeyUsage(org: string, actualTokens: number, headers?: Record<string, string>): void {
    this.keyCarousel.report(org, actualTokens, headers);
  }

  /** Reset daily key counters. */
  midnightReset(): void {
    this.keyCarousel.midnightReset();
  }

  // ── Lifecycle ──────────────────────────────────────────────────────────────

  /** Clean shutdown: stop health checks and prune sessions. */
  destroy(): void {
    this.stopHealthChecks();
    this.router.pruneStickySessions();
  }

  // ── Status ─────────────────────────────────────────────────────────────────

  /** Return a summary status object suitable for a /status endpoint. */
  status(): {
    providers: { total: number; healthy: number; unhealthy: number };
    keys: { total: number };
    timestamp: number;
  } {
    const allHealth = this.healthChecker.allHealth();
    const healthy = allHealth.filter(h => h.healthy).length;
    return {
      providers: {
        total: this.providers.length,
        healthy,
        unhealthy: this.providers.length - healthy,
      },
      keys: { total: this.keyCarousel.listKeys().length },
      timestamp: Date.now(),
    };
  }
}
