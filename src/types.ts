/**
 * @kronos/edge-switchboard — Types
 *
 * Shared type definitions for the edge switchboard runtime.
 */

// ── Provider ─────────────────────────────────────────────────────────────────

/** A backend provider that the switchboard can route to. */
export interface Provider {
  /** Unique provider identifier (e.g. 'cerebras-org1', 'openrouter-free'). */
  id: string;
  /** Display name. */
  name: string;
  /** Base URL for the provider's API. */
  baseUrl: string;
  /** Relative weight for weighted routing (higher = more traffic). */
  weight: number;
  /** Whether this provider is currently enabled. */
  enabled: boolean;
  /** Optional model filter — routes only matching model requests here. */
  models?: string[];
  /** Optional health endpoint path (appended to baseUrl). */
  healthPath?: string;
  /** Provider-specific headers to inject. */
  headers?: Record<string, string>;
}

/** Health status of a single provider. */
export interface ProviderHealth {
  id: string;
  healthy: boolean;
  latencyMs: number;
  lastChecked: number;
  consecutiveFailures: number;
  error?: string;
}

// ── Routing ──────────────────────────────────────────────────────────────────

/** Routing strategy for provider selection. */
export type RoutingStrategy = 'weighted-random' | 'round-robin' | 'lowest-latency' | 'failover';

/** Sticky session configuration. */
export interface StickySessionConfig {
  /** Enable sticky sessions. */
  enabled: boolean;
  /** Header or cookie name to extract session key from. */
  keySource: 'header' | 'cookie';
  /** Name of the header or cookie. */
  keyName: string;
  /** TTL for sticky session affinity (ms). Default: 3600000 (1h). */
  ttlMs?: number;
}

/** Full switchboard configuration. */
export interface SwitchboardConfig {
  /** List of backend providers. */
  providers: Provider[];
  /** Routing strategy. Default: 'weighted-random'. */
  strategy?: RoutingStrategy;
  /** Health check interval (ms). Default: 30000. */
  healthCheckIntervalMs?: number;
  /** Max consecutive failures before marking provider unhealthy. */
  maxConsecutiveFailures?: number;
  /** Health check timeout (ms). Default: 5000. */
  healthCheckTimeoutMs?: number;
  /** Sticky session config. */
  stickySessions?: StickySessionConfig;
  /** Auth token for the switchboard control plane API. */
  authToken?: string;
}

// ── Key Carousel ─────────────────────────────────────────────────────────────

/** A key registered in the carousel for rate-limit-aware rotation. */
export interface KeyRecord {
  key: string;
  org: string;
  model: string;
  /** Tokens per day limit. */
  tpd: number;
  /** Tokens per minute limit. */
  tpm: number;
  /** Requests per minute limit. */
  rpm: number;
  usedToday: number;
  usedThisMinute: number;
  requestsThisMinute: number;
  lastMinuteMark: number;
}

/** Result of a key selection. */
export interface KeySelection {
  key: string;
  org: string;
}

/** Key selection request. */
export interface KeySelectRequest {
  model: string;
  estimatedTokens: number;
}

// ── Swap ─────────────────────────────────────────────────────────────────────

/** A hot-swap request to replace or update a provider. */
export interface SwapRequest {
  /** Provider ID to swap. */
  providerId: string;
  /** New provider config (partial — merges with existing). */
  update: Partial<Provider>;
}

/** Result of a hot-swap operation. */
export interface SwapResult {
  providerId: string;
  previousConfig: Provider | null;
  newConfig: Provider;
  timestamp: number;
}
