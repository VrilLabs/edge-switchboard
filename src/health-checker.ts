/**
 * @kronos/edge-switchboard — Health Checker
 *
 * Periodically probes backend providers and maintains health state.
 * Unhealthy providers are automatically excluded from routing until
 * they recover.
 */

import type { Provider, ProviderHealth } from './types';

/** Default health check timeout (ms). */
const DEFAULT_TIMEOUT_MS = 5000;

/** Default max consecutive failures before marking unhealthy. */
const DEFAULT_MAX_FAILURES = 3;

export class HealthChecker {
  private readonly health: Map<string, ProviderHealth> = new Map();
  private readonly maxFailures: number;
  private readonly timeoutMs: number;
  private readonly fetchImpl: typeof fetch;

  constructor(options?: {
    maxConsecutiveFailures?: number;
    healthCheckTimeoutMs?: number;
    fetchImpl?: typeof fetch;
  }) {
    this.maxFailures = options?.maxConsecutiveFailures ?? DEFAULT_MAX_FAILURES;
    this.timeoutMs = options?.healthCheckTimeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.fetchImpl = options?.fetchImpl ?? globalFetch();
  }

  /** Get the current health status for a provider. */
  getHealth(providerId: string): ProviderHealth | undefined {
    return this.health.get(providerId);
  }

  /** Returns true if the provider is considered healthy. */
  isHealthy(providerId: string): boolean {
    const h = this.health.get(providerId);
    if (!h) return true; // Unknown = assume healthy until first check
    return h.healthy;
  }

  /** Get all health records. */
  allHealth(): ProviderHealth[] {
    return [...this.health.values()];
  }

  /**
   * Check health of a single provider.
   * Sends a GET to `baseUrl + healthPath` (default: '/health').
   */
  async check(provider: Provider): Promise<ProviderHealth> {
    const healthPath = provider.healthPath ?? '/health';
    const url = `${provider.baseUrl.replace(/\/$/, '')}${healthPath}`;
    const start = Date.now();

    let existing = this.health.get(provider.id);
    if (!existing) {
      existing = {
        id: provider.id,
        healthy: true,
        latencyMs: 0,
        lastChecked: 0,
        consecutiveFailures: 0,
      };
      this.health.set(provider.id, existing);
    }

    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), this.timeoutMs);
      const response = await this.fetchImpl(url, {
        method: 'GET',
        signal: controller.signal,
        headers: provider.headers ?? {},
      });
      clearTimeout(timer);

      const latencyMs = Date.now() - start;

      if (response.ok) {
        existing.healthy = true;
        existing.latencyMs = latencyMs;
        existing.consecutiveFailures = 0;
        existing.error = undefined;
      } else {
        existing.consecutiveFailures++;
        existing.latencyMs = latencyMs;
        existing.error = `HTTP ${response.status}`;
        existing.healthy = existing.consecutiveFailures < this.maxFailures;
      }
    } catch (e: unknown) {
      existing.consecutiveFailures++;
      existing.latencyMs = Date.now() - start;
      existing.error = e instanceof Error ? e.message : String(e);
      existing.healthy = existing.consecutiveFailures < this.maxFailures;
    }

    existing.lastChecked = Date.now();
    return { ...existing };
  }

  /** Check all providers in parallel. */
  async checkAll(providers: Provider[]): Promise<ProviderHealth[]> {
    return Promise.all(providers.filter(p => p.enabled).map(p => this.check(p)));
  }

  /** Reset health state for a provider (e.g., after hot-swap). */
  reset(providerId: string): void {
    this.health.delete(providerId);
  }
}

/** Resolve global fetch (Node 18+ or browser). */
function globalFetch(): typeof fetch {
  if (typeof globalThis.fetch === 'function') {
    return globalThis.fetch.bind(globalThis);
  }
  throw new Error('@kronos/edge-switchboard: global fetch is not available');
}
