import { describe, expect, it } from 'vitest';
import { computeValuation } from './valuation.js';
import { identify } from './identify.js';
import type { EbayBrowseClient, SearchResult } from './ebay/types.js';

function listing(priceCents: number, title = `Listing at ${priceCents}`) {
  return { title, priceCents };
}

function fakeClient(result: SearchResult): EbayBrowseClient & { calls: object[] } {
  const calls: object[] = [];
  return {
    calls,
    async search(query) {
      calls.push(query);
      return result;
    },
  };
}

const gtinQuery = identify({ identifier: '9780345391803' });

describe('computeValuation', () => {
  it('takes the median of the 10 lowest positive prices from sorted listings', async () => {
    const listings = Array.from({ length: 50 }, (_, i) => listing((i + 1) * 100));
    const client = fakeClient({ listings, totalActive: 120 });

    const valuation = await computeValuation(gtinQuery, client);

    expect(valuation.samplePricesCents).toEqual([
      100, 200, 300, 400, 500, 600, 700, 800, 900, 1000,
    ]);
    expect(valuation.sampleSize).toBe(10);
    expect(valuation.estimatedValueCents).toBe(550); // median of 100..1000
    expect(valuation.activeListingCount).toBe(120);
  });

  it('uses a smaller sample when fewer than 10 listings exist', async () => {
    const client = fakeClient({
      listings: [listing(1000), listing(2000), listing(3000)],
      totalActive: 3,
    });

    const valuation = await computeValuation(gtinQuery, client);

    expect(valuation.sampleSize).toBe(3);
    expect(valuation.estimatedValueCents).toBe(2000);
  });

  it('skips zero-price listings', async () => {
    const client = fakeClient({
      listings: [listing(0), listing(0), listing(1500), listing(2500)],
      totalActive: 4,
    });

    const valuation = await computeValuation(gtinQuery, client);

    expect(valuation.samplePricesCents).toEqual([1500, 2500]);
    expect(valuation.sampleSize).toBe(2);
  });

  it('returns a cacheable sampleSize-0 valuation when there are no listings', async () => {
    const client = fakeClient({ listings: [], totalActive: 0 });

    const valuation = await computeValuation(gtinQuery, client);

    expect(valuation.sampleSize).toBe(0);
    expect(valuation.estimatedValueCents).toBe(0);
    expect(valuation.samplePricesCents).toEqual([]);
    expect(valuation.matchedTitle).toBeNull();
    expect(valuation.activeListingCount).toBe(0);
  });

  it('reports the top listing title as matchedTitle', async () => {
    const client = fakeClient({
      listings: [listing(999, 'Chrono Trigger (SNES, 1995)'), listing(1200)],
      totalActive: 2,
    });

    const valuation = await computeValuation(gtinQuery, client);

    expect(valuation.matchedTitle).toBe('Chrono Trigger (SNES, 1995)');
  });

  it('always flags ASKING_PRICE and stamps computedAt', async () => {
    const client = fakeClient({ listings: [listing(1000)], totalActive: 1 });

    const valuation = await computeValuation(gtinQuery, client);

    expect(valuation.pricingBasis).toBe('ASKING_PRICE');
    expect(Date.parse(valuation.computedAt)).not.toBeNaN();
  });
});
