# Data Model: eBay Fee Model (spec 009)

All money is integer cents. All rates are integer basis points (1 bp = 0.01%). No persistence: the
schedule and category map are source-controlled data modules; nothing is stored per user.

## Files (all new, under `src/lib/fees/`)

| File | Role |
|---|---|
| `types.ts` | Types below. No logic. |
| `schedule.ebay-us.ts` | The dated, sourced US schedule (data only) + provenance header with MIT notice. |
| `calculate.ts` | `calculateEbayFees` and `validateSchedule` — pure, no I/O, no clock. |
| `category-map.ts` | `EBAY_CATEGORY_TO_FEE_CATEGORY: Record<string, FeeCategoryKey>` — data only; may be empty. |
| `category.ts` | `resolveFeeCategory(ctx)` — pure; implements FR-006 ordering. |
| `index.ts` | `createFeeService(opts)` — wires schedule + map + legacy rate + clock; returns `forLookup(ctx)`. |

## Types (`types.ts`)

```ts
export type FeeCategoryKey = string; // e.g. 'most_categories' | 'books_magazines' | ... (keys from the schedule)

export interface Bracket {
  /** Inclusive upper bound of the order total, cents. null = no upper bound. */
  upToCents: number | null;
  rateBps: number; // integer, 0..10000
}

export interface FeeCategory {
  key: FeeCategoryKey;
  label: string;
  mode: 'MARGINAL' | 'WHOLE';
  brackets: Bracket[]; // ascending upToCents; last has upToCents null
  /** Order total at/above which this category applies at all; below it use belowMinimumKey. */
  minimumOrderTotalCents?: number;
  belowMinimumKey?: FeeCategoryKey;
  waivesPerOrderFee?: boolean;
  /** True for categories not expected to be reachable from a flip scan (bullion, NFT, heavy equipment). */
  notExpectedReachable?: boolean;
}

export interface PerOrderFeeRule {
  /** Inclusive threshold: order total <= this uses lowCents. */
  thresholdCents: number;
  lowCents: number;
  highCents: number;
}

export interface FeeSchedule {
  marketplace: 'ebay';
  region: 'US';
  /** eBay marketplace ids this schedule applies to, e.g. ['EBAY_US']. */
  marketplaceIds: string[];
  currency: 'USD';
  scope: string; // human-readable, returned verbatim as schedule.scope
  defaultCategoryKey: FeeCategoryKey;
  categories: FeeCategory[];
  perOrderFee: PerOrderFeeRule;
  provenance: {
    sources: Array<{ label: string; url: string; kind: 'MARKETPLACE_PAGE' | 'THIRD_PARTY_OPEN_DATA' }>;
    publisher: string;      // 'Underpriced (https://www.underpriced.app/)'
    license: string;        // 'MIT'
    tableVersion: string;   // '1.1.1'
    verifiedAt: string;     // ISO date 'YYYY-MM-DD' — publisher's check date until founder verifies
    reviewIntervalDays: number; // 45
    verification: {
      status: 'THIRD_PARTY_UNVERIFIED' | 'FOUNDER_VERIFIED';
      verifiedBy?: string;  // required when FOUNDER_VERIFIED
      verifiedOn?: string;  // required when FOUNDER_VERIFIED
    };
  };
}
```

## Calculation (`calculate.ts`)

```ts
export interface FeeInput {
  itemPriceCents: number;            // integer >= 0
  buyerShippingCents?: number;       // default 0
  salesTaxCents?: number;            // default 0
  categoryKey: FeeCategoryKey;
}
export interface FeeResult {
  finalValueFeeCents: number;
  perOrderFeeCents: number;
  totalCents: number;
  orderTotalCents: number;
  appliedCategoryKey: FeeCategoryKey; // differs from input only via belowMinimumKey
}
export function calculateEbayFees(schedule: FeeSchedule, input: FeeInput): FeeResult; // throws RangeError on non-integer / negative / > 9e11
export function validateSchedule(schedule: FeeSchedule): string[]; // [] when valid; messages otherwise
```

Algorithm (pinned):

1. Validate inputs; `orderTotal = itemPrice + buyerShipping + salesTax`. If `itemPriceCents === 0`
   return all zeros (FR-010).
2. Look up category; if `minimumOrderTotalCents` is set and `orderTotal < minimum`, switch to
   `belowMinimumKey` (once; chains are rejected by `validateSchedule`).
3. `MARGINAL`: for each bracket, `slice = min(orderTotal, upTo ?? ∞) − previousUpTo` (skip if ≤ 0),
   `fvf += share(slice, rateBps)`.
   `WHOLE`: pick the first bracket with `orderTotal <= upTo` (or the null bracket);
   `fvf = share(orderTotal, rateBps)`.
   `share(c, bps) = floor((c * bps + 5000) / 10000)`.
4. `perOrder = category.waivesPerOrderFee ? 0 : (orderTotal <= threshold ? low : high)`.
5. `total = fvf + perOrder`.

`validateSchedule` fails when: a category has no brackets or unsorted/duplicate bounds, last bracket
bound is not `null`, a `rateBps` is not an integer in 0..10000, `belowMinimumKey` is missing/unknown
or chains, `defaultCategoryKey` unknown, `verifiedAt` not an ISO date, `sources` empty, a source has
no URL, `reviewIntervalDays <= 0`, or `FOUNDER_VERIFIED` lacks `verifiedBy`/`verifiedOn` (FR-012/014).

## Resolution (`category.ts`)

```ts
export interface FeeCategoryContext {
  gtin?: string | null;            // normalized digits from identify (ISBN-10 already → 978...)
  leafCategoryId?: string | null;  // valuation.match.categoryId
}
export type CategoryResolution = 'ISBN_IDENTIFIER' | 'CATEGORY_MAP' | 'DEFAULT_ASSUMED';
export function resolveFeeCategory(
  ctx: FeeCategoryContext,
  schedule: FeeSchedule,
  map: Record<string, FeeCategoryKey>,
): { key: FeeCategoryKey; resolution: CategoryResolution };
```

Order: (1) `gtin` is 13 digits starting `978` or `979` → `books_magazines` (if the schedule has that
key) → `ISBN_IDENTIFIER`; (2) `leafCategoryId` present in `map` and its key exists in the schedule →
`CATEGORY_MAP`; (3) `defaultCategoryKey` → `DEFAULT_ASSUMED`.

## Service (`index.ts`) and the verdict seam

```ts
export interface FeeServiceOptions {
  schedules: FeeSchedule[];        // [ebayUsSchedule]
  categoryMap: Record<string, FeeCategoryKey>;
  marketplaceId: string;           // from config
  legacyFlatRate: number;          // EBAY_FEE_RATE: live rate until FOUNDER_VERIFIED, then no-schedule fallback
  now?: () => number;              // injectable clock, ms epoch
  /**
   * Test-only override. Production (`withFeeService`) never passes this.
   * Default: true iff the selected schedule's verification.status is FOUNDER_VERIFIED.
   */
  applySchedule?: boolean;
}
export interface FeeBreakdown {    // = response.feeBreakdown (see contracts/lookup-api.delta.yaml)
  finalValueFeeCents: number; perOrderFeeCents: number; totalCents: number; orderTotalCents: number;
  categoryKey: string; categoryLabel: string;
  categoryResolution: 'ISBN_IDENTIFIER' | 'CATEGORY_MAP' | 'DEFAULT_ASSUMED' | 'LEGACY_FLAT';
  assumptions: FeeAssumptionCode[];
  schedule: { marketplace: string; region: string; verifiedAt: string;
              verificationStatus: 'THIRD_PARTY_UNVERIFIED' | 'FOUNDER_VERIFIED';
              stale: boolean; scope: string };
  rateNote?: string;
}
export interface FeeService {
  /** Resolves the category once per lookup; returns a pure price→fee closure. */
  forLookup(ctx: FeeCategoryContext): {
    totalCents: (priceCents: number) => number;   // goes to computeVerdict (seam)
    breakdown: (priceCents: number) => FeeBreakdown; // goes into the response
  };
  startupWarnings(): string[]; // stale schedule, missing schedule, unverified → logged once by server
}
```

Two distinct legacy-amount paths (both `categoryKey: 'legacy_flat'`, `categoryResolution: 'LEGACY_FLAT'`,
`perOrderFeeCents: 0`, `totalCents = Math.round(price × legacyFlatRate)`):

1. **No schedule** for `marketplaceId` (D7): assumptions `[LEGACY_FLAT_RATE_NO_SCHEDULE]`;
   `schedule` = `{ marketplace: 'ebay', region: 'n/a', verifiedAt: 'n/a',
   verificationStatus: 'THIRD_PARTY_UNVERIFIED', stale: false, scope: 'Flat configured rate; no fee
   schedule for this marketplace' }`.
2. **US schedule present but not applied** (D11 / FR-017): assumptions
   `[SCHEDULE_NOT_FOUNDER_VERIFIED]`; `schedule` keeps the real US provenance (`marketplace: 'ebay'`,
   `region: 'US'`, the file's `verifiedAt`, `verificationStatus: 'THIRD_PARTY_UNVERIFIED'`,
   `stale` from the clock, the file's `scope`).

`verifiedAt` is a plain string in the contract (already reflected in contracts/lookup-api.delta.yaml).

`FeeAssumptionCode` = `'SELLER_PAYS_SHIPPING' | 'SALES_TAX_EXCLUDED' | 'STANDARD_SELLER_NO_STORE' |
'NO_PROMOTED_LISTING_FEES' | 'FEE_CATEGORY_ASSUMED' | 'LEGACY_FLAT_RATE_NO_SCHEDULE' | 'SCHEDULE_STALE' |
'SCHEDULE_NOT_FOUNDER_VERIFIED'` (the contract's enum, in that order).

## Verdict seam (`src/lib/verdict.ts`, minimal diff)

`ValuationInput` gains `computeFees?: (priceCents: number) => number`. In `computeVerdict`:
`feesCents = input.computeFees ? input.computeFees(estimatedValueCents) : Math.round(estimatedValueCents * feeRate)`.
`feeRate` and `DEFAULT_FEE_RATE` stay. `Verdict` is unchanged.

## Pipeline (`src/lib/pipeline.ts`)

`PipelineDeps.config.fees?: FeeService` (optional so existing test deps compile). When present,
`lookup()` calls `fees.forLookup({ gtin: query.gtin, leafCategoryId: valuation.match.categoryId })`,
passes `totalCents` as `computeFees`, then `VerdictResult.feeBreakdown = breakdown(verdict.estimatedValueCents)`
and asserts `breakdown.totalCents === verdict.feesCents`. When absent: `feeBreakdown` is omitted
(the `makeApp` / `makeDeps` path; existing tests). Production (`buildProductionDeps` →
`withFeeService`) always supplies a FeeService; with the shipped unverified schedule it still
charges the legacy amount (D11).

## Server wiring (`src/server.ts`)

```ts
export function withFeeService(config: AppConfig): AppConfig {
  return {
    ...config,
    fees: createFeeService({
      schedules: [ebayUsSchedule],
      categoryMap: EBAY_CATEGORY_TO_FEE_CATEGORY,
      marketplaceId: config.marketplaceId,
      legacyFlatRate: config.feeRate,
      // applySchedule omitted on purpose (D11)
    }),
  };
}
```

`buildProductionDeps` passes `config: withFeeService(config)` into deps. It MUST NOT mutate the
input. Tests that want production behaviour call `makeApp({ config: withFeeService(testConfig) })`.
Startup: `console.warn` each `fees.startupWarnings()` entry once.

## State transitions

None. No persistence, no per-user state. The service is constructed once at startup; the schedule's
`stale` flag is recomputed per response from the clock.
