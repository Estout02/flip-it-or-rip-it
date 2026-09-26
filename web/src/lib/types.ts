// Client-side mirror of specs/005-backend-hardening/contracts/lookup-api.yaml (0.6.0)
// and specs/006-web-client/contracts/meta-api.yaml. Money is integer cents throughout
// (constitution VI); dollars exist only at the display edge (lib/money.ts).

export type Verdict = 'FLIP' | 'FLIP_RISKY' | 'RIP' | 'UNCERTAIN';
export type LiquidityTier = 'STRONG' | 'MODERATE' | 'WEAK' | 'UNPROVEN';
export type MatchConfidence = 'HIGH' | 'MEDIUM' | 'LOW';
export type ReasonCode =
  | 'NO_MARKET_DATA'
  | 'LOW_MATCH_CONFIDENCE'
  | 'BELOW_THRESHOLD'
  | 'WEAK_LIQUIDITY_THIN_MARGIN'
  | 'WEAK_LIQUIDITY_HIGH_VALUE'
  | 'PROFITABLE';

export type VerdictResult = {
  verdict: Verdict;
  /** Expected SALE value — the figure to display. */
  estimatedValueCents: number;
  /** Uncorrected asking median. NEVER displayed (FR-006). */
  rawAskingMedianCents: number;
  /** Dimensionless ratio, not money. NEVER displayed. */
  realizationRate: number;
  feesCents: number;
  shippingEstimateCents: number;
  profitCents: number;
  liquidityScore: number;
  liquidityTier: LiquidityTier;
  liquidityBasis: 'SUPPLY_SIDE_ONLY';
  reasonCode: ReasonCode;
  reason: string;
  matchConfidence: MatchConfidence;
  matchedCategoryName: string | null;
  matchDominance: number;
  matchFiltered: boolean;
  sampleSize: number;
  pricingBasis: 'ADJUSTED_ASKING_PRICE';
  noMarketData: boolean;
  matchedTitle: string | null;
  rawActiveListingCount: number;
  competingSupplyCount: number;
  cached: boolean;
  query: { identifier: string | null; title: string | null };
};

export type LookupInput = {
  identifier?: string;
  title?: string;
  costBasisCents?: number;
  profitThresholdCents?: number;
};

export type Meta = {
  defaultProfitThresholdCents: number;
  lookupDailyCap: number;
  marketplaceId: string;
};

export type LookupError =
  | { kind: 'validation'; message: string }
  | { kind: 'limit' }
  | { kind: 'unavailable' }
  | { kind: 'offline' }
  | { kind: 'unexpected' };

export type HistoryEntry = {
  id: string;
  /** ISO timestamp. */
  checkedAt: string;
  query: { identifier: string | null; title: string | null };
  /** 0 when not entered. */
  costBasisCents: number;
  result: VerdictResult;
};

export type LookupState =
  | { status: 'idle' }
  | { status: 'loading'; input: LookupInput }
  | { status: 'success'; entry: HistoryEntry; fromHistory: boolean }
  | { status: 'error'; error: LookupError; input: LookupInput };

export type Settings = { profitThresholdCents: number | null };
