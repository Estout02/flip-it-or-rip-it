// Orchestrates the four pipeline steps — identify → valuation → shipping →
// verdict — plus the valuation cache and eBay-call guards. Steps communicate
// only via their declared input/output types (constitution VII); post-verdict
// hooks (auto-listing, drafts) attach here after computeVerdict.

import { identify, type ItemQuery } from './identify.js';
import {
  computeValuation,
  emptyBarcodeValuation,
  isEmptyBarcodeValuation,
  type MatchConfig,
  type Valuation,
} from './valuation.js';
import { estimateShipping } from './shipping.js';
import { computeVerdict, type LiquidityConfig, type Verdict } from './verdict.js';
import type { TtlCache } from './cache.js';
import type { RateLimiter } from './rate-limit.js';
import { EbayUnavailableError, type EbayBrowseClient } from './ebay/types.js';

export interface LookupRequest {
  identifier?: string;
  title?: string;
  costBasisCents?: number;
  profitThresholdCents?: number;
}

export interface VerdictResult extends Verdict {
  matchedTitle: string | null;
  matchedCategoryName: string | null;
  matchDominance: number;
  matchFiltered: boolean;
  /** eBay's raw reported total for the search that produced the sample. */
  rawActiveListingCount: number;
  /** The figure the liquidity tier/score/reason actually used (research R1). */
  competingSupplyCount: number;
  /** True when served from the cached valuation (zero external calls). */
  cached: boolean;
  query: { identifier: string | null; title: string | null };
}

export interface PipelineDeps {
  browseClient: EbayBrowseClient;
  cache: TtlCache<Valuation>;
  rateLimiter: RateLimiter;
  config: {
    feeRate: number;
    shippingFlatCents: number;
    defaultProfitThresholdCents: number;
    liquidity: LiquidityConfig;
    realizationRate: number;
    match: MatchConfig;
  };
}

/**
 * In-flight valuation computations, one Map per cache instance so every test
 * that builds its own TtlCache is automatically isolated from every other
 * (research R5). A WeakMap keeps this out of PipelineDeps/AppDeps entirely —
 * no shape change, and the map entry disappears with the cache.
 */
const inflightByCache = new WeakMap<TtlCache<Valuation>, Map<string, Promise<Valuation>>>();

/**
 * Dedupes concurrent computations for the same cache key: the first caller's
 * compute() runs and is shared by every caller that arrives before it settles;
 * a caller arriving after settlement (success OR failure) starts a fresh one.
 * Registration happens synchronously (before compute's first await), so a
 * burst of synchronous calls for one key reliably collapses to one computation
 * (SC-005) — a rejection is never memoized, only the in-flight promise is.
 */
function coalesce(
  cache: TtlCache<Valuation>,
  key: string,
  compute: () => Promise<Valuation>,
): Promise<Valuation> {
  let inflight = inflightByCache.get(cache);
  if (!inflight) {
    inflight = new Map();
    inflightByCache.set(cache, inflight);
  }
  const existing = inflight.get(key);
  if (existing !== undefined) return existing;

  const promise = compute().finally(() => {
    // Only delete our own entry: a slow finally could otherwise race a
    // newer computation for the same key that started after us.
    if (inflight!.get(key) === promise) inflight!.delete(key);
  });
  inflight.set(key, promise);
  return promise;
}

/**
 * Wraps the raw client with the cost guards: every actual eBay call is checked
 * against the daily budget and counted; an eBay failure starts the cooldown.
 * Cache hits never reach this wrapper, so they cost nothing (FR-011).
 */
function guardedClient(deps: PipelineDeps): EbayBrowseClient {
  const { browseClient, rateLimiter } = deps;
  return {
    async search(query) {
      if (!rateLimiter.hasEbayBudget()) {
        throw new EbayUnavailableError('Daily eBay call budget exhausted.');
      }
      rateLimiter.countEbayCall();
      try {
        return await browseClient.search(query);
      } catch (err) {
        if (err instanceof EbayUnavailableError) rateLimiter.startCooldown();
        throw err;
      }
    },
  };
}

/**
 * The data-model "Cache key states" cache-ladder for a barcode query (research
 * R2), plus the plain single-key case for a title-only query. Guarantees:
 * a non-empty `gtin:` entry always wins outright (title is irrelevant once the
 * barcode itself has an answer — FR-008); an empty `gtin:` entry unlocks a
 * *per-title* fallback answer, keyed separately so it survives independently
 * of the barcode entry and doesn't get re-computed for the same title twice.
 */
async function resolveValuation(
  query: ItemQuery,
  deps: PipelineDeps,
): Promise<{ valuation: Valuation; cached: boolean }> {
  const guarded = guardedClient(deps);

  // Coalesced so a burst of identical concurrent lookups shares one computation
  // (research R5): the cache write happens inside the shared compute, so it
  // happens exactly once, and the cooldown check runs once per computation
  // (not once per caller) since only the winning call ever invokes `run`.
  function computeAndCache(key: string, run: () => Promise<Valuation>): Promise<Valuation> {
    return coalesce(deps.cache, key, async () => {
      if (deps.rateLimiter.inCooldown()) {
        throw new EbayUnavailableError('Marketplace lookup is cooling down after an eBay error.');
      }
      const valuation = await run();
      deps.cache.set(key, valuation);
      return valuation;
    });
  }

  if (query.kind !== 'gtin') {
    // Plain title query: one key, no fallback ladder.
    const cached = deps.cache.get(query.cacheKey);
    if (cached !== undefined) return { valuation: cached, cached: true };
    const valuation = await computeAndCache(query.cacheKey, () =>
      computeValuation(query, guarded, deps.config.match),
    );
    return { valuation, cached: false };
  }

  const barcodeEntry = deps.cache.get(query.cacheKey);

  if (barcodeEntry !== undefined && !isEmptyBarcodeValuation(barcodeEntry)) {
    // Row 1: non-empty barcode answer — title is irrelevant, serve it.
    return { valuation: barcodeEntry, cached: true };
  }

  if (barcodeEntry !== undefined) {
    // Barcode is cached and known empty.
    if (query.titleQuery === undefined) {
      // Row 2: empty, no title to fall back to.
      return { valuation: barcodeEntry, cached: true };
    }
    const fallbackKey = query.fallbackCacheKey!;
    const fallbackEntry = deps.cache.get(fallbackKey);
    if (fallbackEntry !== undefined) {
      // Row 3: empty barcode, this title's fallback already computed.
      return { valuation: fallbackEntry, cached: true };
    }
    // Row 4: empty barcode, this title not yet tried — title-only valuation.
    const valuation = await computeAndCache(fallbackKey, () =>
      computeValuation(query, guarded, deps.config.match, { skipBarcodeSearch: true }),
    );
    return { valuation, cached: false };
  }

  // Barcode entry not cached at all.
  if (query.titleQuery === undefined) {
    // Row 5: absent, no title — full barcode valuation.
    const valuation = await computeAndCache(query.cacheKey, () =>
      computeValuation(query, guarded, deps.config.match),
    );
    return { valuation, cached: false };
  }

  const fallbackKey = query.fallbackCacheKey!;
  const fallbackEntry = deps.cache.get(fallbackKey);
  if (fallbackEntry !== undefined) {
    // Barcode absent but its fallback survives (gtin: entry expired first,
    // written at the same instant as a longer-lived fallback would not
    // normally happen under one shared TTL, but this is still the correct
    // answer to serve if it ever does — data-model.md).
    return { valuation: fallbackEntry, cached: true };
  }

  // Row 6/7: barcode entry absent, title given, fallback absent — full
  // valuation. computeValuation's own internal fallback (FR-003) makes the
  // barcode call and, on an empty result, the title call in one pass (1-2
  // marketplace calls total). Coalesced on fallbackKey — the (barcode, title)
  // pair identifies this exact computation regardless of which key the result
  // ends up stored under.
  const result = await coalesce(deps.cache, fallbackKey, async () => {
    if (deps.rateLimiter.inCooldown()) {
      throw new EbayUnavailableError('Marketplace lookup is cooling down after an eBay error.');
    }
    const computed = await computeValuation(query, guarded, deps.config.match);
    if (computed.sourcedFrom === 'gtin') {
      // Barcode hit — store under gtin: only, same as the no-title case.
      deps.cache.set(query.cacheKey, computed);
    } else {
      // Fallback answered it — the barcode itself is now known-empty, and the
      // fallback answer is per-title; store both (research R2 row 4 of the table).
      deps.cache.set(query.cacheKey, emptyBarcodeValuation());
      deps.cache.set(fallbackKey, computed);
    }
    return computed;
  });
  return { valuation: result, cached: false };
}

export async function lookup(
  request: LookupRequest,
  deps: PipelineDeps,
): Promise<VerdictResult> {
  const query = identify({
    ...(request.identifier !== undefined ? { identifier: request.identifier } : {}),
    ...(request.title !== undefined ? { title: request.title } : {}),
  });

  const { valuation, cached } = await resolveValuation(query, deps);

  const shipping = estimateShipping(deps.config.shippingFlatCents);

  const verdict = computeVerdict({
    samplePricesCents: valuation.samplePricesCents,
    pricingBasis: valuation.pricingBasis,
    // Liquidity reads the item's OWN competing supply, not the raw marketplace
    // total — for title searches that total includes filtered-out merchandise
    // (research R1). computeVerdict's interface is unchanged (constitution VII):
    // it still just reads "activeListingCount".
    activeListingCount: valuation.competingSupplyCount,
    shippingEstimateCents: shipping.shippingEstimateCents,
    costBasisCents: request.costBasisCents ?? 0,
    profitThresholdCents:
      request.profitThresholdCents ?? deps.config.defaultProfitThresholdCents,
    feeRate: deps.config.feeRate,
    liquidity: deps.config.liquidity,
    realizationRate: deps.config.realizationRate,
    matchConfidence: valuation.match.confidence,
  });

  return {
    ...verdict,
    matchedTitle: valuation.matchedTitle,
    matchedCategoryName: valuation.match.categoryName,
    matchDominance: valuation.match.dominanceShare,
    matchFiltered: valuation.match.filtered,
    rawActiveListingCount: valuation.activeListingCount,
    competingSupplyCount: valuation.competingSupplyCount,
    cached,
    query: {
      identifier: request.identifier ?? null,
      title: request.title ?? null,
    },
  };
}
