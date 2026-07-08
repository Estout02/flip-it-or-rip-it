# Data Model: Core Valuation Pipeline

No persistent storage in this feature (stateless MVP). These are the in-memory / wire types
flowing between the four pipeline steps. All money fields are integer **cents**
(constitution VI). Types live next to the module that owns them; `pipeline.ts` composes them.

## Pipeline data flow

```text
LookupRequest ──identify──▶ ItemQuery ──valuation──▶ Valuation ──┐
                                          (cacheable)            ├─shipping─▶ ShippingEstimate ─┐
                                                                 │                              ├─verdict─▶ VerdictResult
LookupRequest.costBasisCents / profitThresholdCents ─────────────┴──────────────────────────────┘
```

## Entities

### LookupRequest (API input, owned by `server.ts`)

| Field | Type | Rules |
|-------|------|-------|
| `identifier` | `string?` | UPC/ISBN/EAN; at least one of `identifier`/`title` required (FR-001/002) |
| `title` | `string?` | Free-text, 1–200 chars after trim |
| `costBasisCents` | `int` | Default `0`; must be ≥ 0 (FR-002) |
| `profitThresholdCents` | `int?` | Default from config (`PROFIT_THRESHOLD_DEFAULT`, $10 → 1000); must be ≥ 0 |

### ItemQuery (Step 1 output, owned by `identify.ts`)

| Field | Type | Rules |
|-------|------|-------|
| `kind` | `'gtin' \| 'title'` | `gtin` when a valid identifier was supplied (identifier precedence, US2-AS3) |
| `gtin` | `string?` | Normalized digits; ISBN-10 already converted to ISBN-13 (research R3) |
| `titleQuery` | `string?` | Original-casing title for the eBay query; present when kind=`title` or as gtin fallback |
| `cacheKey` | `string` | `gtin:<digits>` or `title:<normalized title>` (FR-011) |

Validation errors (malformed identifier, missing both inputs, negative money) are thrown
here or in `server.ts` schema validation — before any external call (FR-002, SC-006).

### ListingSummary (eBay wire type, owned by `ebay/types.ts`)

| Field | Type | Notes |
|-------|------|-------|
| `title` | `string` | Listing title |
| `priceCents` | `int` | Converted from eBay's `price.value` (USD string) at the client boundary |
| `epid` | `string?` | eBay product id when the listing is catalog-matched |

`EbayBrowseClient.search(query) → { listings: ListingSummary[], totalActive: int }` — the
injectable interface (research R10). `totalActive` is the response `total`.

### Valuation (Step 2 output, owned by `valuation.ts` — **the cached unit**)

| Field | Type | Rules |
|-------|------|-------|
| `estimatedValueCents` | `int` | Median of ≤10 lowest positive asking prices (FR-005) |
| `samplePricesCents` | `int[]` | The prices actually used (audit/debug; ≤10) |
| `sampleSize` | `int` | `samplePricesCents.length` |
| `activeListingCount` | `int` | eBay `total` for the query |
| `pricingBasis` | `'ASKING_PRICE'` | Only value until Marketplace Insights (FR-005) |
| `matchedTitle` | `string \| null` | Top listing's title (edge case: ambiguous match visibility) |
| `computedAt` | `ISO timestamp` | Drives 24h TTL (FR-011) |

State: a Valuation with `sampleSize = 0` is a legitimate "no market data" result — it is
still cached (a barcode with no listings stays no-market for the TTL, saving quota).

### ShippingEstimate (Step 3 output, owned by `shipping.ts`)

| Field | Type | Rules |
|-------|------|-------|
| `shippingEstimateCents` | `int` | Flat `SHIPPING_FLAT_CENTS` (500) for MVP (FR-006) |
| `method` | `'FLAT_DEFAULT'` | Discriminator so weight/category methods can be added without shape change |

### VerdictResult (Step 4 output / API response, owned by `verdict.ts` + `pipeline.ts`)

Extends the existing `Verdict` interface:

| Field | Type | Source |
|-------|------|--------|
| `verdict` | `'FLIP' \| 'RIP'` | Existing math: FLIP iff value > 0 ∧ profit ≥ threshold (FR-008) |
| `estimatedValueCents` | `int` | Valuation |
| `feesCents` | `int` | `round(value × EBAY_FEE_RATE)` (FR-007) |
| `shippingEstimateCents` | `int` | ShippingEstimate |
| `profitCents` | `int` | value − fees − shipping − costBasis (FR-007); may be negative |
| `liquidityScore` | `number 0–1` | Supply-side heuristic `min(1, 10/active)` (FR-010, research R5) |
| `liquidityBasis` | `'SUPPLY_SIDE_ONLY'` | NEW — degraded-signal marker (FR-010) |
| `sampleSize` | `int` | Valuation |
| `pricingBasis` | `'ASKING_PRICE'` | NEW — asking-price flag (FR-005/009) |
| `noMarketData` | `boolean` | NEW — true iff sampleSize = 0 (FR-008) |
| `matchedTitle` | `string \| null` | NEW — matched product visibility (FR-009) |
| `cached` | `boolean` | NEW — response served from cached valuation (SC-002 verifiability) |

### CacheEntry<Valuation> (owned by `cache.ts`)

| Field | Type | Rules |
|-------|------|-------|
| `value` | `Valuation` | The cached valuation (never the verdict — research R6) |
| `expiresAt` | `epoch ms` | `computedAt + VALUATION_CACHE_TTL_HOURS` |

Lifecycle: lazy eviction on read + periodic sweep; process restart clears (acceptable, MVP).

### RateLimitState (owned by `rate-limit.ts`)

| Field | Type | Rules |
|-------|------|-------|
| `perClient` | `Map<ip, { count, windowStart }>` | Cap 50/day (FR-012); resets UTC midnight |
| `ebayCallsToday` | `{ count, windowStart }` | Hard stop at `EBAY_DAILY_CALL_BUDGET` (SC-004) |
| `cooldownUntil` | `epoch ms \| null` | Set +30s on eBay 429/5xx (research R7/R8) |

## Error taxonomy (wire-visible)

| HTTP | `error` code | Trigger | Spec ref |
|------|--------------|---------|----------|
| 400 | `validation` | No identifier/title; malformed identifier; negative money | FR-002 |
| 429 | `limit-reached` | Per-client daily cap exceeded | FR-012 |
| 503 | `temporarily-unavailable` | eBay cooldown, budget exhausted, or eBay unreachable — and no cached valuation | FR-015 |
| 200 | — | Everything else, including `noMarketData` RIP (a verdict, not an error) | FR-008 |
