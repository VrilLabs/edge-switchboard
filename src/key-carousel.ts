/**
 * @kronos/edge-switchboard — Key Carousel
 *
 * Rate-limit-aware API key rotation. Tracks per-key usage (tokens/day,
 * tokens/minute, requests/minute) and selects the healthiest key for each
 * outgoing request. Inspired by the KRONOS Key Carousel Durable Object.
 *
 * In standalone mode this class runs in-process. In edge deployments it
 * can be backed by a Cloudflare Durable Object for distributed state.
 */

import type { KeyRecord, KeySelection, KeySelectRequest } from './types';

export class KeyCarousel {
  private readonly keys: KeyRecord[] = [];

  /** Register a new key in the carousel. */
  registerKey(record: Omit<KeyRecord, 'usedToday' | 'usedThisMinute' | 'requestsThisMinute' | 'lastMinuteMark'>): void {
    this.keys.push({
      ...record,
      usedToday: 0,
      usedThisMinute: 0,
      requestsThisMinute: 0,
      lastMinuteMark: Date.now(),
    });
  }

  /** Return all registered keys (read-only snapshot). */
  listKeys(): ReadonlyArray<Readonly<KeyRecord>> {
    return this.keys;
  }

  /**
   * Select the best key for the given request.
   * Returns null if all keys are quota-exhausted.
   */
  select(request: KeySelectRequest): KeySelection | null {
    const now = Date.now();
    const oneMinAgo = now - 60_000;

    // Decay per-minute counters
    for (const k of this.keys) {
      if (k.lastMinuteMark < oneMinAgo) {
        k.usedThisMinute = 0;
        k.requestsThisMinute = 0;
        k.lastMinuteMark = now;
      } else {
        const elapsedFraction = Math.min(1, (now - k.lastMinuteMark) / 60_000);
        k.usedThisMinute = Math.max(
          0,
          k.usedThisMinute - Math.floor(elapsedFraction * k.tpm),
        );
        k.requestsThisMinute = Math.max(
          0,
          k.requestsThisMinute - Math.floor(elapsedFraction * k.rpm),
        );
      }
    }

    // Filter and score candidates
    const scored = this.keys
      .filter(k => k.model === request.model || k.model === 'any')
      .filter(k => (k.tpd - k.usedToday) >= request.estimatedTokens)
      .filter(k => (k.tpm - k.usedThisMinute) >= request.estimatedTokens)
      .filter(k => k.requestsThisMinute < k.rpm)
      .sort((a, b) => {
        const scoreA = (a.tpd - a.usedToday) * 0.3 + (a.tpm - a.usedThisMinute) * 0.7;
        const scoreB = (b.tpd - b.usedToday) * 0.3 + (b.tpm - b.usedThisMinute) * 0.7;
        return scoreB - scoreA;
      });

    if (scored.length === 0) return null;

    const chosen = scored[0];
    chosen.usedThisMinute += request.estimatedTokens;
    chosen.usedToday += request.estimatedTokens;
    chosen.requestsThisMinute += 1;

    return { key: chosen.key, org: chosen.org };
  }

  /**
   * Report actual token usage after a request completes.
   * Updates counters from provider rate-limit response headers.
   */
  report(org: string, actualTokens: number, headers?: Record<string, string>): void {
    const k = this.keys.find(kr => kr.org === org);
    if (!k) return;

    if (headers) {
      const limitMinute = headers['x-ratelimit-limit-tokens-minute'];
      const remainMinute = headers['x-ratelimit-remaining-tokens-minute'];
      const remainDay = headers['x-ratelimit-remaining-tokens-day'];

      if (limitMinute && remainMinute) {
        k.usedThisMinute = parseInt(limitMinute, 10) - parseInt(remainMinute, 10);
      }
      if (remainDay) {
        k.usedToday = k.tpd - parseInt(remainDay, 10);
      }
    } else {
      // No headers — use estimate
      k.usedThisMinute += actualTokens;
      k.usedToday += actualTokens;
    }
  }

  /** Reset all daily counters (call at midnight UTC). */
  midnightReset(): void {
    for (const k of this.keys) {
      k.usedToday = 0;
    }
  }

  /** Remove a key from the carousel by org name. */
  removeKey(org: string): boolean {
    const idx = this.keys.findIndex(k => k.org === org);
    if (idx === -1) return false;
    this.keys.splice(idx, 1);
    return true;
  }
}
