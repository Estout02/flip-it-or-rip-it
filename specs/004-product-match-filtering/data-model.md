# Data Model: Product Match Filtering

No persistent storage (stateless MVP). These are the in-memory / wire types touched by this
feature. Money stays integer **cents** (constitution VI); dominance and dispersion are
dimensionless ratios.

## Where this feature sits in the flow

```text
LookupRequest ──identify──▶ ItemQuery ──valuation──▶ Valuation ──┐  (grouping happens HERE)
                                        (cached, now              │
                                         carries the match)       ├─shipping─▶ ShippingEstimate ─┐
LookupRequest.costBasisCents / profitThresholdCents ──────────────┤                              │
                          config.match thresholds (NEW) ──────────┤                              │
                                                                                                 ▼
                                                                                     verdict  ──▶ VerdictResult
                                                                                   (consumes       (EXTENDED)
                                                                                    confidence)
```

The decision about *which listings represent the item* is made once, in the valuation step
(constitution VII). The verdict step only reads the resulting confidence.

## New

### MatchConfidence (owned by `valuation.ts`)

```ts
type MatchConfidence = 'HIGH' | 'MEDIUM' | 'LOW';
```

Derived from two independent measures (research R5); the **worse** of the two wins, since either
condition alone is enough to make an estimate untrustworthy:

| Measure | Definition | Meaning when poor |
|---|---|---|
| `dominanceShare` | matched group size ÷ returned listings | The query pulled in several unrelated product types |
| `dispersionRatio` | p75 ÷ p25 of prices **within** the matched group | One category, several distinct products (variants, lots, unrelated titles) |

### ProductMatch (owned by `valuation.ts`)

| Field | Type | Notes |
|---|---|---|
| `categoryId` | `string \| null` | Leaf category the match was decided on; `null` for bypassed GTIN lookups and empty results |
| `categoryName` | `string \| null` | Human-readable, straight from the wire |
| `dominanceShare` | `number` 0-1 | Share of returned listings in the matched group |
| `dispersionRatio` | `number` | p75/p25 within the group; `1` when fewer than 4 listings |
| `confidence` | `MatchConfidence` | Worse of the two measures |
| `filtered` | `boolean` | False when bypassed (GTIN search) — see research R7. Surfaces on the wire as `matchFiltered`; wire fields carry the `match` prefix, internal ones do not |

### MatchConfig (config, `server.ts` → `valuation.ts`)

| Field | Default | Env var | Rules |
|---|---|---|---|
| `minDominanceHigh` | `0.6` | `MATCH_MIN_DOMINANCE_HIGH` | 0 < v ≤ 1 |
| `minDominanceMedium` | `0.35` | `MATCH_MIN_DOMINANCE_MEDIUM` | 0 < v ≤ `minDominanceHigh` |
| `maxDispersionHigh` | `2.5` | `MATCH_MAX_DISPERSION_HIGH` | ≥ 1 |
| `maxDispersionMedium` | `6` | `MATCH_MAX_DISPERSION_MEDIUM` | ≥ `maxDispersionHigh` |

Invalid or incoherent values fall back to defaults with a logged warning, following the
`LIQUIDITY_*` precedent. **All four defaults are judgment calls**, chosen so the live reference case
(`dispersionRatio` far above 6) lands on `LOW`.

## Modified

### `ListingSummary` (wire type, `ebay/types.ts`)

| Field | Change | Notes |
|---|---|---|
| `leafCategoryId` | **NEW** `string \| undefined` | From `leafCategoryIds[0]` |
| `leafCategoryName` | **NEW** `string \| undefined` | From `categories[0].categoryName` |
| `title`, `priceCents`, `epid` | unchanged | |

`browse.ts` transports these; it does not interpret them (research R8).

### Browse query (`ebay/browse.ts`)

| Param | Change | Why |
|---|---|---|
| `sort=price` | **REMOVED for title (`q=`) searches; RETAINED for GTIN searches** | Causes both the poisoned sample and a poisoned dominance vote for title queries (research R2). GTIN queries bypass filtering and still want cheapest-first, and changing their result set would break FR-005/SC-003 |
| `filter`, `limit`, `gtin`/`q` | unchanged | |

### `Valuation` (step 2 output, `valuation.ts` — the cached unit)

| Field | Change | Notes |
|---|---|---|
| `samplePricesCents` | **SEMANTICS CHANGED** | Now the prices of the **matched** listings (≤50), not the ten cheapest overall |
| `match` | **NEW** `ProductMatch` | Always present |
| `sampleSize`, `activeListingCount`, `pricingBasis`, `matchedTitle`, `computedAt` | unchanged | `matchedTitle` is now the **first listing of the matched group in relevance order** — the order eBay returns once the price sort is dropped |

### `Verdict` (`verdict.ts`)

| Field | Change | Notes |
|---|---|---|
| `verdict` | **EXPANDED** | `'FLIP' \| 'FLIP_RISKY' \| 'RIP' \| 'UNCERTAIN'` |
| `matchConfidence` | **NEW** | Mirrors `ProductMatch.confidence` onto the response |
| `reasonCode` | **EXPANDED** | Gains `LOW_MATCH_CONFIDENCE` |

### Verdict precedence (revised)

`UNCERTAIN` is evaluated **before** the liquidity gate — reasoning about liquidity on inputs we do
not trust would dress up a guess (research R6):

```text
sampleSize === 0                    → RIP        / NO_MARKET_DATA
matchConfidence === 'LOW'           → UNCERTAIN  / LOW_MATCH_CONFIDENCE
profit < threshold                  → RIP        / BELOW_THRESHOLD
tier WEAK && profit < riskyMargin   → RIP        / WEAK_LIQUIDITY_THIN_MARGIN
tier WEAK && profit >= riskyMargin  → FLIP_RISKY / WEAK_LIQUIDITY_HIGH_VALUE
otherwise                           → FLIP       / PROFITABLE
```

## Validation rules

- A **GTIN-sourced** valuation sets `filtered: false`, `confidence: 'HIGH'`, and leaves the sample
  untouched — barcode results are already product-constrained (Resolved Decision 1). The flag keys
  on the search that actually ran, so a GTIN query that fell back to a title search **is** filtered
  (research R7).
- `dispersionRatio` is defined as `1` when the matched group has fewer than 4 listings — quartiles
  are meaningless below that, and a tiny group should not be condemned for having no spread. Small
  groups are instead caught by `dominanceShare`.
- An empty result set keeps today's no-market-data behaviour: no match, no confidence gating, the
  existing `NO_MARKET_DATA` RIP (FR-006 of spec 003 and the edge case here).
