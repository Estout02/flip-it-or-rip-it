import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp, loadConfig, type AppConfig } from './server.js';
import { LIQUIDITY_DEFAULTS, REALIZATION_RATE_DEFAULT } from './lib/verdict.js';
import { MATCH_DEFAULTS } from './lib/valuation.js';
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
  'matchConfidence',
  'matchedCategoryName',
  'matchDominance',
  'matchFiltered',
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

// Guaranteed not to exist on disk, so buildApp never registers static serving
// unless a test explicitly overrides it — independent of whatever the other
// agent's concurrent `web/` build may or may not have produced on disk.
const ABSENT_WEB_DIST_DIR = path.join(
  os.tmpdir(),
  `flip-or-rip-web-dist-absent-${process.pid}`,
);

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
  match: MATCH_DEFAULTS,
  port: 0,
  trustProxy: false,
  webDistDir: ABSENT_WEB_DIST_DIR,
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

function lookup(
  app: FastifyInstance,
  payload: object,
  remoteAddress = '10.0.0.1',
  headers?: Record<string, string>,
) {
  return app.inject({
    method: 'POST',
    url: '/api/lookup',
    payload,
    remoteAddress,
    ...(headers !== undefined ? { headers } : {}),
  });
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
    // A GTIN search, not a title search (spec 005 deviation): for a title search
    // the matched listing itself is competing supply, so competingSupplyCount is
    // now floored at 1 (research R1) and this exact fixture would read STRONG,
    // not UNPROVEN. A GTIN result isn't floored — competingSupplyCount tracks
    // the raw total directly — so it's the fixture that still legitimately
    // exercises "eBay reports zero total despite returning a listing".
    const body = (await lookup(app, { identifier: '9780345391803' })).json();
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

describe('loadConfig — match thresholds', () => {
  it('defaults when unset', () => {
    expect(loadConfig({}).match).toEqual(MATCH_DEFAULTS);
  });

  it('reads valid custom bands', () => {
    expect(
      loadConfig({
        MATCH_MIN_DOMINANCE_HIGH: '0.8',
        MATCH_MIN_DOMINANCE_MEDIUM: '0.5',
        MATCH_MAX_DISPERSION_HIGH: '2',
        MATCH_MAX_DISPERSION_MEDIUM: '4',
      }).match,
    ).toEqual({
      minDominanceHigh: 0.8,
      minDominanceMedium: 0.5,
      maxDispersionHigh: 2,
      maxDispersionMedium: 4,
    });
  });

  it.each([
    ['medium dominance above high', { MATCH_MIN_DOMINANCE_MEDIUM: '0.9' }],
    ['dominance above 1', { MATCH_MIN_DOMINANCE_HIGH: '1.5' }],
    ['dominance at zero', { MATCH_MIN_DOMINANCE_MEDIUM: '0' }],
    ['dispersion below 1', { MATCH_MAX_DISPERSION_HIGH: '0.5' }],
    ['high dispersion above medium', { MATCH_MAX_DISPERSION_HIGH: '9' }],
    ['non-numeric', { MATCH_MAX_DISPERSION_MEDIUM: 'wide' }],
  ])('falls back to defaults on invalid config (%s)', (_label, env) => {
    expect(loadConfig(env).match).toEqual(MATCH_DEFAULTS);
  });
});

/** Live-shaped contamination: cheap accessories plus a dominant game group. */
const CONTAMINATED_MARKET: SearchResult = {
  listings: [
    { title: 'Vinyl Bumper Sticker', priceCents: 549, leafCategoryId: '38583', leafCategoryName: 'Video Game Merchandise' },
    { title: 'Fridge Magnet', priceCents: 895, leafCategoryId: '476', leafCategoryName: 'Refrigerator Magnets' },
    { title: 'Mousepad', priceCents: 595, leafCategoryId: '23895', leafCategoryName: 'Mouse Pads & Wrist Rests' },
    { title: 'Chrono Trigger SNES Authentic Cart', priceCents: 5500, leafCategoryId: '139973', leafCategoryName: 'Video Games' },
    { title: 'Chrono Trigger SNES Cart Only', priceCents: 6000, leafCategoryId: '139973', leafCategoryName: 'Video Games' },
    { title: 'Chrono Trigger Super Nintendo', priceCents: 6500, leafCategoryId: '139973', leafCategoryName: 'Video Games' },
    { title: 'Chrono Trigger SNES Tested', priceCents: 7000, leafCategoryId: '139973', leafCategoryName: 'Video Games' },
  ],
  totalActive: 424,
};

describe('POST /api/lookup — product match filtering (US1)', () => {
  it('values the dominant product group, not the accessories', async () => {
    const { app } = makeApp({ client: new FakeBrowseClient(() => CONTAMINATED_MARKET) });
    const body = (await lookup(app, { title: 'Chrono Trigger SNES' })).json();

    // Median of 5500/6000/6500/7000 = 6250 at realizationRate 1 (testConfig).
    expect(body.rawAskingMedianCents).toBe(6250);
    expect(body.matchedTitle).toBe('Chrono Trigger SNES Authentic Cart');
    expect(body.sampleSize).toBe(4);
  });
});

describe('POST /api/lookup — match visibility (US2)', () => {
  it('reports what was matched and how dominant it was', async () => {
    const { app } = makeApp({ client: new FakeBrowseClient(() => CONTAMINATED_MARKET) });
    const body = (await lookup(app, { title: 'Chrono Trigger SNES' })).json();
    expect(body.matchedCategoryName).toBe('Video Games');
    expect(body.matchDominance).toBeCloseTo(4 / 7);
    expect(body.matchFiltered).toBe(true);
    expect(['HIGH', 'MEDIUM', 'LOW']).toContain(body.matchConfidence);
  });

  it('reports a barcode lookup as unfiltered with no matched category', async () => {
    const { app } = makeApp({ client: new FakeBrowseClient(() => FLIP_MARKET) });
    const body = (await lookup(app, { identifier: '9780345391803' })).json();
    expect(body.matchFiltered).toBe(false);
    expect(body.matchedCategoryName).toBeNull();
  });
});

/** One category, but Japanese imports beside US carts — the live reference case. */
const HETEROGENEOUS_MARKET: SearchResult = {
  listings: [600, 900, 1100, 1500, 2500, 24000, 30000, 80000].map((priceCents, i) => ({
    title: `Chrono Trigger listing ${i}`,
    priceCents,
    leafCategoryId: '139973',
    leafCategoryName: 'Video Games',
  })),
  totalActive: 424,
};

describe('POST /api/lookup — uncertain match (US3)', () => {
  it('returns UNCERTAIN when listings cannot be tied to one product', async () => {
    const { app } = makeApp({ client: new FakeBrowseClient(() => HETEROGENEOUS_MARKET) });
    const body = (await lookup(app, { title: 'Chrono Trigger SNES' })).json();
    expect(body.matchConfidence).toBe('LOW');
    expect(body.verdict).toBe('UNCERTAIN');
    expect(body.reasonCode).toBe('LOW_MATCH_CONFIDENCE');
    expect(body.estimatedValueCents).toBeGreaterThan(0); // figures still present
  });
});

// ---- spec 005: liquidity reads the item's own supply (US1) ----

/**
 * 20 in the dominant category (all priced identically, so dispersion stays
 * HIGH) plus 20 spread evenly across 5 merchandise categories (4 each) — the
 * dominant group can never be mistaken for one of them. Dominance lands at
 * exactly 0.5 (MEDIUM); dispersion stays HIGH. The worse of the two is MEDIUM,
 * so the verdict is not UNCERTAIN — this fixture is about liquidity, not match
 * confidence.
 */
const MIXED_SUPPLY_MARKET: SearchResult = {
  listings: [
    ...Array.from({ length: 20 }, (_, i) => ({
      title: `Chrono Trigger SNES listing ${i}`,
      priceCents: 4000,
      leafCategoryId: '139973',
      leafCategoryName: 'Video Games',
    })),
    ...Array.from({ length: 5 }, (_, cat) =>
      Array.from({ length: 4 }, (_, i) => ({
        title: `Merch ${cat}-${i}`,
        priceCents: 600 + i,
        leafCategoryId: `merch-${cat}`,
        leafCategoryName: `Merchandise ${cat}`,
      })),
    ).flat(),
  ],
  totalActive: 80,
};

describe('caller identity', () => {
  it('ignores X-Forwarded-For by default, so spoofing it cannot dodge the cap', async () => {
    const { app } = makeApp({ config: { lookupDailyCap: 3 } });

    for (let i = 0; i < 3; i++) {
      const res = await lookup(app, { identifier: '9780345391803' }, '10.0.0.1', {
        'x-forwarded-for': `203.0.113.${i}`,
      });
      expect(res.statusCode).toBe(200);
    }
    const fourth = await lookup(app, { identifier: '9780345391803' }, '10.0.0.1', {
      'x-forwarded-for': '203.0.113.99',
    });
    expect(fourth.statusCode).toBe(429);
  });

  it('honors X-Forwarded-For from a trusted proxy — each forwarded address is its own caller', async () => {
    const { app } = makeApp({ config: { lookupDailyCap: 3, trustProxy: '10.0.0.1' } });

    for (let i = 0; i < 4; i++) {
      const res = await lookup(app, { identifier: '9780345391803' }, '10.0.0.1', {
        'x-forwarded-for': `203.0.113.${i}`,
      });
      expect(res.statusCode).toBe(200);
    }
  });

  it('ignores X-Forwarded-For from an untrusted address even when TRUST_PROXY is set', async () => {
    const { app } = makeApp({ config: { lookupDailyCap: 3, trustProxy: '10.0.0.1' } });

    for (let i = 0; i < 3; i++) {
      const res = await lookup(app, { identifier: '9780345391803' }, '10.9.9.9', {
        'x-forwarded-for': `203.0.113.${i}`,
      });
      expect(res.statusCode).toBe(200);
    }
    const fourth = await lookup(app, { identifier: '9780345391803' }, '10.9.9.9', {
      'x-forwarded-for': '203.0.113.99',
    });
    expect(fourth.statusCode).toBe(429);
  });
});

describe('loadConfig — numeric settings', () => {
  it.each([
    ['LOOKUP_DAILY_CAP', 'lookupDailyCap', '7', 7],
    ['EBAY_DAILY_CALL_BUDGET', 'ebayDailyCallBudget', '100', 100],
    ['EBAY_FEE_RATE', 'feeRate', '0', 0],
    ['SHIPPING_FLAT_CENTS', 'shippingFlatCents', '0', 0],
    ['VALUATION_CACHE_TTL_HOURS', 'cacheTtlMs', '0.5', 1_800_000],
    ['PROFIT_THRESHOLD_DEFAULT', 'defaultProfitThresholdCents', '12.5', 1250],
    ['PORT', 'port', '8080', 8080],
  ] as const)('%s=%s is read into config.%s', (envVar, field, raw, expected) => {
    const config = loadConfig({ [envVar]: raw });
    expect(config[field]).toBe(expected);
  });

  it.each([
    ['LOOKUP_DAILY_CAP', 'abc'],
    ['LOOKUP_DAILY_CAP', '0'],
    ['LOOKUP_DAILY_CAP', '-5'],
    ['LOOKUP_DAILY_CAP', '2.5'],
    ['EBAY_DAILY_CALL_BUDGET', 'x'],
    ['EBAY_DAILY_CALL_BUDGET', '0'],
    ['EBAY_FEE_RATE', '1'],
    ['EBAY_FEE_RATE', '-0.1'],
    ['EBAY_FEE_RATE', 'abc'],
    ['SHIPPING_FLAT_CENTS', '-1'],
    ['SHIPPING_FLAT_CENTS', '4.5'],
    ['SHIPPING_FLAT_CENTS', 'x'],
    ['VALUATION_CACHE_TTL_HOURS', '0'],
    ['VALUATION_CACHE_TTL_HOURS', '-1'],
    ['VALUATION_CACHE_TTL_HOURS', 'x'],
    ['PROFIT_THRESHOLD_DEFAULT', '-1'],
    ['PROFIT_THRESHOLD_DEFAULT', 'x'],
    ['PORT', '0'],
    ['PORT', '70000'],
    ['PORT', 'x'],
  ])('invalid %s=%s warns (naming the var) and falls back to the default', (envVar, raw) => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    loadConfig({ [envVar]: raw });
    expect(warn).toHaveBeenCalled();
    expect(warn.mock.calls.some((call) => String(call[0]).includes(envVar))).toBe(true);
    warn.mockRestore();
  });

  it('keeps every default silently when nothing is set', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const config = loadConfig({});
    expect(warn).not.toHaveBeenCalled();
    expect(config.lookupDailyCap).toBe(50);
    expect(config.ebayDailyCallBudget).toBe(2500);
    expect(config.feeRate).toBe(0.1325);
    expect(config.shippingFlatCents).toBe(500);
    expect(config.cacheTtlMs).toBe(86_400_000);
    expect(config.defaultProfitThresholdCents).toBe(1000);
    expect(config.port).toBe(3000);
    warn.mockRestore();
  });
});

describe('loadConfig — TRUST_PROXY', () => {
  it.each([
    [undefined, false],
    ['', false],
    ['false', false],
    ['1', 1],
    ['2', 2],
    ['10.0.0.1', '10.0.0.1'],
    ['10.0.0.0/8, 192.168.1.1', '10.0.0.0/8,192.168.1.1'],
    ['::1', '::1'],
    ['fd00::/8', 'fd00::/8'],
  ])('parses TRUST_PROXY %j as %j', (raw, expected) => {
    const env = raw === undefined ? {} : { TRUST_PROXY: raw };
    expect(loadConfig(env).trustProxy).toEqual(expected);
  });

  it.each(['true', '0', '-1', '1.5', 'banana', '10.0.0.1/33', '10.0.0.1,nope'])(
    'rejects invalid TRUST_PROXY %j, warns, and falls back to false',
    (raw) => {
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
      expect(loadConfig({ TRUST_PROXY: raw }).trustProxy).toBe(false);
      expect(warn).toHaveBeenCalled();
      warn.mockRestore();
    },
  );
});

describe('POST /api/lookup — strict request bodies (US5, research R7)', () => {
  it('rejects a misspelled field (costBasis instead of costBasisCents) with 400 naming it', async () => {
    const { app, client } = makeApp();
    const res = await lookup(app, { title: 'x', costBasis: 0 });

    expect(res.statusCode).toBe(400);
    const body = res.json();
    expect(body.error).toBe('validation');
    expect(body.message).toContain('costBasis');
    expect(client.calls).toHaveLength(0);
  });

  it('rejects any unknown field, naming it, even alongside valid fields', async () => {
    const { app } = makeApp();
    const res = await lookup(app, { title: 'x', costBasisCents: 0, extra: 1 });

    expect(res.statusCode).toBe(400);
    expect(res.json().message).toContain('extra');
  });

  it('accepts a valid body with all four allowed fields', async () => {
    const { app } = makeApp();
    const res = await lookup(app, {
      identifier: '9780345391803',
      title: 'Chrono Trigger SNES',
      costBasisCents: 100,
      profitThresholdCents: 500,
    });

    expect(res.statusCode).toBe(200);
  });
});

describe('POST /api/lookup — burst traffic costs one marketplace call (US4)', () => {
  it('10 concurrent lookups from distinct callers make exactly one eBay call, all 200', async () => {
    const { app, client } = makeApp();

    const promises = Array.from({ length: 10 }, (_, i) =>
      lookup(app, { title: 'Chrono Trigger SNES' }, `10.0.0.${i + 1}`),
    );
    const responses = await Promise.all(promises);

    for (const res of responses) expect(res.statusCode).toBe(200);
    expect(client.calls).toHaveLength(1);
  });
});

describe('GET /api/meta (spec 006, research R5)', () => {
  it('reports client-facing settings straight from config', async () => {
    const { app } = makeApp({
      config: { defaultProfitThresholdCents: 1234, lookupDailyCap: 7, marketplaceId: 'EBAY_GB' },
    });

    const res = await app.inject({ method: 'GET', url: '/api/meta' });

    expect(res.statusCode).toBe(200);
    expect(res.headers['cache-control']).toBe('public, max-age=300');
    expect(res.json()).toEqual({
      defaultProfitThresholdCents: 1234,
      lookupDailyCap: 7,
      marketplaceId: 'EBAY_GB',
    });
  });

  it('is never charged against the per-client lookup cap', async () => {
    const { app } = makeApp({ config: { lookupDailyCap: 1 } });

    for (let i = 0; i < 3; i++) {
      const res = await app.inject({ method: 'GET', url: '/api/meta' });
      expect(res.statusCode).toBe(200);
    }
    // The cap is 1 and untouched so far — the first (and only) lookup still succeeds.
    expect((await lookup(app, { identifier: '9780345391803' })).statusCode).toBe(200);
  });
});

const WEB_CLIENT_CSP =
  "default-src 'self'; script-src 'self' 'wasm-unsafe-eval'; style-src 'self'; img-src 'self' data: blob:; connect-src 'self'; worker-src 'self'; manifest-src 'self'; media-src 'self' blob:; object-src 'none'; base-uri 'none'; frame-ancestors 'none'";

describe('web client static serving (spec 006, research R4/R8)', () => {
  let dir: string | undefined;

  afterEach(() => {
    if (dir !== undefined) rmSync(dir, { recursive: true, force: true });
    dir = undefined;
  });

  it('serves index.html and hashed assets with the specified headers when the dist dir exists', async () => {
    dir = mkdtempSync(path.join(os.tmpdir(), 'flip-or-rip-web-dist-'));
    writeFileSync(path.join(dir, 'index.html'), '<!doctype html><html><body>app</body></html>');
    mkdirSync(path.join(dir, 'assets'));
    writeFileSync(path.join(dir, 'assets', 'a.js'), 'console.log(1);');

    const { app } = makeApp({ config: { webDistDir: dir } });

    const indexRes = await app.inject({ method: 'GET', url: '/' });
    expect(indexRes.statusCode).toBe(200);
    expect(indexRes.headers['cache-control']).toBe('no-cache');
    expect(indexRes.headers['content-security-policy']).toBe(WEB_CLIENT_CSP);
    expect(indexRes.headers['referrer-policy']).toBe('no-referrer');
    expect(indexRes.headers['permissions-policy']).toBe('camera=(self)');

    const assetRes = await app.inject({ method: 'GET', url: '/assets/a.js' });
    expect(assetRes.statusCode).toBe(200);
    expect(assetRes.headers['cache-control']).toBe('public, max-age=31536000, immutable');
    // Security headers are HTML-only — an asset response must not carry them.
    expect(assetRes.headers['content-security-policy']).toBeUndefined();
    expect(assetRes.headers['referrer-policy']).toBeUndefined();
    expect(assetRes.headers['permissions-policy']).toBeUndefined();
  });

  it('registers nothing when the dist dir has no index.html, and /api/lookup is unaffected', async () => {
    const { app } = makeApp(); // testConfig.webDistDir points at a directory that doesn't exist

    const rootRes = await app.inject({ method: 'GET', url: '/' });
    expect(rootRes.statusCode).toBe(404);

    expect((await lookup(app, { identifier: '9780345391803' })).statusCode).toBe(200);
  });
});

describe('POST /api/lookup — competing supply drives liquidity, not raw total (US1)', () => {
  it('scales the raw total by dominance for a title search (MODERATE, not WEAK)', async () => {
    const { app } = makeApp({ client: new FakeBrowseClient(() => MIXED_SUPPLY_MARKET) });
    const body = (await lookup(app, { title: 'Chrono Trigger SNES' })).json();

    expect(body.matchConfidence).not.toBe('LOW');
    expect(body.rawActiveListingCount).toBe(80);
    expect(body.competingSupplyCount).toBe(40); // round(80 × 0.5)
    expect(body.liquidityTier).toBe('MODERATE'); // raw 80 would have been WEAK
    expect(body.verdict).toBe('FLIP');
  });

  it('a GTIN lookup keeps competingSupplyCount equal to the raw total', async () => {
    const { app } = makeApp();
    const body = (await lookup(app, { identifier: '9780345391803' })).json();
    expect(body.competingSupplyCount).toBe(body.rawActiveListingCount);
  });
});
