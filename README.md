# @kronos/edge-switchboard

> Edge proxy switchboard — hot-swap provider routing, weighted load balancing, health checks, sticky sessions, and key carousel integration for Cloudflare Workers.

## Why

Modern AI applications route to multiple inference providers (Cerebras, OpenRouter, Anthropic, OpenAI) and need to hot-swap between them without downtime. Existing proxy tooling either requires a full WebContainers runtime or is a simple round-robin with no health awareness.

**`@kronos/edge-switchboard`** provides the complete switching fabric:

- **Weighted routing** — distribute traffic by provider weight
- **Health monitoring** — automatic provider failure detection with configurable thresholds
- **Hot-swap** — replace provider configs at runtime without dropping requests
- **Sticky sessions** — pin sessions to providers via header or cookie
- **Key carousel** — rate-limit-aware API key rotation across multiple orgs
- **Multiple strategies** — weighted-random, round-robin, lowest-latency, failover

## Install

```bash
npm install @kronos/edge-switchboard
```

## Quick Start

```typescript
import { Switchboard } from '@kronos/edge-switchboard';

const sb = new Switchboard({
  providers: [
    { id: 'cerebras', name: 'Cerebras', baseUrl: 'https://api.cerebras.ai/v1', weight: 10, enabled: true },
    { id: 'openrouter', name: 'OpenRouter', baseUrl: 'https://openrouter.ai/api/v1', weight: 5, enabled: true },
  ],
  strategy: 'weighted-random',
});

// Route a request
const provider = sb.route('llama-3.3-70b');
if (provider) {
  const response = await fetch(`${provider.baseUrl}/chat/completions`, { ... });
}

// Hot-swap a provider
sb.swap({ providerId: 'cerebras', update: { baseUrl: 'https://new-cerebras.ai/v1' } });

// Health monitoring
sb.startHealthChecks(30000);
```

## API

### `new Switchboard(config)`

Create a switchboard instance.

**Config:**
| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `providers` | `Provider[]` | required | Backend providers |
| `strategy` | `RoutingStrategy` | `'weighted-random'` | Routing strategy |
| `healthCheckIntervalMs` | `number` | `30000` | Health check interval |
| `maxConsecutiveFailures` | `number` | `3` | Failures before marking unhealthy |
| `healthCheckTimeoutMs` | `number` | `5000` | Health check timeout |
| `stickySessions` | `StickySessionConfig` | - | Sticky session config |

### Routing

- **`route(model?, sessionKey?)`** — Select the best provider
- **`listProviders()`** — List all providers
- **`addProvider(provider)`** — Add a new provider
- **`removeProvider(id)`** — Remove a provider

### Health

- **`checkHealth()`** — Run health checks
- **`health()`** — Get all health records
- **`startHealthChecks(intervalMs)`** — Start periodic checks
- **`stopHealthChecks()`** — Stop periodic checks

### Hot-Swap

- **`swap({ providerId, update })`** — Hot-swap a provider's config

### Key Carousel

- **`registerKey(record)`** — Register an API key
- **`selectKey({ model, estimatedTokens })`** — Select best key
- **`reportKeyUsage(org, tokens, headers?)`** — Report actual usage
- **`midnightReset()`** — Reset daily counters

### Lifecycle

- **`status()`** — Get aggregate status
- **`destroy()`** — Clean shutdown

## License

MIT
