// Core flip/rip decision math. All money values are integer cents.

export type PricingBasis = 'ASKING_PRICE';
export type LiquidityBasis = 'SUPPLY_SIDE_ONLY';

/** Banded read of competing supply, derived from active listing count alone. */
export type LiquidityTier = 'STRONG' | 'MODERATE' | 'WEAK' | 'UNPROVEN';

/** Why the verdict came out the way it did. Exactly one is emitted per result. */
export type VerdictReasonCode =
  | 'NO_MARKET_DATA'
  | 'BELOW_THRESHOLD'
  | 'WEAK_LIQUIDITY_THIN_MARGIN'
  | 'WEAK_LIQUIDITY_HIGH_VALUE'
  | 'PROFITABLE';

export interface LiquidityConfig {
  /** Active-listing count at or below which supply reads as fully liquid. */
  strongMaxListings: number;
  /** Upper bound of the moderate band; above it, supply is weak. */
  moderateMaxListings: number;
  /** Profit multiple of the threshold that counts as a comfortable margin. */
  riskyMarginMultiplier: number;
}

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
  /** Liquidity tier/gate tuning; per-field defaults from LIQUIDITY_DEFAULTS. */
  liquidity?: Partial<LiquidityConfig>;
}

export interface Verdict {
  verdict: 'FLIP' | 'FLIP_RISKY' | 'RIP';
  estimatedValueCents: number;
  feesCents: number;
  shippingEstimateCents: number;
  profitCents: number;
  /** 0–1; see supplySideLiquidity — degraded signal until sold data exists. */
  liquidityScore: number;
  /** Banded read of competing supply; only WEAK can change the verdict. */
  liquidityTier: LiquidityTier;
  liquidityBasis: LiquidityBasis;
  /** Stable machine-readable explanation; exactly one per result. */
  reasonCode: VerdictReasonCode;
  /** Plain-language rendering of reasonCode, safe to show a user. */
  reason: string;
  sampleSize: number;
  pricingBasis: PricingBasis;
  /** True iff the sample was empty — no evidence of a market. */
  noMarketData: boolean;
}

const DEFAULT_FEE_RATE = 0.1325;

/** Active-listing count at or below which supply reads as fully liquid. */
export const LIQUIDITY_STRONG_SUPPLY_MAX = 10;

export const LIQUIDITY_DEFAULTS: LiquidityConfig = {
  strongMaxListings: LIQUIDITY_STRONG_SUPPLY_MAX,
  moderateMaxListings: 50,
  riskyMarginMultiplier: 2,
};

export function resolveLiquidityConfig(
  overrides: Partial<LiquidityConfig> = {},
): LiquidityConfig {
  return { ...LIQUIDITY_DEFAULTS, ...overrides };
}

/**
 * Tier is a pure function of active supply and never consults the price sample:
 * "how crowded is this market" and "do we have prices" are different questions,
 * and the no-market-data branch already outranks the tier (research R7).
 */
export function liquidityTier(
  activeListingCount: number,
  config: LiquidityConfig = LIQUIDITY_DEFAULTS,
): LiquidityTier {
  if (activeListingCount <= 0) return 'UNPROVEN';
  if (activeListingCount <= config.strongMaxListings) return 'STRONG';
  if (activeListingCount <= config.moderateMaxListings) return 'MODERATE';
  return 'WEAK';
}

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

export const VERDICT_REASON_CODES = [
  'NO_MARKET_DATA',
  'BELOW_THRESHOLD',
  'WEAK_LIQUIDITY_THIN_MARGIN',
  'WEAK_LIQUIDITY_HIGH_VALUE',
  'PROFITABLE',
] as const satisfies readonly VerdictReasonCode[];

export interface ReasonContext {
  activeListingCount: number;
  tier: LiquidityTier;
}

/**
 * Copy is keyed by a total Record so the compiler proves every code has text.
 * Wording claims competing-supply knowledge only — never actual sales, which
 * we do not have until Marketplace Insights access lands (constitution I).
 */
const REASON_TEXT: Record<VerdictReasonCode, (ctx: ReasonContext) => string> = {
  NO_MARKET_DATA: () => 'No matching listings found, so there is no evidence of resale value.',
  BELOW_THRESHOLD: () => 'Projected profit lands under your threshold.',
  WEAK_LIQUIDITY_THIN_MARGIN: ({ activeListingCount }) =>
    `Only a little over your threshold, and ${activeListingCount} sellers are competing — not worth the wait.`,
  WEAK_LIQUIDITY_HIGH_VALUE: ({ activeListingCount }) =>
    `Worth enough to be worth listing, but ${activeListingCount} sellers are competing — expect a slow sale.`,
  PROFITABLE: ({ tier }) => {
    switch (tier) {
      case 'STRONG':
        return 'Clears your profit threshold with little competing supply.';
      case 'UNPROVEN':
        return 'Clears your profit threshold, but nobody else is listing this — no way to gauge the market yet.';
      default:
        return 'Clears your profit threshold; competing supply is manageable.';
    }
  },
};

export function verdictReasonText(code: VerdictReasonCode, ctx: ReasonContext): string {
  return REASON_TEXT[code](ctx);
}

/**
 * Fixed precedence ladder (research R2). Order matters twice over: no-market-data
 * must outrank any liquidity story, and the profit check must come before the
 * gate so the gate only ever sees already-profitable items — which is what makes
 * it structurally downgrade-only.
 */
function decideVerdict(args: {
  sampleSize: number;
  estimatedValueCents: number;
  profitCents: number;
  profitThresholdCents: number;
  tier: LiquidityTier;
  riskyMarginCents: number;
}): { verdict: Verdict['verdict']; reasonCode: VerdictReasonCode } {
  if (args.sampleSize === 0 || args.estimatedValueCents === 0) {
    return { verdict: 'RIP', reasonCode: 'NO_MARKET_DATA' };
  }
  if (args.profitCents < args.profitThresholdCents) {
    return { verdict: 'RIP', reasonCode: 'BELOW_THRESHOLD' };
  }
  if (args.tier === 'WEAK') {
    return args.profitCents >= args.riskyMarginCents
      ? { verdict: 'FLIP_RISKY', reasonCode: 'WEAK_LIQUIDITY_HIGH_VALUE' }
      : { verdict: 'RIP', reasonCode: 'WEAK_LIQUIDITY_THIN_MARGIN' };
  }
  return { verdict: 'FLIP', reasonCode: 'PROFITABLE' };
}

export function computeVerdict(input: ValuationInput): Verdict {
  const feeRate = input.feeRate ?? DEFAULT_FEE_RATE;
  const liquidity = resolveLiquidityConfig(input.liquidity);
  const estimatedValueCents = estimateValueCents(input.samplePricesCents);
  const feesCents = Math.round(estimatedValueCents * feeRate);
  const profitCents =
    estimatedValueCents - feesCents - input.shippingEstimateCents - input.costBasisCents;
  const sampleSize = input.samplePricesCents.length;
  const tier = liquidityTier(input.activeListingCount, liquidity);
  const riskyMarginCents = Math.round(
    input.profitThresholdCents * liquidity.riskyMarginMultiplier,
  );

  const { verdict, reasonCode } = decideVerdict({
    sampleSize,
    estimatedValueCents,
    profitCents,
    profitThresholdCents: input.profitThresholdCents,
    tier,
    riskyMarginCents,
  });

  return {
    verdict,
    estimatedValueCents,
    feesCents,
    shippingEstimateCents: input.shippingEstimateCents,
    profitCents,
    liquidityScore: supplySideLiquidity(input.activeListingCount, liquidity.strongMaxListings),
    liquidityTier: tier,
    liquidityBasis: 'SUPPLY_SIDE_ONLY',
    reasonCode,
    reason: verdictReasonText(reasonCode, {
      activeListingCount: input.activeListingCount,
      tier,
    }),
    sampleSize,
    pricingBasis: input.pricingBasis,
    noMarketData: sampleSize === 0,
  };
}
