// Orchestrates the four pipeline steps — identify → valuation → shipping →
// verdict — plus the valuation cache and eBay-call guards. Steps communicate
// only via their declared input/output types (constitution VII); post-verdict
// hooks (auto-listing, drafts) attach here after computeVerdict.

import { identify } from './identify.js';
import { computeValuation, type Valuation } from './valuation.js';
import { estimateShipping } from './shipping.js';
import { computeVerdict, type Verdict } from './verdict.js';
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
  };
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

export async function lookup(
  request: LookupRequest,
  deps: PipelineDeps,
): Promise<VerdictResult> {
  const query = identify({
    ...(request.identifier !== undefined ? { identifier: request.identifier } : {}),
    ...(request.title !== undefined ? { title: request.title } : {}),
  });

  let valuation = deps.cache.get(query.cacheKey);
  const cached = valuation !== undefined;
  if (valuation === undefined) {
    if (deps.rateLimiter.inCooldown()) {
      throw new EbayUnavailableError('Marketplace lookup is cooling down after an eBay error.');
    }
    valuation = await computeValuation(query, guardedClient(deps));
    deps.cache.set(query.cacheKey, valuation);
  }

  const shipping = estimateShipping(deps.config.shippingFlatCents);

  const verdict = computeVerdict({
    samplePricesCents: valuation.samplePricesCents,
    pricingBasis: valuation.pricingBasis,
    activeListingCount: valuation.activeListingCount,
    shippingEstimateCents: shipping.shippingEstimateCents,
    costBasisCents: request.costBasisCents ?? 0,
    profitThresholdCents:
      request.profitThresholdCents ?? deps.config.defaultProfitThresholdCents,
    feeRate: deps.config.feeRate,
  });

  return {
    ...verdict,
    matchedTitle: valuation.matchedTitle,
    cached,
    query: {
      identifier: request.identifier ?? null,
      title: request.title ?? null,
    },
  };
}
