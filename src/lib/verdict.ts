// Core flip/rip decision math. All money values are integer cents.

export type PricingBasis = 'ASKING_PRICE';
export type LiquidityBasis = 'SUPPLY_SIDE_ONLY';

export interface ValuationInput {
  /**
   * Market sample prices in cents, e.g. the lowest active asking prices until
   * Marketplace Insights sold data is granted. What they are is declared by
   * pricingBasis, which passes through to the verdict untouched.
   */
  samplePricesCents: number[];
  pricingBasis: PricingBasis;
  /** Count of currently active listings for the same item. */
  activeListingCount: number;
  /** Estimated cost to ship, in cents. */
  shippingEstimateCents: number;
  /** What the user paid for the item, in cents (0 for stuff they already own). */
  costBasisCents: number;
  /** Minimum acceptable profit, in cents. */
  profitThresholdCents: number;
  /** eBay final value fee rate (varies by category; ~13.25% typical). */
  feeRate?: number;
}

export interface Verdict {
  verdict: 'FLIP' | 'RIP';
  estimatedValueCents: number;
  feesCents: number;
  shippingEstimateCents: number;
  profitCents: number;
  /** 0–1; see supplySideLiquidity — degraded signal until sold data exists. */
  liquidityScore: number;
  liquidityBasis: LiquidityBasis;
  sampleSize: number;
  pricingBasis: PricingBasis;
  /** True iff the sample was empty — no evidence of a market. */
  noMarketData: boolean;
}

const DEFAULT_FEE_RATE = 0.1325;

/** Active-listing count at or below which supply reads as fully liquid. */
export const LIQUIDITY_STRONG_SUPPLY_MAX = 10;

/** Median of the sample prices — robust against one outlier skewing the value. */
export function estimateValueCents(samplePricesCents: number[]): number {
  if (samplePricesCents.length === 0) return 0;
  const sorted = [...samplePricesCents].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1
    ? sorted[mid]!
    : Math.round((sorted[mid - 1]! + sorted[mid]!) / 2);
}

/**
 * Supply-side-only liquidity heuristic: min(1, 10/active), 0 when no listings.
 * Directionally right without sold data — a $150 book with hundreds of active
 * listings scores near 0. Replaced by liquidityScore once sold data arrives.
 */
export function supplySideLiquidity(
  activeListingCount: number,
  strongSupplyMax: number = LIQUIDITY_STRONG_SUPPLY_MAX,
): number {
  if (activeListingCount <= 0) return 0;
  return Math.min(1, strongSupplyMax / activeListingCount);
}

/**
 * Sell-through proxy: sold sample vs. active supply. The real formula, waiting
 * on Marketplace Insights sold data — not used by computeVerdict until then.
 */
export function liquidityScore(soldCount: number, activeListingCount: number): number {
  if (soldCount === 0) return 0;
  return soldCount / (soldCount + activeListingCount);
}

export function computeVerdict(input: ValuationInput): Verdict {
  const feeRate = input.feeRate ?? DEFAULT_FEE_RATE;
  const estimatedValueCents = estimateValueCents(input.samplePricesCents);
  const feesCents = Math.round(estimatedValueCents * feeRate);
  const profitCents =
    estimatedValueCents - feesCents - input.shippingEstimateCents - input.costBasisCents;
  const sampleSize = input.samplePricesCents.length;

  // No market sample at all means there is no evidence of a market: RIP.
  const verdict =
    estimatedValueCents > 0 && profitCents >= input.profitThresholdCents ? 'FLIP' : 'RIP';

  return {
    verdict,
    estimatedValueCents,
    feesCents,
    shippingEstimateCents: input.shippingEstimateCents,
    profitCents,
    liquidityScore: supplySideLiquidity(input.activeListingCount),
    liquidityBasis: 'SUPPLY_SIDE_ONLY',
    sampleSize,
    pricingBasis: input.pricingBasis,
    noMarketData: sampleSize === 0,
  };
}
