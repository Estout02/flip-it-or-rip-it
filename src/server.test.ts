import { afterEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp, loadConfig, type AppConfig } from './server.js';
import { LIQUIDITY_DEFAULTS, REALIZATION_RATE_DEFAULT } from './lib/verdict.js';
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
  'rawAskingMedianCents',
  'realizationRate',
  'liquidityScore',
  'liquidityTier',
  'liquidityBasis',
  'reasonCode',
  'reason',
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
  liquidity: LIQUIDITY_DEFAULTS,
  // Pinned at 1 so pre-existing expectations keep proving the profit math (research R9).
  realizationRate: 1,
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
    expect(body.pricingBasis).toBe('ADJUSTED_ASKING_PRICE');
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

describe('loadConfig — liquidity knobs', () => {
  it('falls back to defaults when the env vars are unset', () => {
    expect(loadConfig({}).liquidity).toEqual(LIQUIDITY_DEFAULTS);
  });

  it('reads configured cutoffs', () => {
    const config = loadConfig({
      LIQUIDITY_STRONG_MAX_LISTINGS: '5',
      LIQUIDITY_MODERATE_MAX_LISTINGS: '25',
      LIQUIDITY_RISKY_MARGIN_MULTIPLIER: '3',
    });
    expect(config.liquidity).toEqual({
      strongMaxListings: 5,
      moderateMaxListings: 25,
      riskyMarginMultiplier: 3,
    });
  });

  it.each([
    ['moderate below strong', { LIQUIDITY_STRONG_MAX_LISTINGS: '50', LIQUIDITY_MODERATE_MAX_LISTINGS: '10' }],
    ['multiplier below 1', { LIQUIDITY_RISKY_MARGIN_MULTIPLIER: '0.5' }],
    ['strong below 1', { LIQUIDITY_STRONG_MAX_LISTINGS: '0' }],
    ['non-numeric', { LIQUIDITY_MODERATE_MAX_LISTINGS: 'fifty' }],
  ])('falls back to defaults on invalid config (%s)', (_label, env) => {
    expect(loadConfig(env).liquidity).toEqual(LIQUIDITY_DEFAULTS);
  });
});

/** ~$40 median in a flooded market (300 active) → weak liquidity, big margin. */
const FLOODED_VALUABLE: SearchResult = {
  listings: [3900, 4000, 4100].map((cents) => listing(cents, 'Rare Hardcover First Edition')),
  totalActive: 300,
};

/** ~$24 median in a flooded market → over threshold, but only just. */
const FLOODED_THIN: SearchResult = {
  listings: [2300, 2400, 2500].map((cents) => listing(cents, 'Common Paperback')),
  totalActive: 300,
};

describe('POST /api/lookup — liquidity gate (US1)', () => {
  it('returns FLIP_RISKY for a valuable item in a flooded market', async () => {
    const { app } = makeApp({ client: new FakeBrowseClient(() => FLOODED_VALUABLE) });
    const body = (await lookup(app, { title: 'Rare Hardcover' })).json();
    expect(body.verdict).toBe('FLIP_RISKY');
    expect(body.profitCents).toBeGreaterThanOrEqual(2000);
  });

  it('returns RIP for a thin-margin item in a flooded market', async () => {
    const { app } = makeApp({ client: new FakeBrowseClient(() => FLOODED_THIN) });
    const body = (await lookup(app, { title: 'Common Paperback' })).json();
    expect(body.verdict).toBe('RIP');
    expect(body.profitCents).toBeGreaterThan(1000); // profitable, yet still ripped
  });

  it('gates per request, so one cached valuation serves different thresholds', async () => {
    // The gate depends on the caller's threshold while the cache does not, so a
    // second caller must be able to get a different verdict for zero eBay calls.
    const { app, client } = makeApp({ client: new FakeBrowseClient(() => FLOODED_VALUABLE) });
    const lenient = (await lookup(app, { title: 'Rare Hardcover', profitThresholdCents: 1000 })).json();
    const strict = (await lookup(app, { title: 'Rare Hardcover', profitThresholdCents: 2000 })).json();

    expect(lenient.verdict).toBe('FLIP_RISKY');
    expect(strict.verdict).toBe('RIP');
    expect(strict.cached).toBe(true);
    expect(client.calls).toHaveLength(1);
  });
});

describe('POST /api/lookup — verdict reasons (US2)', () => {
  it.each([
    ['PROFITABLE', FLIP_MARKET],
    ['WEAK_LIQUIDITY_HIGH_VALUE', FLOODED_VALUABLE],
    ['WEAK_LIQUIDITY_THIN_MARGIN', FLOODED_THIN],
    ['BELOW_THRESHOLD', RIP_MARKET],
    ['NO_MARKET_DATA', { listings: [], totalActive: 0 } as SearchResult],
  ])('carries reasonCode %s and readable text', async (expected, market) => {
    const { app } = makeApp({ client: new FakeBrowseClient(() => market) });
    const body = (await lookup(app, { title: 'Some Item' })).json();
    expect(body.reasonCode).toBe(expected);
    expect(typeof body.reason).toBe('string');
    expect(body.reason.length).toBeGreaterThan(0);
  });
});

describe('POST /api/lookup — liquidity honesty (US3)', () => {
  it('exposes the tier with the supply-side-only marker', async () => {
    const { app } = makeApp({ client: new FakeBrowseClient(() => FLOODED_VALUABLE) });
    const body = (await lookup(app, { title: 'Rare Hardcover' })).json();
    expect(body.liquidityTier).toBe('WEAK');
    expect(body.liquidityBasis).toBe('SUPPLY_SIDE_ONLY');
  });

  it('labels a market with no competing listings as unproven', async () => {
    const soleSeller: SearchResult = {
      listings: [listing(4000, 'Sole Listing')],
      totalActive: 0,
    };
    const { app } = makeApp({ client: new FakeBrowseClient(() => soleSeller) });
    const body = (await lookup(app, { title: 'Sole Listing' })).json();
    expect(body.liquidityTier).toBe('UNPROVEN');
    expect(body.verdict).toBe('FLIP');
  });
});

describe('loadConfig — realization rate', () => {
  it('defaults when the env var is unset', () => {
    expect(loadConfig({}).realizationRate).toBe(REALIZATION_RATE_DEFAULT);
  });

  it('reads a valid configured rate', () => {
    expect(loadConfig({ VALUATION_REALIZATION_RATE: '0.65' }).realizationRate).toBe(0.65);
    expect(loadConfig({ VALUATION_REALIZATION_RATE: '1' }).realizationRate).toBe(1);
  });

  it.each([['zero', '0'], ['above one', '1.5'], ['negative', '-1'], ['non-numeric', 'most of it']])(
    'falls back to the default on an invalid rate (%s)',
    (_label, value) => {
      expect(loadConfig({ VALUATION_REALIZATION_RATE: value }).realizationRate).toBe(
        REALIZATION_RATE_DEFAULT,
      );
    },
  );
});

/** ~$18 median: FLIP on the raw median, RIP once the 0.8 correction applies. */
const BORDERLINE_MARKET: SearchResult = {
  listings: [1750, 1800, 1850].map((cents) => listing(cents, 'Borderline Paperback')),
  totalActive: 10,
};

describe('POST /api/lookup — realization rate at the production default (US1)', () => {
  it('RIPs a borderline item that the uncorrected median would have FLIPped', async () => {
    const atDefault = makeApp({
      client: new FakeBrowseClient(() => BORDERLINE_MARKET),
      config: { realizationRate: REALIZATION_RATE_DEFAULT },
    });
    const uncorrected = makeApp({
      client: new FakeBrowseClient(() => BORDERLINE_MARKET),
      config: { realizationRate: 1 },
    });

    expect((await lookup(uncorrected.app, { title: 'Borderline' })).json().verdict).toBe('FLIP');
    expect((await lookup(atDefault.app, { title: 'Borderline' })).json().verdict).toBe('RIP');
  });

  it('still FLIPs a comfortably profitable item at the default rate', async () => {
    const { app } = makeApp({
      client: new FakeBrowseClient(() => FLIP_MARKET),
      config: { realizationRate: REALIZATION_RATE_DEFAULT },
    });
    const body = (await lookup(app, { title: 'Chrono Trigger' })).json();
    expect(body.verdict).toBe('FLIP');
    expect(body.estimatedValueCents).toBe(Math.round(3900 * REALIZATION_RATE_DEFAULT));
  });
});

describe('POST /api/lookup — valuation honesty (US2)', () => {
  it('labels the basis as adjusted and stays reconstructable', async () => {
    const { app } = makeApp({
      client: new FakeBrowseClient(() => FLIP_MARKET),
      config: { realizationRate: REALIZATION_RATE_DEFAULT },
    });
    const body = (await lookup(app, { title: 'Chrono Trigger' })).json();

    expect(body.pricingBasis).toBe('ADJUSTED_ASKING_PRICE');
    expect(body.rawAskingMedianCents).toBe(3900);
    expect(body.realizationRate).toBe(REALIZATION_RATE_DEFAULT);
    expect(Math.round(body.rawAskingMedianCents * body.realizationRate)).toBe(
      body.estimatedValueCents,
    );
  });
});

describe('POST /api/lookup — the rate is retunable (US3)', () => {
  it('shifts value and verdict when the configured rate changes, with no code change', async () => {
    const market = BORDERLINE_MARKET; // ~$18 median
    const generous = makeApp({
      client: new FakeBrowseClient(() => market),
      config: { realizationRate: 1 },
    });
    const harsh = makeApp({
      client: new FakeBrowseClient(() => market),
      config: { realizationRate: 0.5 },
    });

    const generousBody = (await lookup(generous.app, { title: 'Borderline' })).json();
    const harshBody = (await lookup(harsh.app, { title: 'Borderline' })).json();

    expect(generousBody.estimatedValueCents).toBe(1800);
    expect(harshBody.estimatedValueCents).toBe(900);
    expect(generousBody.verdict).toBe('FLIP');
    expect(harshBody.verdict).toBe('RIP');
  });

  it('reports back the rate it was configured with', async () => {
    for (const rate of [1, 0.75, 0.5]) {
      const { app } = makeApp({
        client: new FakeBrowseClient(() => FLIP_MARKET),
        config: { realizationRate: rate },
      });
      const body = (await lookup(app, { title: 'Chrono Trigger' })).json();
      expect(body.realizationRate).toBe(rate);
      expect(body.estimatedValueCents).toBe(Math.round(3900 * rate));
    }
  });
});

describe('liquidity gate regression at the production rate (spec 002 × 003)', () => {
  // The 002 gate tests are pinned at rate 1. The correction narrows FLOODED_THIN's
  // margin from $4.08 to $1.66, which is close enough to the split to be worth
  // asserting rather than assuming.
  it.each([
    ['valuable flooded market', FLOODED_VALUABLE, 'FLIP_RISKY', 'WEAK_LIQUIDITY_HIGH_VALUE'],
    ['thin-margin flooded market', FLOODED_THIN, 'RIP', 'WEAK_LIQUIDITY_THIN_MARGIN'],
  ])('still gates %s correctly at the default rate', async (_label, market, verdict, reasonCode) => {
    const { app } = makeApp({
      client: new FakeBrowseClient(() => market),
      config: { realizationRate: REALIZATION_RATE_DEFAULT },
    });
    const body = (await lookup(app, { title: 'Flooded Item' })).json();
    expect(body.verdict).toBe(verdict);
    expect(body.reasonCode).toBe(reasonCode);
    expect(body.profitCents).toBeGreaterThanOrEqual(1000); // still profitable, still gated
  });
});
