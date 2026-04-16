/**
 * @kronos/edge-switchboard — Router
 *
 * Selects a healthy backend provider based on the configured routing strategy:
 *   - weighted-random: probability proportional to provider weight
 *   - round-robin: cycle through healthy providers in order
 *   - lowest-latency: pick the provider with the lowest last-observed latency
 *   - failover: always pick the first healthy provider (ordered by weight desc)
 *
 * Supports sticky sessions: if a session key is present, route to the same
 * provider until TTL expires or the provider becomes unhealthy.
 */

import type {
  Provider,
  RoutingStrategy,
  StickySessionConfig,
} from './types';
import { HealthChecker } from './health-checker';

export class Router {
  private readonly strategy: RoutingStrategy;
  private readonly stickyCfg: StickySessionConfig | null;
  private readonly stickyMap: Map<string, { providerId: string; expiresAt: number }> = new Map();
  private roundRobinIndex = 0;

  constructor(
    private readonly healthChecker: HealthChecker,
    options?: {
      strategy?: RoutingStrategy;
      stickySessions?: StickySessionConfig;
    },
  ) {
    this.strategy = options?.strategy ?? 'weighted-random';
    this.stickyCfg = options?.stickySessions?.enabled ? options.stickySessions : null;
  }

  /**
   * Select a provider from the list.
   *
   * @param providers    All configured providers.
   * @param sessionKey   Optional sticky session key (extracted from request).
   * @param model        Optional model filter — only match providers that serve this model.
   * @returns            The selected provider, or null if none are available.
   */
  select(
    providers: Provider[],
    sessionKey?: string,
    model?: string,
  ): Provider | null {
    // Filter to enabled + healthy
    let candidates = providers.filter(p =>
      p.enabled && this.healthChecker.isHealthy(p.id),
    );

    // Model filter
    if (model) {
      const modelCandidates = candidates.filter(
        p => !p.models || p.models.length === 0 || p.models.includes(model),
      );
      if (modelCandidates.length > 0) {
        candidates = modelCandidates;
      }
    }

    if (candidates.length === 0) return null;

    // Sticky session: return existing affinity if valid
    if (this.stickyCfg && sessionKey) {
      const sticky = this.stickyMap.get(sessionKey);
      if (sticky && sticky.expiresAt > Date.now()) {
        const found = candidates.find(p => p.id === sticky.providerId);
        if (found) return found;
      }
      // Expired or unhealthy — clear and re-select
      this.stickyMap.delete(sessionKey);
    }

    let selected: Provider;

    switch (this.strategy) {
      case 'weighted-random':
        selected = this.weightedRandom(candidates);
        break;
      case 'round-robin':
        selected = this.roundRobin(candidates);
        break;
      case 'lowest-latency':
        selected = this.lowestLatency(candidates);
        break;
      case 'failover':
        selected = this.failover(candidates);
        break;
      default:
        selected = candidates[0];
    }

    // Record sticky session affinity
    if (this.stickyCfg && sessionKey) {
      const ttl = this.stickyCfg.ttlMs ?? 3600000;
      this.stickyMap.set(sessionKey, {
        providerId: selected.id,
        expiresAt: Date.now() + ttl,
      });
    }

    return selected;
  }

  /** Evict expired sticky sessions (call periodically). */
  pruneStickySessions(): number {
    const now = Date.now();
    let pruned = 0;
    for (const [key, value] of this.stickyMap) {
      if (value.expiresAt <= now) {
        this.stickyMap.delete(key);
        pruned++;
      }
    }
    return pruned;
  }

  // ── Strategy Implementations ─────────────────────────────────────────────

  private weightedRandom(candidates: Provider[]): Provider {
    const totalWeight = candidates.reduce((sum, p) => sum + p.weight, 0);
    if (totalWeight === 0) return candidates[0];

    let rand = Math.random() * totalWeight;
    for (const p of candidates) {
      rand -= p.weight;
      if (rand <= 0) return p;
    }
    return candidates[candidates.length - 1];
  }

  private roundRobin(candidates: Provider[]): Provider {
    const idx = this.roundRobinIndex % candidates.length;
    this.roundRobinIndex = this.roundRobinIndex + 1;
    return candidates[idx];
  }

  private lowestLatency(candidates: Provider[]): Provider {
    let best = candidates[0];
    let bestLatency = Infinity;
    for (const p of candidates) {
      const h = this.healthChecker.getHealth(p.id);
      const lat = h?.latencyMs ?? Infinity;
      if (lat < bestLatency) {
        bestLatency = lat;
        best = p;
      }
    }
    return best;
  }

  private failover(candidates: Provider[]): Provider {
    // Pick the candidate with the highest weight (primary provider)
    let best = candidates[0];
    for (let i = 1; i < candidates.length; i++) {
      if (candidates[i].weight > best.weight) best = candidates[i];
    }
    return best;
  }
}
