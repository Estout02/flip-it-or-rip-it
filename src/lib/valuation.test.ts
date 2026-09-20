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
    expect(valuation.activeListingCount).toBe(120);
  });

  it('uses a smaller sample when fewer than 10 listings exist', async () => {
    const client = fakeClient({
      listings: [listing(1000), listing(2000), listing(3000)],
      totalActive: 3,
    });

    const valuation = await computeValuation(gtinQuery, client);

    expect(valuation.sampleSize).toBe(3);
    expect(valuation.samplePricesCents).toHaveLength(3);
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

  it('always flags ADJUSTED_ASKING_PRICE and stamps computedAt', async () => {
    const client = fakeClient({ listings: [listing(1000)], totalActive: 1 });

    const valuation = await computeValuation(gtinQuery, client);

    expect(valuation.pricingBasis).toBe('ADJUSTED_ASKING_PRICE');
    expect(Date.parse(valuation.computedAt)).not.toBeNaN();
  });
});

// ---- spec 004: product match filtering ----

/** Listing with a leaf category, mirroring live eBay responses. */
function catListing(priceCents: number, categoryId: string, categoryName: string, title?: string) {
  return {
    title: title ?? `${categoryName} item at ${priceCents}`,
    priceCents,
    leafCategoryId: categoryId,
    leafCategoryName: categoryName,
  };
}

const GAMES = ['139973', 'Video Games'] as const;

/** Mirrors the live "Chrono Trigger SNES" failure: cheap junk, dominant games. */
function contaminatedResult(): SearchResult {
  return {
    listings: [
      catListing(549, '38583', 'Video Game Merchandise', 'Vinyl Bumper Sticker'),
      catListing(695, '38583', 'Video Game Merchandise', 'Box Art Magnet'),
      catListing(895, '476', 'Refrigerator Magnets', 'Fridge Magnet'),
      catListing(595, '23895', 'Mouse Pads & Wrist Rests', 'Mousepad'),
      catListing(1099, '3628', 'Modern (1970-Now)', 'Cartridge Keychain'),
      catListing(5500, ...GAMES, 'Chrono Trigger SNES Authentic Cart'),
      catListing(6000, ...GAMES, 'Chrono Trigger SNES Cart Only'),
      catListing(6500, ...GAMES, 'Chrono Trigger Super Nintendo'),
      catListing(7000, ...GAMES, 'Chrono Trigger SNES Tested'),
      catListing(7500, ...GAMES, 'Chrono Trigger SNES Working'),
    ],
    totalActive: 424,
  };
}

const titleQuery = identify({ title: 'Chrono Trigger SNES' });

describe('computeValuation — product match filtering (US1)', () => {
  it('excludes accessories and values the dominant product group', async () => {
    const valuation = await computeValuation(titleQuery, fakeClient(contaminatedResult()));

    // Every accessory price must be absent from the sample.
    for (const junk of [549, 695, 895, 595, 1099]) {
      expect(valuation.samplePricesCents).not.toContain(junk);
    }
    expect(valuation.samplePricesCents).toEqual([5500, 6000, 6500, 7000, 7500]);
    expect(valuation.sampleSize).toBe(5);
  });

  it('draws matchedTitle from the matched group, never an accessory', async () => {
    const valuation = await computeValuation(titleQuery, fakeClient(contaminatedResult()));
    expect(valuation.matchedTitle).toBe('Chrono Trigger SNES Authentic Cart');
  });

  it('values the matched group rather than the ten cheapest overall', async () => {
    // 12 expensive games outnumber 8 cheaper accessories: a "ten cheapest" rule
    // would return only junk; the matched group must win regardless of price.
    const listings = [
      ...Array.from({ length: 8 }, (_, i) => catListing(100 + i, '476', 'Refrigerator Magnets')),
      ...Array.from({ length: 12 }, (_, i) => catListing(9000 + i * 100, ...GAMES)),
    ];
    const valuation = await computeValuation(titleQuery, fakeClient({ listings, totalActive: 50 }));
    expect(valuation.sampleSize).toBe(12);
    expect(Math.min(...valuation.samplePricesCents)).toBeGreaterThanOrEqual(9000);
  });

  it('breaks a tie toward the more relevant group', async () => {
    // Equal-sized groups: relevance order decides, since title searches are not
    // price-sorted and eBay returns the best match first.
    const listings = [
      ...Array.from({ length: 5 }, (_, i) => catListing(9000 + i, ...GAMES)),
      ...Array.from({ length: 5 }, (_, i) => catListing(100 + i, '476', 'Refrigerator Magnets')),
    ];
    const valuation = await computeValuation(titleQuery, fakeClient({ listings, totalActive: 20 }));
    expect(Math.min(...valuation.samplePricesCents)).toBeGreaterThanOrEqual(9000);
  });

  it('tolerates a single miscategorized listing', async () => {
    const listings = [
      ...Array.from({ length: 9 }, (_, i) => catListing(6000 + i * 100, ...GAMES)),
      catListing(1099, '3628', 'Modern (1970-Now)', 'Keychain filed under coins'),
    ];
    const valuation = await computeValuation(titleQuery, fakeClient({ listings, totalActive: 30 }));
    expect(valuation.sampleSize).toBe(9);
    expect(valuation.samplePricesCents).not.toContain(1099);
  });

  it('does NOT filter a GTIN-sourced result set', async () => {
    // Barcode results are already product-constrained; behaviour must be unchanged.
    const listings = Array.from({ length: 50 }, (_, i) => listing((i + 1) * 100));
    const valuation = await computeValuation(gtinQuery, fakeClient({ listings, totalActive: 120 }));
    expect(valuation.samplePricesCents).toEqual([100, 200, 300, 400, 500, 600, 700, 800, 900, 1000]);
  });

  it('DOES filter when a GTIN search falls back to a title search', async () => {
    // The trap: keying the bypass on ItemQuery.kind would hand title results the
    // barcode's trust on exactly the path that needs filtering most.
    const fallbackQuery = identify({ identifier: '9780345391803', title: 'Chrono Trigger SNES' });
    const client: EbayBrowseClient = {
      async search(q) {
        return q.gtin ? { listings: [], totalActive: 0 } : contaminatedResult();
      },
    };
    const valuation = await computeValuation(fallbackQuery, client);
    expect(valuation.samplePricesCents).not.toContain(549);
    expect(valuation.sampleSize).toBe(5);
  });
});

describe('computeValuation — match confidence (US2)', () => {
  it('reports dominance as the matched share of returned listings', async () => {
    const valuation = await computeValuation(titleQuery, fakeClient(contaminatedResult()));
    // 5 games out of 10 returned listings.
    expect(valuation.match.dominanceShare).toBeCloseTo(0.5);
    expect(valuation.match.categoryId).toBe('139973');
    expect(valuation.match.categoryName).toBe('Video Games');
    expect(valuation.match.filtered).toBe(true);
  });

  it('reports dispersion as p75/p25 within the matched group', async () => {
    const listings = [100, 200, 300, 400, 500, 600, 700, 800].map((c) => catListing(c, ...GAMES));
    const valuation = await computeValuation(titleQuery, fakeClient({ listings, totalActive: 8 }));
    expect(valuation.match.dispersionRatio).toBeGreaterThan(1);
    expect(Number.isFinite(valuation.match.dispersionRatio)).toBe(true);
  });

  it('treats a group of fewer than four listings as having no measurable spread', async () => {
    const listings = [100, 9000, 50000].map((c) => catListing(c, ...GAMES));
    const valuation = await computeValuation(titleQuery, fakeClient({ listings, totalActive: 3 }));
    expect(valuation.match.dispersionRatio).toBe(1);
  });

  it('is LOW when a dominant category still holds several distinct products', async () => {
    // The live reference case: one category, Japanese imports beside US carts.
    const listings = [
      ...[600, 900, 1000, 1100, 1200, 1500, 2000, 2500].map((c) => catListing(c, ...GAMES)),
      ...[24000, 30000, 50000, 80000].map((c) => catListing(c, ...GAMES)),
    ];
    const valuation = await computeValuation(titleQuery, fakeClient({ listings, totalActive: 12 }));
    expect(valuation.match.dominanceShare).toBe(1); // dominance says "confident"
    expect(valuation.match.confidence).toBe('LOW'); // dispersion overrules it
  });

  it('is LOW when listings spread evenly across categories', async () => {
    const listings = [
      catListing(1000, ...GAMES),
      catListing(1100, '476', 'Refrigerator Magnets'),
      catListing(1200, '23895', 'Mouse Pads & Wrist Rests'),
      catListing(1300, '38583', 'Video Game Merchandise'),
    ];
    const valuation = await computeValuation(titleQuery, fakeClient({ listings, totalActive: 4 }));
    expect(valuation.match.dominanceShare).toBeLessThan(0.35);
    expect(valuation.match.confidence).toBe('LOW');
  });

  it('reports a GTIN lookup as unfiltered and confidently matched', async () => {
    const listings = Array.from({ length: 20 }, (_, i) => listing(5000 + i * 10));
    const valuation = await computeValuation(gtinQuery, fakeClient({ listings, totalActive: 20 }));
    expect(valuation.match.filtered).toBe(false);
    expect(valuation.match.confidence).toBe('HIGH');
    expect(valuation.match.categoryId).toBeNull();
  });
});
