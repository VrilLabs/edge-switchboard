/**
 * @kronos/edge-switchboard — Tests
 */

import { strict as assert } from 'node:assert';
import { describe, it, beforeEach } from 'mocha';

import {
  Switchboard,
  Router,
  HealthChecker,
  KeyCarousel,
} from './index';

import type {
  Provider,
  SwitchboardConfig,
  SwapRequest,
} from './index';

// ── Test Fixtures ────────────────────────────────────────────────────────────

function makeProvider(overrides?: Partial<Provider>): Provider {
  return {
    id: 'test-provider',
    name: 'Test Provider',
    baseUrl: 'https://api.test.com',
    weight: 10,
    enabled: true,
    ...overrides,
  };
}

function makeConfig(overrides?: Partial<SwitchboardConfig>): SwitchboardConfig {
  return {
    providers: [
      makeProvider({ id: 'alpha', name: 'Alpha', weight: 10 }),
      makeProvider({ id: 'beta', name: 'Beta', weight: 5 }),
    ],
    ...overrides,
  };
}

// ── Switchboard Tests ────────────────────────────────────────────────────────

describe('@kronos/edge-switchboard', () => {
  describe('Switchboard', () => {
    let sb: Switchboard;

    beforeEach(() => {
      sb = new Switchboard(makeConfig());
    });

    it('routes to a provider', () => {
      const provider = sb.route();
      assert.ok(provider);
      assert.ok(['alpha', 'beta'].includes(provider.id));
    });

    it('lists providers', () => {
      const providers = sb.listProviders();
      assert.strictEqual(providers.length, 2);
    });

    it('adds a new provider', () => {
      sb.addProvider(makeProvider({ id: 'gamma', name: 'Gamma', weight: 20 }));
      assert.strictEqual(sb.listProviders().length, 3);
    });

    it('removes a provider', () => {
      assert.ok(sb.removeProvider('alpha'));
      assert.strictEqual(sb.listProviders().length, 1);
    });

    it('returns false when removing non-existent provider', () => {
      assert.strictEqual(sb.removeProvider('nonexistent'), false);
    });

    it('hot-swaps a provider', () => {
      const result = sb.swap({
        providerId: 'alpha',
        update: { baseUrl: 'https://new-api.test.com', weight: 20 },
      });
      assert.strictEqual(result.providerId, 'alpha');
      assert.ok(result.previousConfig);
      assert.strictEqual(result.newConfig.baseUrl, 'https://new-api.test.com');
      assert.strictEqual(result.newConfig.weight, 20);
    });

    it('hot-swaps creates new provider if not found', () => {
      const result = sb.swap({
        providerId: 'delta',
        update: { baseUrl: 'https://delta.test.com', weight: 1 },
      });
      assert.strictEqual(result.previousConfig, null);
      assert.strictEqual(result.newConfig.id, 'delta');
      assert.strictEqual(sb.listProviders().length, 3);
    });

    it('returns status', () => {
      const s = sb.status();
      assert.strictEqual(s.providers.total, 2);
      assert.ok(typeof s.timestamp === 'number');
    });

    it('destroy does not throw', () => {
      assert.doesNotThrow(() => sb.destroy());
    });
  });

  // ── Router Tests ─────────────────────────────────────────────────────────

  describe('Router', () => {
    it('selects from healthy providers', () => {
      const hc = new HealthChecker();
      const router = new Router(hc, { strategy: 'failover' });
      const providers = [
        makeProvider({ id: 'a', weight: 10 }),
        makeProvider({ id: 'b', weight: 5 }),
      ];
      const selected = router.select(providers);
      assert.ok(selected);
      assert.strictEqual(selected.id, 'a'); // failover picks highest weight
    });

    it('returns null when no providers are available', () => {
      const hc = new HealthChecker();
      const router = new Router(hc);
      const selected = router.select([]);
      assert.strictEqual(selected, null);
    });

    it('round-robin cycles through providers', () => {
      const hc = new HealthChecker();
      const router = new Router(hc, { strategy: 'round-robin' });
      const providers = [
        makeProvider({ id: 'a' }),
        makeProvider({ id: 'b' }),
        makeProvider({ id: 'c' }),
      ];
      const first = router.select(providers);
      const second = router.select(providers);
      const third = router.select(providers);
      assert.ok(first && second && third);
      // Should cycle through a, b, c
      assert.strictEqual(first.id, 'a');
      assert.strictEqual(second.id, 'b');
      assert.strictEqual(third.id, 'c');
    });

    it('filters by model', () => {
      const hc = new HealthChecker();
      const router = new Router(hc, { strategy: 'failover' });
      const providers = [
        makeProvider({ id: 'a', weight: 10, models: ['gpt-4'] }),
        makeProvider({ id: 'b', weight: 5, models: ['llama-3.3-70b'] }),
      ];
      const selected = router.select(providers, undefined, 'llama-3.3-70b');
      assert.ok(selected);
      assert.strictEqual(selected.id, 'b');
    });

    it('skips disabled providers', () => {
      const hc = new HealthChecker();
      const router = new Router(hc, { strategy: 'failover' });
      const providers = [
        makeProvider({ id: 'a', weight: 10, enabled: false }),
        makeProvider({ id: 'b', weight: 5, enabled: true }),
      ];
      const selected = router.select(providers);
      assert.ok(selected);
      assert.strictEqual(selected.id, 'b');
    });

    it('prunes sticky sessions', () => {
      const hc = new HealthChecker();
      const router = new Router(hc, {
        strategy: 'failover',
        stickySessions: { enabled: true, keySource: 'header', keyName: 'x-session', ttlMs: 0 },
      });
      const providers = [makeProvider({ id: 'a' })];
      router.select(providers, 'sess-1');
      const pruned = router.pruneStickySessions();
      assert.ok(pruned >= 0);
    });
  });

  // ── HealthChecker Tests ──────────────────────────────────────────────────

  describe('HealthChecker', () => {
    it('assumes unknown provider is healthy', () => {
      const hc = new HealthChecker();
      assert.strictEqual(hc.isHealthy('unknown'), true);
    });

    it('checks a provider health with mock fetch', async () => {
      const mockFetch = async () => new Response('ok', { status: 200 });
      const hc = new HealthChecker({ fetchImpl: mockFetch as unknown as typeof fetch });
      const provider = makeProvider({ healthPath: '/healthz' });
      const result = await hc.check(provider);
      assert.strictEqual(result.healthy, true);
      assert.ok(result.latencyMs >= 0);
    });

    it('marks unhealthy after consecutive failures', async () => {
      const mockFetch = async () => new Response('error', { status: 500 });
      const hc = new HealthChecker({
        maxConsecutiveFailures: 2,
        fetchImpl: mockFetch as unknown as typeof fetch,
      });
      const provider = makeProvider();
      await hc.check(provider);
      assert.strictEqual(hc.isHealthy(provider.id), true); // 1 failure < 2
      await hc.check(provider);
      assert.strictEqual(hc.isHealthy(provider.id), false); // 2 failures >= 2
    });

    it('resets health state', async () => {
      const mockFetch = async () => new Response('error', { status: 500 });
      const hc = new HealthChecker({
        maxConsecutiveFailures: 1,
        fetchImpl: mockFetch as unknown as typeof fetch,
      });
      const provider = makeProvider();
      await hc.check(provider);
      assert.strictEqual(hc.isHealthy(provider.id), false);
      hc.reset(provider.id);
      assert.strictEqual(hc.isHealthy(provider.id), true); // Unknown = healthy
    });
  });

  // ── KeyCarousel Tests ────────────────────────────────────────────────────

  describe('KeyCarousel', () => {
    it('registers and selects a key', () => {
      const kc = new KeyCarousel();
      kc.registerKey({
        key: 'sk-test-1',
        org: 'org-1',
        model: 'any',
        tpd: 1_000_000,
        tpm: 100_000,
        rpm: 600,
      });
      const result = kc.select({ model: 'llama-3.3-70b', estimatedTokens: 1000 });
      assert.ok(result);
      assert.strictEqual(result.key, 'sk-test-1');
      assert.strictEqual(result.org, 'org-1');
    });

    it('returns null when quota is exhausted', () => {
      const kc = new KeyCarousel();
      kc.registerKey({
        key: 'sk-test-1',
        org: 'org-1',
        model: 'any',
        tpd: 100,
        tpm: 100,
        rpm: 600,
      });
      const result = kc.select({ model: 'llama-3.3-70b', estimatedTokens: 200 });
      assert.strictEqual(result, null);
    });

    it('selects model-specific keys', () => {
      const kc = new KeyCarousel();
      kc.registerKey({ key: 'sk-gpt', org: 'org-gpt', model: 'gpt-4', tpd: 1_000_000, tpm: 100_000, rpm: 600 });
      kc.registerKey({ key: 'sk-llama', org: 'org-llama', model: 'llama-3.3-70b', tpd: 1_000_000, tpm: 100_000, rpm: 600 });
      const result = kc.select({ model: 'llama-3.3-70b', estimatedTokens: 1000 });
      assert.ok(result);
      assert.strictEqual(result.org, 'org-llama');
    });

    it('reports usage', () => {
      const kc = new KeyCarousel();
      kc.registerKey({ key: 'sk-test', org: 'org-1', model: 'any', tpd: 1_000_000, tpm: 100_000, rpm: 600 });
      kc.report('org-1', 5000);
      const keys = kc.listKeys();
      assert.ok(keys[0].usedToday > 0);
    });

    it('midnight reset clears daily counters', () => {
      const kc = new KeyCarousel();
      kc.registerKey({ key: 'sk-test', org: 'org-1', model: 'any', tpd: 1_000_000, tpm: 100_000, rpm: 600 });
      kc.select({ model: 'any', estimatedTokens: 50000 });
      kc.midnightReset();
      const keys = kc.listKeys();
      assert.strictEqual(keys[0].usedToday, 0);
    });

    it('removes a key', () => {
      const kc = new KeyCarousel();
      kc.registerKey({ key: 'sk-test', org: 'org-1', model: 'any', tpd: 1_000_000, tpm: 100_000, rpm: 600 });
      assert.ok(kc.removeKey('org-1'));
      assert.strictEqual(kc.listKeys().length, 0);
    });

    it('returns false when removing non-existent key', () => {
      const kc = new KeyCarousel();
      assert.strictEqual(kc.removeKey('nonexistent'), false);
    });
  });
});
