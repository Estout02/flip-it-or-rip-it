import { afterEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp, type AppConfig } from './server.js';
import { TtlCache } from './lib/cache.js';
import { RateLimiter } from './lib/rate-limit.js';
import { EbayUnavailableError, type EbayBrowseClient, type SearchResult } from './lib/ebay/types.js';
import type { Valuation } from './lib/valuation.js';

const REQUIRED_VERDICT_FIELDS = [
  'verdict',
  'estimatedValueCents',
  'feesCents',
  'shippingEstimateCents',
  'profitCents',
  'liquidityScore',
  'liquidityBasis',
  'sampleSize',
  'pricingBasis',
  'noMarketData',
  'matchedTitle',
  'cached',
  'query',
] as const;

function listing(priceCents: number, title = `Listing at ${priceCents}`) {
  return { title, priceCents };
}

/** ~$40 median market: FLIP territory with the default $10 threshold. */
const FLIP_MARKET: SearchResult = {
  listings: [3500, 3800, 3900, 4100, 4200].map((cents) =>
    listing(cents, 'Chrono Trigger (SNES, 1995)'),
  ),
  totalActive: 12,
};

/** ~$8 median market: RIP territory with the default $10 threshold. */
const RIP_MARKET: SearchResult = {
  listings: [700, 800, 900].map((cents) => listing(cents)),
  totalActive: 40,
};

class FakeBrowseClient implements EbayBrowseClient {
  calls: Array<{ gtin?: string; title?: string }> = [];
  handler: (query: { gtin?: string; title?: string }) => SearchResult | Promise<SearchResult>;

  constructor(handler: FakeBrowseClient['handler'] = () => FLIP_MARKET) {
    this.handler = handler;
  }

  async search(query: { gtin?: string; title?: string }): Promise<SearchResult> {
    this.calls.push(query);
    return this.handler(query);
  }
}

const testConfig: AppConfig = {
  ebayEnv: 'sandbox',
  ebayClientId: '',
  ebayClientSecret: '',
  marketplaceId: 'EBAY_US',
  feeRate: 0.1325,
  shippingFlatCents: 500,
  cacheTtlMs: 86_400_000,
  lookupDailyCap: 50,
  ebayDailyCallBudget: 2500,
  defaultProfitThresholdCents: 1000,
  port: 0,
};

let cleanup: Array<() => void | Promise<void>> = [];

function makeApp(options: {
  client?: FakeBrowseClient;
  config?: Partial<AppConfig>;
} = {}): { app: FastifyInstance; client: FakeBrowseClient } {
  const client = options.client ?? new FakeBrowseClient();
  const config = { ...testConfig, ...options.config };
  const cache = new TtlCache<Valuation>({ ttlMs: config.cacheTtlMs });
  const rateLimiter = new RateLimiter({
    lookupDailyCap: config.lookupDailyCap,
    ebayDailyCallBudget: config.ebayDailyCallBudget,
  });
  const app = buildApp({ config, browseClient: client, cache, rateLimiter }, { logger: false });
  cleanup.push(() => cache.dispose());
  cleanup.push(() => app.close());
  return { app, client };
}

afterEach(async () => {
  for (const fn of cleanup) await fn();
  cleanup = [];
});

function lookup(app: FastifyInstance, payload: object, remoteAddress = '10.0.0.1') {
  return app.inject({ method: 'POST', url: '/api/lookup', payload, remoteAddress });
}

describe('POST /api/lookup — US1 barcode verdict', () => {
  it('returns the full contract shape for an identifier lookup (SC-003)', async () => {
    const { app } = makeApp();
    const res = await lookup(app, { identifier: '9780345391803' });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    for (const field of REQUIRED_VERDICT_FIELDS) {
      expect(body, `missing field ${field}`).toHaveProperty(field);
    }
    expect(body.pricingBasis).toBe('ASKING_PRICE');
    expect(body.liquidityBasis).toBe('SUPPLY_SIDE_ONLY');
    expect(body.matchedTitle).toBe('Chrono Trigger (SNES, 1995)');
    expect(body.cached).toBe(false);
    expect(body.query).toEqual({ identifier: '9780345391803', title: null });
    expect(body).not.toHaveProperty('stubbed');
    expect(Number.isInteger(body.estimatedValueCents)).toBe(true);
    expect(Number.isInteger(body.feesCents)).toBe(true);
    expect(Number.isInteger(body.profitCents)).toBe(true);
  });

  it('says FLIP when profit clears the default threshold', async () => {
    const { app } = makeApp();
    const res = await lookup(app, { identifier: '9780345391803' });

    const body = res.json();
    // median 3900, fees round(3900×0.1325)=517, shipping 500 → profit 2883
    expect(body.estimatedValueCents).toBe(3900);
    expect(body.feesCents).toBe(517);
    expect(body.profitCents).toBe(2883);
    expect(body.verdict).toBe('FLIP');
  });

  it('says RIP when profit is under the threshold', async () => {
    const { app } = makeApp({ client: new FakeBrowseClient(() => RIP_MARKET) });
    const res = await lookup(app, { identifier: '9780345391803' });

    const body = res.json();
    expect(body.verdict).toBe('RIP');
    expect(body.noMarketData).toBe(false);
  });

  it('returns a 200 RIP with noMarketData when eBay has no listings', async () => {
    const { app } = makeApp({
      client: new FakeBrowseClient(() => ({ listings: [], totalActive: 0 })),
    });
    const res = await lookup(app, { identifier: '9780345391803' });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.verdict).toBe('RIP');
    expect(body.noMarketData).toBe(true);
    expect(body.estimatedValueCents).toBe(0);
    expect(body.matchedTitle).toBeNull();
  });

  it('serves the second identical lookup from cache with one client call (SC-002)', async () => {
    const { app, client } = makeApp();

    const first = await lookup(app, { identifier: '9780345391803' });
    const second = await lookup(app, { identifier: '9780345391803' });

    expect(first.json().cached).toBe(false);
    expect(second.json().cached).toBe(true);
    expect(second.json().verdict).toBe(first.json().verdict);
    expect(client.calls).toHaveLength(1);
  });

  it('caches the no-listings valuation too (saves quota for dead barcodes)', async () => {
    const { app, client } = makeApp({
      client: new FakeBrowseClient(() => ({ listings: [], totalActive: 0 })),
    });

    await lookup(app, { identifier: '9780345391803' });
    const second = await lookup(app, { identifier: '9780345391803' });

    expect(second.json().cached).toBe(true);
    expect(client.calls).toHaveLength(1);
  });

  it('rejects a malformed identifier with 400 and zero eBay calls (SC-006)', async () => {
    const { app, client } = makeApp();
    const res = await lookup(app, { identifier: 'not-a-barcode!' });

    expect(res.statusCode).toBe(400);
    expect(res.json().error).toBe('validation');
    expect(client.calls).toHaveLength(0);
  });

  it('returns 429 limit-reached on the 51st lookup of the day (FR-012)', async () => {
    const { app } = makeApp();

    for (let i = 0; i < 50; i++) {
      const res = await lookup(app, { identifier: '9780345391803' });
      expect(res.statusCode).toBe(200);
    }
    const res51 = await lookup(app, { identifier: '9780345391803' });

    expect(res51.statusCode).toBe(429);
    expect(res51.json().error).toBe('limit-reached');
  });

  it('rate-limits per client, not globally', async () => {
    const { app } = makeApp({ config: { lookupDailyCap: 1 } });

    expect((await lookup(app, { identifier: '9780345391803' }, '10.0.0.1')).statusCode).toBe(200);
    expect((await lookup(app, { identifier: '9780345391803' }, '10.0.0.1')).statusCode).toBe(429);
    expect((await lookup(app, { identifier: '9780345391803' }, '10.0.0.2')).statusCode).toBe(200);
  });

  it('maps an eBay outage to 503 and cooldown short-circuits the next miss (FR-015)', async () => {
    const client = new FakeBrowseClient(() => {
      throw new EbayUnavailableError('eBay Browse search failed with HTTP 503');
    });
    const { app } = makeApp({ client });

    const first = await lookup(app, { identifier: '9780345391803' });
    expect(first.statusCode).toBe(503);
    expect(first.json().error).toBe('temporarily-unavailable');

    // During the cooldown a different (uncached) item must not touch eBay.
    const second = await lookup(app, { identifier: '045496830434' });
    expect(second.statusCode).toBe(503);
    expect(client.calls).toHaveLength(1);
  });

  it('returns 503 when the daily eBay budget is exhausted (SC-004)', async () => {
    const { app, client } = makeApp({ config: { ebayDailyCallBudget: 1 } });

    expect((await lookup(app, { identifier: '9780345391803' })).statusCode).toBe(200);
    // Different item → cache miss → needs an eBay call, but the budget is spent.
    const res = await lookup(app, { identifier: '045496830434' });

    expect(res.statusCode).toBe(503);
    expect(res.json().error).toBe('temporarily-unavailable');
    expect(client.calls).toHaveLength(1);
  });

  it('still serves cached valuations while the budget is exhausted', async () => {
    const { app, client } = makeApp({ config: { ebayDailyCallBudget: 1 } });

    await lookup(app, { identifier: '9780345391803' });
    const res = await lookup(app, { identifier: '9780345391803' });

    expect(res.statusCode).toBe(200);
    expect(res.json().cached).toBe(true);
    expect(client.calls).toHaveLength(1);
  });
});

describe('POST /api/lookup — US2 title lookup', () => {
  it('returns the full contract shape for a title lookup', async () => {
    const { app, client } = makeApp();
    const res = await lookup(app, { title: 'Chrono Trigger SNES' });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    for (const field of REQUIRED_VERDICT_FIELDS) {
      expect(body, `missing field ${field}`).toHaveProperty(field);
    }
    expect(body.query).toEqual({ identifier: null, title: 'Chrono Trigger SNES' });
    expect(client.calls).toEqual([{ title: 'Chrono Trigger SNES' }]);
  });

  it('rejects an empty body with 400 and zero eBay calls', async () => {
    const { app, client } = makeApp();
    const res = await lookup(app, {});

    expect(res.statusCode).toBe(400);
    expect(res.json().error).toBe('validation');
    expect(client.calls).toHaveLength(0);
  });

  it('falls back to exactly one title search when the gtin finds nothing (FR-003)', async () => {
    const client = new FakeBrowseClient((query) =>
      query.gtin !== undefined ? { listings: [], totalActive: 0 } : FLIP_MARKET,
    );
    const { app } = makeApp({ client });

    const res = await lookup(app, { identifier: '9780345391803', title: 'Hitchhiker Guide' });

    expect(res.statusCode).toBe(200);
    expect(res.json().noMarketData).toBe(false);
    expect(res.json().matchedTitle).toBe('Chrono Trigger (SNES, 1995)');
    expect(client.calls).toEqual([
      { gtin: '9780345391803' },
      { title: 'Hitchhiker Guide' },
    ]);
  });

  it('caches the fallback result under the gtin key (the scanned code stays the identity)', async () => {
    const client = new FakeBrowseClient((query) =>
      query.gtin !== undefined ? { listings: [], totalActive: 0 } : FLIP_MARKET,
    );
    const { app } = makeApp({ client });

    await lookup(app, { identifier: '9780345391803', title: 'Hitchhiker Guide' });
    const second = await lookup(app, { identifier: '9780345391803', title: 'Hitchhiker Guide' });

    expect(second.json().cached).toBe(true);
    expect(client.calls).toHaveLength(2); // gtin + fallback from the first request only
  });

  it('hits the cache across title casing/whitespace variants (FR-011)', async () => {
    const { app, client } = makeApp();

    const first = await lookup(app, { title: 'chrono trigger snes' });
    const second = await lookup(app, { title: 'CHRONO  TRIGGER snes' });

    expect(first.json().cached).toBe(false);
    expect(second.json().cached).toBe(true);
    expect(client.calls).toHaveLength(1);
  });

  it('surfaces a vague title through a small sampleSize', async () => {
    const { app } = makeApp({
      client: new FakeBrowseClient(() => ({
        listings: [listing(1200), listing(80_000)],
        totalActive: 2,
      })),
    });

    const res = await lookup(app, { title: 'red thing' });

    expect(res.statusCode).toBe(200);
    expect(res.json().sampleSize).toBe(2);
  });
});

describe('POST /api/lookup — US3 cost basis & threshold personalization', () => {
  it('deducts the cost basis from profit exactly (FR-007)', async () => {
    const { app } = makeApp();

    const free = await lookup(app, { title: 'Chrono Trigger SNES' });
    const paid = await lookup(app, { title: 'Chrono Trigger SNES', costBasisCents: 1500 });

    expect(paid.json().profitCents).toBe(free.json().profitCents - 1500);
  });

  it('a high enough cost basis flips the verdict to RIP', async () => {
    const { app } = makeApp();

    const free = await lookup(app, { title: 'Chrono Trigger SNES' });
    expect(free.json().verdict).toBe('FLIP');

    // profit without basis is 2883; basis 2000 leaves 883 < 1000 threshold
    const paid = await lookup(app, { title: 'Chrono Trigger SNES', costBasisCents: 2000 });
    expect(paid.json().verdict).toBe('RIP');
  });

  it('omitted cost basis defaults to 0', async () => {
    const { app } = makeApp();

    const implicit = await lookup(app, { title: 'Chrono Trigger SNES' });
    const explicit = await lookup(app, { title: 'Chrono Trigger SNES', costBasisCents: 0 });

    expect(implicit.json().profitCents).toBe(explicit.json().profitCents);
  });

  it('honors a per-request threshold: low threshold rescues a small profit', async () => {
    const { app } = makeApp({ client: new FakeBrowseClient(() => RIP_MARKET) });

    const strict = await lookup(app, { title: 'cheap paperback' });
    expect(strict.json().verdict).toBe('RIP');

    const lenient = await lookup(app, { title: 'cheap paperback', profitThresholdCents: 100 });
    expect(lenient.json().verdict).toBe('FLIP');
    expect(lenient.json().profitCents).toBeGreaterThanOrEqual(100);
  });

  it('omitted threshold uses the config default (1000)', async () => {
    const { app } = makeApp();

    // profit 2883 − basis 1884 = 999 < 1000 → RIP; 998 → profit 1885... boundary via basis
    const justUnder = await lookup(app, {
      title: 'Chrono Trigger SNES',
      costBasisCents: 1884,
    });
    expect(justUnder.json().profitCents).toBe(999);
    expect(justUnder.json().verdict).toBe('RIP');

    const justAt = await lookup(app, { title: 'Chrono Trigger SNES', costBasisCents: 1883 });
    expect(justAt.json().profitCents).toBe(1000);
    expect(justAt.json().verdict).toBe('FLIP');
  });

  it.each([
    { costBasisCents: -1 },
    { profitThresholdCents: -50 },
  ])('rejects negative money %o with 400 and zero eBay calls', async (extra) => {
    const { app, client } = makeApp();

    const res = await lookup(app, { title: 'Chrono Trigger SNES', ...extra });

    expect(res.statusCode).toBe(400);
    expect(res.json().error).toBe('validation');
    expect(client.calls).toHaveLength(0);
  });

  it('shares one cached valuation across different basis/threshold requests', async () => {
    const { app, client } = makeApp();

    const a = await lookup(app, { title: 'Chrono Trigger SNES' });
    const b = await lookup(app, { title: 'Chrono Trigger SNES', costBasisCents: 2000 });

    expect(a.json().verdict).toBe('FLIP');
    expect(b.json().verdict).toBe('RIP');
    expect(b.json().cached).toBe(true);
    expect(client.calls).toHaveLength(1);
  });
});

describe('GET /health', () => {
  it('reports eBay call consumption for quota visibility (SC-004)', async () => {
    const { app } = makeApp();

    await lookup(app, { identifier: '9780345391803' });
    const res = await app.inject({ method: 'GET', url: '/health' });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ status: 'ok', ebayCallsToday: 1 });
  });
});
