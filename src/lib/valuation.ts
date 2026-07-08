// Pipeline step 2: ItemQuery → Valuation via the injected eBay client. The
// Valuation is the cached unit — per-request cost basis and threshold are
// applied later so users share it (research R6).

import { estimateValueCents, type PricingBasis } from './verdict.js';
import type { ItemQuery } from './identify.js';
import type { EbayBrowseClient, SearchResult } from './ebay/types.js';

export interface Valuation {
  estimatedValueCents: number;
  /** The ≤10 lowest positive asking prices actually used (audit/debug). */
  samplePricesCents: number[];
  sampleSize: number;
  activeListingCount: number;
  pricingBasis: PricingBasis;
  /** Top listing's title — lets users spot a mismatched product. */
  matchedTitle: string | null;
  computedAt: string;
}

const SAMPLE_MAX = 10;

/**
 * A sampleSize-0 valuation is a legitimate "no market data" result and is still
 * cached: a barcode with no listings stays no-market for the TTL, saving quota.
 */
export async function computeValuation(
  query: ItemQuery,
  client: EbayBrowseClient,
): Promise<Valuation> {
  let result: SearchResult;
  if (query.kind === 'gtin') {
    result = await client.search({ gtin: query.gtin! });
    if (result.listings.length === 0 && query.titleQuery !== undefined) {
      // Barcode found nothing on eBay; one title-search fallback (FR-003).
      result = await client.search({ title: query.titleQuery });
    }
  } else {
    result = await client.search({ title: query.titleQuery! });
  }

  // Defensive re-sort: the API returns price-ascending, fakes might not.
  const samplePricesCents = result.listings
    .map((l) => l.priceCents)
    .filter((cents) => cents > 0)
    .sort((a, b) => a - b)
    .slice(0, SAMPLE_MAX);

  return {
    estimatedValueCents: estimateValueCents(samplePricesCents),
    samplePricesCents,
    sampleSize: samplePricesCents.length,
    activeListingCount: result.totalActive,
    pricingBasis: 'ASKING_PRICE',
    matchedTitle: result.listings[0]?.title ?? null,
    computedAt: new Date().toISOString(),
  };
}
