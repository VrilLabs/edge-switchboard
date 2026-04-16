/**
 * @kronos/edge-switchboard — Public API
 *
 * Re-exports the key classes and types for the edge switchboard.
 */

export { Switchboard } from './switchboard';
export { Router } from './router';
export { HealthChecker } from './health-checker';
export { KeyCarousel } from './key-carousel';

export type {
  Provider,
  ProviderHealth,
  RoutingStrategy,
  StickySessionConfig,
  SwitchboardConfig,
  KeyRecord,
  KeySelection,
  KeySelectRequest,
  SwapRequest,
  SwapResult,
} from './types';
