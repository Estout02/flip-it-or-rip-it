// Pipeline step 2: ItemQuery → Valuation via the injected eBay client. The
// Valuation is the cached unit — per-request cost basis and threshold are
// applied later so users share it (research R6).

import type { PricingBasis } from './verdict.js';
import type { ItemQuery } from './identify.js';
import type { EbayBrowseClient, ListingSummary, SearchResult } from './ebay/types.js';

export interface Valuation {
  /** Prices of the MATCHED listings (≤50), not the cheapest overall. */
  samplePricesCents: number[];
  sampleSize: number;
  /** Raw marketplace `total` for the search that produced these listings. */
  activeListingCount: number;
  /**
   * The figure liquidity actually consumes. GTIN: equals activeListingCount
   * (eBay already constrained the search to one product). Title: the raw total
   * scaled down by how dominant the matched group was, floored at the number of
   * matched listings actually seen — filtered-out merchandise no longer counts
   * as competition (research R1).
   */
  competingSupplyCount: number;
  pricingBasis: PricingBasis;
  /** Representative title of the matched group — lets users spot a bad match. */
  matchedTitle: string | null;
  match: ProductMatch;
  /**
   * Which search actually produced these listings. A GTIN query that found
   * nothing falls back to a title search, and the result must then be treated as
   * a title result — keying off ItemQuery.kind would skip filtering on exactly
   * the path that needs it most (research R7).
   */
  sourcedFrom: 'gtin' | 'title';
  computedAt: string;
}

export type MatchConfidence = 'HIGH' | 'MEDIUM' | 'LOW';

export interface ProductMatch {
  categoryId: string | null;
  categoryName: string | null;
  /** Matched group's share of the returned listings. */
  dominanceShare: number;
  /** p75/p25 within the matched group; 1 when the group is too small to measure. */
  dispersionRatio: number;
  confidence: MatchConfidence;
  /** False when filtering was bypassed because the listings came from a GTIN search. */
  filtered: boolean;
}

/** Quartiles need a handful of points before they mean anything. */
const MIN_GROUP_FOR_DISPERSION = 4;

/** Barcode results stay on the original cheapest-N rule (FR-005). */
const GTIN_SAMPLE_MAX = 10;

export interface MatchConfig {
  /** Dominance at or above which a match reads as HIGH confidence. */
  minDominanceHigh: number;
  /** Dominance at or above which a match reads as MEDIUM. */
  minDominanceMedium: number;
  /** p75/p25 at or below which within-group spread reads as HIGH. */
  maxDispersionHigh: number;
  /** p75/p25 at or below which within-group spread reads as MEDIUM. */
  maxDispersionMedium: number;
}

/** Judgment calls, chosen so the live "Chrono Trigger SNES" case lands on LOW. */
export const MATCH_DEFAULTS: MatchConfig = {
  minDominanceHigh: 0.6,
  minDominanceMedium: 0.35,
  maxDispersionHigh: 2.5,
  maxDispersionMedium: 6,
};

export function resolveMatchConfig(overrides: Partial<MatchConfig> = {}): MatchConfig {
  return { ...MATCH_DEFAULTS, ...overrides };
}

/**
 * Free-text searches return the item mixed with things *about* the item —
 * stickers, magnets, mousepads, cases. Grouping by leaf category and keeping the
 * largest group separates the two, and a plurality vote is inherently tolerant of
 * the individual miscategorized listing live data showed exists.
 */
export function selectMatchedGroup(listings: ListingSummary[]): ListingSummary[] {
  const priced = listings.filter((l) => l.priceCents > 0);
  if (priced.length === 0) return [];
  const groups = new Map<string, ListingSummary[]>();
  for (const listing of priced) {
    // Listings without a category form their own group rather than being
    // dropped: if eBay omits categories entirely we still want a valuation.
    const key = listing.leafCategoryId ?? '';
    const group = groups.get(key);
    if (group) group.push(listing);
    else groups.set(key, [listing]);
  }
  // Strict > means the first group encountered keeps a tie. Insertion order is
  // relevance order for title searches (they are deliberately not price-sorted),
  // so an even split resolves toward the group holding the best-matching listing.
  let best: ListingSummary[] = [];
  for (const group of groups.values()) {
    if (group.length > best.length) best = group;
  }
  return best;
}

function percentile(sortedAsc: number[], fraction: number): number {
  const index = Math.min(sortedAsc.length - 1, Math.floor(sortedAsc.length * fraction));
  return sortedAsc[index]!;
}

/**
 * Two measures, and the worse one wins: either condition alone is enough to make
 * an estimate untrustworthy. Dominance catches "this query pulled in several
 * unrelated product types"; dispersion catches "one category, several distinct
 * products" — the live reference case, which dominance alone calls confident.
 */
export function assessMatch(
  matched: number[],
  returnedCount: number,
  config: MatchConfig,
): { dominanceShare: number; dispersionRatio: number; confidence: MatchConfidence } {
  const dominanceShare = returnedCount === 0 ? 0 : matched.length / returnedCount;
  const sorted = [...matched].sort((a, b) => a - b);
  const p25 = percentile(sorted, 0.25);
  const dispersionRatio =
    sorted.length < MIN_GROUP_FOR_DISPERSION || p25 <= 0 ? 1 : percentile(sorted, 0.75) / p25;

  const byDominance: MatchConfidence =
    dominanceShare >= config.minDominanceHigh
      ? 'HIGH'
      : dominanceShare >= config.minDominanceMedium
        ? 'MEDIUM'
        : 'LOW';
  const byDispersion: MatchConfidence =
    dispersionRatio <= config.maxDispersionHigh
      ? 'HIGH'
      : dispersionRatio <= config.maxDispersionMedium
        ? 'MEDIUM'
        : 'LOW';
  const rank = { HIGH: 2, MEDIUM: 1, LOW: 0 } as const;
  const confidence = rank[byDominance] <= rank[byDispersion] ? byDominance : byDispersion;
  return { dominanceShare, dispersionRatio, confidence };
}

/**
 * A sampleSize-0 valuation is a legitimate "no market data" result and is still
 * cached: a barcode with no listings stays no-market for the TTL, saving quota.
 */
export interface ComputeValuationOptions {
  /**
   * Skip the barcode search entirely and go straight to the title search
   * (research R2): used when the pipeline already knows, from a cached empty
   * `gtin:` entry, that the barcode itself has nothing to offer, and only the
   * per-title fallback needs computing. With no title to fall back to, returns
   * emptyBarcodeValuation() without making any call.
   */
  skipBarcodeSearch?: boolean;
}

export async function computeValuation(
  query: ItemQuery,
  client: EbayBrowseClient,
  /** Optional so the 8 existing call sites keep compiling (analysis F3). */
  matchConfig: MatchConfig = MATCH_DEFAULTS,
  options: ComputeValuationOptions = {},
): Promise<Valuation> {
  let result: SearchResult;
  let sourcedFrom: 'gtin' | 'title';
  if (options.skipBarcodeSearch) {
    if (query.titleQuery === undefined) return emptyBarcodeValuation();
    result = await client.search({ title: query.titleQuery });
    sourcedFrom = 'title';
  } else if (query.kind === 'gtin') {
    result = await client.search({ gtin: query.gtin! });
    sourcedFrom = 'gtin';
    if (result.listings.length === 0 && query.titleQuery !== undefined) {
      // Barcode found nothing on eBay; one title-search fallback (FR-003).
      result = await client.search({ title: query.titleQuery });
      sourcedFrom = 'title';
    }
  } else {
    result = await client.search({ title: query.titleQuery! });
    sourcedFrom = 'title';
  }

  let samplePricesCents: number[];
  let matchedTitle: string | null;
  let match: ProductMatch;
  let competingSupplyCount: number;

  if (sourcedFrom === 'gtin') {
    // eBay already constrained these to one product — behaviour unchanged (FR-005).
    samplePricesCents = result.listings
      .map((l) => l.priceCents)
      .filter((cents) => cents > 0)
      .sort((a, b) => a - b)
      .slice(0, GTIN_SAMPLE_MAX);
    matchedTitle = result.listings[0]?.title ?? null;
    match = {
      categoryId: null,
      categoryName: null,
      dominanceShare: 1,
      dispersionRatio: 1,
      confidence: 'HIGH',
      filtered: false,
    };
    // eBay already constrained this search to one product — no scaling needed.
    competingSupplyCount = result.totalActive;
  } else {
    const matched = selectMatchedGroup(result.listings);
    // Relevance order is preserved by not price-sorting title searches, so the
    // first matched listing is the most relevant one.
    matchedTitle = matched[0]?.title ?? null;
    samplePricesCents = matched.map((l) => l.priceCents).sort((a, b) => a - b);
    const assessed = assessMatch(samplePricesCents, result.listings.length, matchConfig);
    match = {
      categoryId: matched[0]?.leafCategoryId ?? null,
      categoryName: matched[0]?.leafCategoryName ?? null,
      ...assessed,
      filtered: true,
    };
    // Floor at matched.length: handles both dominance rounding to 0 on a tiny
    // matched group, and eBay reporting a total smaller than the sample seen.
    competingSupplyCount = Math.max(
      matched.length,
      Math.round(result.totalActive * assessed.dominanceShare),
    );
  }

  return {
    samplePricesCents,
    sampleSize: samplePricesCents.length,
    activeListingCount: result.totalActive,
    competingSupplyCount,
    pricingBasis: 'ADJUSTED_ASKING_PRICE',
    matchedTitle,
    match,
    sourcedFrom,
    computedAt: new Date().toISOString(),
  };
}

/**
 * The cacheable answer for "this barcode has no listings on eBay" (research
 * R2 / data-model.md). Given its own function so every call site that needs to
 * write this exact shape — the barcode search itself, and the pipeline's cache
 * ladder when a full valuation resolves via the title fallback — agrees on it.
 */
export function emptyBarcodeValuation(): Valuation {
  return {
    samplePricesCents: [],
    sampleSize: 0,
    activeListingCount: 0,
    competingSupplyCount: 0,
    pricingBasis: 'ADJUSTED_ASKING_PRICE',
    matchedTitle: null,
    match: {
      categoryId: null,
      categoryName: null,
      dominanceShare: 1,
      dispersionRatio: 1,
      confidence: 'HIGH',
      filtered: false,
    },
    sourcedFrom: 'gtin',
    computedAt: new Date().toISOString(),
  };
}

/** A barcode search that came back with nothing — the cache-ladder trigger for the title fallback. */
export function isEmptyBarcodeValuation(valuation: Valuation): boolean {
  return valuation.sourcedFrom === 'gtin' && valuation.sampleSize === 0;
}
