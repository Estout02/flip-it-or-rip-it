// Cache-key ladder for barcode + title fallback lookups (spec 005, research R2 /
// data-model.md "Cache key states"). Exercised through the public `lookup()`
// entry point, asserting both the returned valuation shape and the number/shape
// of calls the fake client saw — the ladder's whole point is call economy.

import { afterEach, describe, expect, it } from 'vitest';
import { lookup, type PipelineDeps } from './pipeline.js';
import { TtlCache } from './cache.js';
import { RateLimiter } from './rate-limit.js';
import { LIQUIDITY_DEFAULTS } from './verdict.js';
import { MATCH_DEFAULTS, type Valuation } from './valuation.js';
import { EbayUnavailableError, type EbayBrowseClient, type SearchResult } from './ebay/types.js';

function listing(priceCents: number, title = `Listing at ${priceCents}`) {
  return { title, priceCents };
}

class CountingClient implements EbayBrowseClient {
  calls: Array<{ gtin?: string; title?: string }> = [];
  handler: (query: { gtin?: string; title?: string }) => SearchResult | Promise<SearchResult>;

  constructor(handler: CountingClient['handler']) {
    this.handler = handler;
  }

  async search(query: { gtin?: string; title?: string }): Promise<SearchResult> {
    this.calls.push(query);
    return this.handler(query);
  }
}

let cleanup: Array<() => void> = [];

afterEach(() => {
  for (const fn of cleanup) fn();
  cleanup = [];
});

/** Fresh cache + rate limiter per test, per T013 — no cross-test cache bleed. */
function makeDeps(client: EbayBrowseClient, rateLimiter?: RateLimiter): PipelineDeps {
  const cache = new TtlCache<Valuation>({ ttlMs: 86_400_000 });
  cleanup.push(() => cache.dispose());
  return {
    browseClient: client,
    cache,
    rateLimiter: rateLimiter ?? new RateLimiter({ lookupDailyCap: 1000, ebayDailyCallBudget: 1000 }),
    config: {
      feeRate: 0.1325,
      shippingFlatCents: 500,
      defaultProfitThresholdCents: 1000,
      liquidity: LIQUIDITY_DEFAULTS,
      realizationRate: 1,
      match: MATCH_DEFAULTS,
    },
  };
}

const B = '9780345391803'; // barcode
const T = 'Chrono Trigger SNES'; // title
const T2 = 'Hitchhiker Guide'; // a different title
const B2 = '045496830434'; // a second, distinct barcode

/** Non-empty barcode result: eBay already constrained this to one product. */
const BARCODE_HIT: SearchResult = {
  listings: [listing(4000, 'Chrono Trigger (SNES, 1995)')],
  totalActive: 12,
};

/** Categorized so the title path's match-filtering is actually exercised. */
function titleHit(name: string): SearchResult {
  return {
    listings: [
      { title: `${name} A`, priceCents: 5000, leafCategoryId: 'g', leafCategoryName: 'Games' },
      { title: `${name} B`, priceCents: 5500, leafCategoryId: 'g', leafCategoryName: 'Games' },
    ],
    totalActive: 20,
  };
}

describe('pipeline cache-key ladder — barcode + title fallback (US3)', () => {
  it('row 1: a non-empty barcode answer is shared by every title paired with it', async () => {
    const client = new CountingClient((q) => (q.gtin ? BARCODE_HIT : titleHit('should not be called')));
    const deps = makeDeps(client);

    const bareBarcode = await lookup({ identifier: B }, deps);
    expect(client.calls).toEqual([{ gtin: B }]);
    expect(bareBarcode.cached).toBe(false);

    const withT1 = await lookup({ identifier: B, title: T }, deps);
    expect(client.calls).toHaveLength(1); // no new call
    expect(withT1.cached).toBe(true);
    expect(withT1.matchedTitle).toBe(bareBarcode.matchedTitle);

    const withT2 = await lookup({ identifier: B, title: T2 }, deps);
    expect(client.calls).toHaveLength(1);
    expect(withT2.cached).toBe(true);
    expect(withT2.matchedTitle).toBe(bareBarcode.matchedTitle);
  });

  it('rows 2–5: empty barcode → per-title fallback, cached per title, and B-alone stays empty', async () => {
    const client = new CountingClient((q) => {
      if (q.gtin) return { listings: [], totalActive: 0 };
      return titleHit(q.title!);
    });
    const deps = makeDeps(client);

    // (2) B empty alone → 1 gtin call, noMarketData.
    const bareBarcode = await lookup({ identifier: B }, deps);
    expect(client.calls).toEqual([{ gtin: B }]);
    expect(bareBarcode.noMarketData).toBe(true);

    // then B+T → exactly one NEW call, a title search, matchFiltered result.
    const withT = await lookup({ identifier: B, title: T }, deps);
    expect(client.calls).toEqual([{ gtin: B }, { title: T }]);
    expect(withT.matchFiltered).toBe(true);
    expect(withT.noMarketData).toBe(false);

    // (3) B+T again → 0 new calls, cached.
    const withTAgain = await lookup({ identifier: B, title: T }, deps);
    expect(client.calls).toHaveLength(2);
    expect(withTAgain.cached).toBe(true);
    expect(withTAgain.matchedTitle).toBe(withT.matchedTitle);

    // (4) B+T2 → 1 new title call for T2, T2's own answer (not T's).
    const withT2 = await lookup({ identifier: B, title: T2 }, deps);
    expect(client.calls).toEqual([{ gtin: B }, { title: T }, { title: T2 }]);
    expect(withT2.cached).toBe(false);
    expect(withT2.matchedTitle).not.toBe(withT.matchedTitle);

    // (5) B alone → 0 new calls, the empty answer (not T's).
    const bareAgain = await lookup({ identifier: B }, deps);
    expect(client.calls).toHaveLength(3);
    expect(bareAgain.cached).toBe(true);
    expect(bareAgain.noMarketData).toBe(true);
    expect(bareAgain.matchedTitle).not.toBe(withT.matchedTitle);
  });

  it('row 6/7: a cold barcode+title where the barcode is empty makes 2 calls and caches both keys', async () => {
    const client = new CountingClient((q) => {
      if (q.gtin) return { listings: [], totalActive: 0 };
      return titleHit(q.title!);
    });
    const deps = makeDeps(client);

    const cold = await lookup({ identifier: B2, title: T }, deps);
    expect(client.calls).toEqual([{ gtin: B2 }, { title: T }]);
    expect(cold.cached).toBe(false);
    expect(cold.noMarketData).toBe(false);

    // Afterwards B2 alone → 0 new calls, the empty barcode answer.
    const bareB2 = await lookup({ identifier: B2 }, deps);
    expect(client.calls).toHaveLength(2);
    expect(bareB2.cached).toBe(true);
    expect(bareB2.noMarketData).toBe(true);
  });
});

// ---- spec 005: in-flight coalescing (US4, research R5) ----

/** A client whose search() hangs until the test explicitly releases it. */
class DeferredClient implements EbayBrowseClient {
  calls: Array<{ gtin?: string; title?: string }> = [];
  private pending: {
    resolve: (r: SearchResult) => void;
    reject: (e: unknown) => void;
  } | null = null;

  search(query: { gtin?: string; title?: string }): Promise<SearchResult> {
    this.calls.push(query);
    return new Promise<SearchResult>((resolve, reject) => {
      this.pending = { resolve, reject };
    });
  }

  release(result: SearchResult): void {
    if (!this.pending) throw new Error('no pending call to release');
    const { resolve } = this.pending;
    this.pending = null;
    resolve(result);
  }

  releaseError(err: unknown): void {
    if (!this.pending) throw new Error('no pending call to release');
    const { reject } = this.pending;
    this.pending = null;
    reject(err);
  }
}

describe('coalescing', () => {
  it('(a) 10 concurrent cold lookups for one title make exactly one client call', async () => {
    const client = new DeferredClient();
    const deps = makeDeps(client);

    const promises = Array.from({ length: 10 }, () => lookup({ title: T }, deps));
    expect(client.calls).toHaveLength(1); // registered synchronously before release

    client.release(titleHit(T));
    const results = await Promise.all(promises);

    expect(client.calls).toHaveLength(1);
    const values = results.map((r) => r.estimatedValueCents);
    expect(new Set(values).size).toBe(1);
  });

  it('(b) concurrent calls with different costBasisCents get different profitCents from the shared valuation', async () => {
    const client = new DeferredClient();
    const deps = makeDeps(client);

    const promises = [0, 100, 200].map((costBasisCents) =>
      lookup({ title: T, costBasisCents }, deps),
    );
    client.release(titleHit(T));
    const [a, b, c] = await Promise.all(promises);

    expect(a!.profitCents).toBe(b!.profitCents + 100);
    expect(b!.profitCents).toBe(c!.profitCents + 100);
    expect(client.calls).toHaveLength(1);
  });

  it('(c) a shared rejection is not remembered — the next lookup makes a fresh call', async () => {
    const client = new DeferredClient();
    // cooldownMs: 0 so the eBay-failure cooldown does not itself block the
    // follow-up call; this test is specifically about in-flight memory, not
    // the (separately tested) cooldown behaviour.
    const deps = makeDeps(client, new RateLimiter({
      lookupDailyCap: 1000,
      ebayDailyCallBudget: 1000,
      cooldownMs: 0,
    }));

    const promises = Array.from({ length: 10 }, () => lookup({ title: T }, deps));
    client.releaseError(new EbayUnavailableError('eBay Browse search failed with HTTP 503'));

    for (const p of promises) {
      await expect(p).rejects.toBeInstanceOf(EbayUnavailableError);
    }
    expect(client.calls).toHaveLength(1);

    // The failure must not be remembered: a fresh lookup makes a fresh call.
    const afterPromise = lookup({ title: T }, deps);
    client.release(titleHit(T));
    const after = await afterPromise;
    expect(client.calls).toHaveLength(2);
    expect(after.noMarketData).toBe(false);
  });

  it('(d) rateLimiter.ebayCallsToday() reflects one call after a coalesced burst', async () => {
    const client = new DeferredClient();
    const rateLimiter = new RateLimiter({ lookupDailyCap: 1000, ebayDailyCallBudget: 1000 });
    const deps = makeDeps(client, rateLimiter);

    const promises = Array.from({ length: 10 }, () => lookup({ title: T }, deps));
    client.release(titleHit(T));
    await Promise.all(promises);

    expect(rateLimiter.ebayCallsToday()).toBe(1);
  });
});
