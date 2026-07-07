// Core flip/rip decision math. All money values are integer cents.

export interface ValuationInput {
  /** Recent sold prices from eBay, in cents, most recent first. */
  soldPricesCents: number[];
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
  /** 0–1; sold velocity vs. active supply. Low = illiquid even if the price looks good. */
  liquidityScore: number;
  sampleSize: number;
}

const DEFAULT_FEE_RATE = 0.1325;

/** Median of recent sold prices — robust against one outlier sale skewing the value. */
export function estimateValueCents(soldPricesCents: number[]): number {
  if (soldPricesCents.length === 0) return 0;
  const sorted = [...soldPricesCents].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1
    ? sorted[mid]!
    : Math.round((sorted[mid - 1]! + sorted[mid]!) / 2);
}

/**
 * Sell-through proxy: sold sample vs. active supply. A $150 book with one sale and
 * hundreds of active listings should score near 0 and push the verdict toward RIP.
 */
export function liquidityScore(soldCount: number, activeListingCount: number): number {
  if (soldCount === 0) return 0;
  return soldCount / (soldCount + activeListingCount);
}

export function computeVerdict(input: ValuationInput): Verdict {
  const feeRate = input.feeRate ?? DEFAULT_FEE_RATE;
  const estimatedValueCents = estimateValueCents(input.soldPricesCents);
  const feesCents = Math.round(estimatedValueCents * feeRate);
  const profitCents =
    estimatedValueCents - feesCents - input.shippingEstimateCents - input.costBasisCents;
  const liquidity = liquidityScore(input.soldPricesCents.length, input.activeListingCount);

  // No sold history at all means there is no evidence of a market: RIP.
  const verdict =
    estimatedValueCents > 0 && profitCents >= input.profitThresholdCents ? 'FLIP' : 'RIP';

  return {
    verdict,
    estimatedValueCents,
    feesCents,
    shippingEstimateCents: input.shippingEstimateCents,
    profitCents,
    liquidityScore: liquidity,
    sampleSize: input.soldPricesCents.length,
  };
}
