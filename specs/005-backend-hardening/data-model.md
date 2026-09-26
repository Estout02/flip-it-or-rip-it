# Data Model: Backend Hardening (005)

All entities are in memory. These are deltas against spec 004.

## ItemQuery (identify step output)

| Field | Change | Notes |
|---|---|---|
| `cacheKey` | unchanged | `gtin:<digits>` or `title:<normalized>` |
| `fallbackCacheKey` | **new**, optional | `gtin:<digits>\|title:<normalized>`; present only when both a valid barcode and a non-empty title were given |

## Valuation (valuation step output; cached)

| Field | Change | Notes |
|---|---|---|
| `activeListingCount` | unchanged meaning | Raw marketplace `total` for the search that produced the listings |
| `competingSupplyCount` | **new** | GTIN: equals `activeListingCount`. Title: `max(matchedCount, round(activeListingCount × match.dominanceShare))`. Integer ≥ 0 |

**Empty barcode valuation** (`emptyBarcodeValuation()`): `samplePricesCents: []`, `sampleSize: 0`,
`activeListingCount: 0`, `competingSupplyCount: 0`, `sourcedFrom: 'gtin'`, `matchedTitle: null`,
match `{categoryId: null, categoryName: null, dominanceShare: 1, dispersionRatio: 1,
confidence: 'HIGH', filtered: false}`. The barcode-path match shape is unchanged from 004.

**Is-empty predicate**: `sourcedFrom === 'gtin' && sampleSize === 0`.

### Cache key states for barcode B

| `gtin:B` entry | Title given? | `gtin:B\|title:t` entry | Action | Marketplace calls |
|---|---|---|---|---|
| non-empty | any | — | serve `gtin:B` | 0 |
| empty | no | — | serve `gtin:B` | 0 |
| empty | yes | present | serve fallback | 0 |
| empty | yes | absent | title-only valuation → store fallback | 1 |
| absent | no | — | barcode valuation → store `gtin:B` | 1 |
| absent | yes | present | serve fallback. Barcode is known empty only via a prior fallback, which also wrote `gtin:B`; this row exists only after `gtin:B` expires first, and serving is still correct | 0 |
| absent | yes | absent | full valuation. Barcode hit → store `gtin:B`. Fallback → store empty `gtin:B` **and** the fallback | 1–2 |

## VerdictResult (API response)

| Field | Change |
|---|---|
| `rawActiveListingCount` | **new**, integer. Valuation's `activeListingCount` |
| `competingSupplyCount` | **new**, integer. The figure the liquidity tier, score and reason used |

All other fields are unchanged.

## AppConfig (server settings)

| Setting | Env | Default | Valid |
|---|---|---|---|
| `trustProxy` | `TRUST_PROXY` | `false` | unset/empty/`false`; integer ≥ 1 (hops); comma list of IPv4/IPv6 addresses or CIDRs. Anything else, including `true`, warns and falls back to `false` |
| `lookupDailyCap` | `LOOKUP_DAILY_CAP` | 50 | integer ≥ 1 |
| `ebayDailyCallBudget` | `EBAY_DAILY_CALL_BUDGET` | 2500 | integer ≥ 1 |
| `feeRate` | `EBAY_FEE_RATE` | 0.1325 | finite, 0 ≤ x < 1 |
| `shippingFlatCents` | `SHIPPING_FLAT_CENTS` | 500 | integer ≥ 0 |
| `cacheTtlMs` | `VALUATION_CACHE_TTL_HOURS` | 24 h | finite > 0 (hours) |
| `defaultProfitThresholdCents` | `PROFIT_THRESHOLD_DEFAULT` | $10 → 1000 | finite ≥ 0 dollars |
| `port` | `PORT` | 3000 | integer 1–65535 |

An invalid value logs `Invalid <ENV_NAME> "<raw>" — falling back to <default>.` via `console.warn`,
matching the existing liquidity/match warnings.

## RateLimiter

| State | Change |
|---|---|
| `currentDay` | **new**. UTC day start of the last lookup seen. On change, `perClient.clear()` |
| `trackedClientCount` | **new** getter (observability/tests) |

## Lookup request body

Allowed fields: `identifier`, `title`, `costBasisCents`, `profitThresholdCents`. Anything else →
400 `{ error: "validation", message: "Unknown field \"<name>\". Allowed: identifier, title,
costBasisCents, profitThresholdCents." }`
