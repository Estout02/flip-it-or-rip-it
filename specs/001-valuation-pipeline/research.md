# Phase 0 Research: Core Valuation Pipeline

All Technical Context unknowns resolved. Each decision below follows the
Decision / Rationale / Alternatives format. Compliance frame: `docs/EBAY_API_NOTES.md`
and constitution Principle I govern everything eBay-related.

## R1. eBay authentication: OAuth2 client-credentials (app token)

**Decision**: Mint application access tokens via the OAuth2 client-credentials grant against
`https://api.sandbox.ebay.com/identity/v1/oauth2/token` (production:
`api.ebay.com`), scope `https://api.ebay.com/oauth/api_scope`, using
`EBAY_CLIENT_ID`/`EBAY_CLIENT_SECRET` as HTTP Basic auth. Cache the token in memory and
refresh proactively when < 5 minutes of its ~2-hour lifetime remain, so user requests
(almost) never pay token-mint latency.

**Rationale**: MVP is lookups-only with app-level keys (founder decision #4 — user OAuth is
Phase 2). Client-credentials is the only grant that fits, and it's what the Browse API
accepts for general search. Proactive refresh keeps the hot path clean (Principle II).

**Alternatives considered**: Authorization-code grant (needed only for user-consent APIs —
Phase 2); minting a token per request (adds ~300ms+ latency per lookup and needless load —
rejected); `ebay-api` npm packages (unofficial, extra supply-chain surface for ~50 lines of
fetch code — rejected).

## R2. Identifier → product & pricing: Browse API `item_summary/search`

**Decision**: One endpoint serves both lookup paths:
`GET https://api.sandbox.ebay.com/buy/browse/v1/item_summary/search` with
- barcode path: `gtin=<digits>` (Browse accepts UPC/EAN/ISBN as GTIN),
- title path: `q=<title>`,
- common params: `filter=buyingOptions:{FIXED_PRICE}`, `sort=price`, `limit=50`,
- headers: `Authorization: Bearer <app token>`, `X-EBAY-C-MARKETPLACE-ID: EBAY_US`.

The response's `itemSummaries` (title, price, itemId, epid when present) plus `total`
(active-listing volume) supply everything steps 1–2 need in a **single call**: the top
result's title/epid is the matched Product Identity; prices feed valuation; `total` feeds the
supply-side liquidity signal. If a `gtin` search returns zero results and a title was also
provided, fall back to one `q=` search (FR-003) — worst case 2 calls, only when the barcode
path came up empty.

**Rationale**: One GA endpoint, one call for the common case — cheapest and fastest compliant
option (Principles II, III). `sort=price` ascending means the first 10 usable items are
exactly the "10 lowest-priced" the spec requires. `limit=50` costs nothing extra (same call)
and gives headroom to skip zero-price/auction anomalies while still reporting `total` supply.

**Alternatives considered**: Catalog API product lookup then search-by-EPID (2 calls always,
and Catalog API has its own access quirks — rejected for MVP); Marketplace Insights API
(ideal sold data but approval-gated, not yet granted — the whole Phase 1 fallback exists
because of this); Finding API (decommissioned Feb 2025 — dead); scraping (forbidden,
constitution Principle I).

## R3. Identifier validation & classification

**Decision**: `identify.ts` strips hyphens/spaces, then classifies: 8 digits → EAN-8;
10 chars ending in digit or `X` → ISBN-10 (converted to ISBN-13/GTIN by prefixing 978 and
recomputing the check digit); 12 digits → UPC-A; 13 digits → EAN/ISBN-13; 14 digits →
GTIN-14. Anything else → 400 validation error before any external call (FR-002). Titles are
normalized (trim, collapse whitespace, lowercase) for cache keys; original casing is sent to
eBay.

**Rationale**: Browse's `gtin` param expects these formats; ISBN-10 conversion is
deterministic math and rescues older books (a core media use case). Rejecting malformed
identifiers locally protects quota (Principle III) and gives instant feedback.

**Alternatives considered**: Passing raw input through to eBay and letting it fail (burns a
quota call per typo — rejected); full check-digit *verification* (a mistyped digit would
still be a valid-looking code; check-digit validation adds little and risks false rejections
on niche codes — compute-only for the ISBN conversion, don't police scanners that already
verify).

## R4. Valuation math over asking prices

**Decision**: From the sorted (price-ascending) fixed-price listings, take the first 10 with
a positive price, feed their cents values to the existing `estimateValueCents` median. Sample
size = count actually used (≤10). `pricingBasis: "ASKING_PRICE"` flag on every valuation
until Marketplace Insights is granted (FR-005). Zero usable listings → value 0, sample 0 →
existing verdict math already returns RIP; response adds `noMarketData: true` (FR-008).

**Rationale**: Reuses the settled, tested median implementation (spec assumption: verdict
math is settled). Median of the lowest 10 tracks the competitive floor a seller must match
while shrugging off one or two junk listings (clarification Q4).

**Alternatives considered**: Mean (outlier-sensitive — rejected); trimmed mean over all 50
(drifts above the actionable floor — rejected); Buy-It-Now lowest price only (one mispriced
listing tanks the valuation — rejected).

## R5. Liquidity signal without sold data

**Decision**: Supply-side-only heuristic: `liquidityScore = min(1, 10 / activeListingCount)`
(0 when no listings), emitted with `liquidityBasis: "SUPPLY_SIDE_ONLY"` so clients render it
honestly (FR-010). `activeListingCount` comes from the search response's `total`. Constant 10
is configurable; the whole function is replaced by the real sold/(sold+active) formula when
sold data arrives.

**Rationale**: Monotonic, cheap, and directionally right: 10 or fewer competing listings →
strong signal (1.0); 100 listings → 0.1; 500 → 0.02 — exactly the "$150 book with hundreds
of active listings" trap the brief calls out. Being explicit about the degraded basis is a
spec requirement, not an implementation nicety.

**Alternatives considered**: Reusing `liquidityScore(sold, active)` with sample size as a
fake "sold" count (conflates our sampling choice with market velocity — misleading,
rejected); omitting liquidity entirely until sold data (drops a core value prop from the
response shape and forces a breaking change later — rejected).

## R6. Caching: in-memory TTL map

**Decision**: A small generic TTL cache module (`Map` + expiry timestamps, lazy eviction +
periodic sweep), default TTL 24h (`VALUATION_CACHE_TTL_HOURS`). Key: `gtin:<normalized
identifier>` or `title:<normalized title>`. The cached unit is the **Valuation** (prices,
sample, activeListingCount, matched product, timestamp) — not the final verdict — so
per-request cost basis and threshold still produce personalized verdicts from a shared
cached valuation (FR-011).

**Rationale**: Stateless-MVP constitution constraint plus single-instance deployment make
in-memory the simplest thing that satisfies FR-011/SC-002. Caching the valuation rather than
the verdict maximizes hit rate across users with different thresholds. No Redis/Postgres
dependency on the hot path (Principles II, III).

**Alternatives considered**: Postgres-backed cache (constitution says Postgres stays unused
until saved inventory; adds hot-path I/O — rejected for MVP); Redis (new infra for an MVP
with one instance — rejected); caching the full verdict (cache misses for every distinct
cost basis — rejected).

## R7. Rate limiting & quota budget

**Decision**: Two in-memory counters in `rate-limit.ts`, both resetting at UTC midnight:
1. **Per-client**: 50 lookups/day (`LOOKUP_DAILY_CAP`) keyed by client IP
   (`request.ip`; compose/prod proxy sets `trustProxy` so the real IP is seen). Over cap →
   HTTP 429 `{ error: "limit-reached" }` (FR-012). Cache hits still count as lookups
   (they're the product's unit of value) but cost zero eBay calls.
2. **Global eBay budget**: hard stop at `EBAY_DAILY_CALL_BUDGET` (default 2,500 = 50% of the
   5,000 app quota, SC-004). Budget exhausted + cache miss → HTTP 503 temporary-failure
   (distinct from a RIP verdict, FR-015).

On an eBay 429/5xx response: no immediate retry; the eBay client enters a 30s cooldown
(circuit-breaker style) during which cache misses get the 503 temporary-failure. Remaining
quota can additionally be observed via the Developer Analytics `getRateLimits` endpoint —
deferred to a post-MVP observability task (noted in spec as plan-level).

**Rationale**: O(1) hot-path checks, fails closed before eBay ever sees abusive volume
(Principles II, III). IP keying is the only client identity that exists pre-accounts (spec
assumption). UTC-midnight reset matches eBay's own daily quota window.

**Alternatives considered**: `@fastify/rate-limit` plugin (fine library, but brings a
dependency for two counters and doesn't model the global eBay budget — rejected);
token-bucket smoothing (over-engineering for MVP — rejected); counting only cache-miss
lookups against the per-client cap (invites scripted scraping of our cached data — rejected).

## R8. HTTP client & resilience

**Decision**: Native `fetch` (Node 24) with `AbortSignal.timeout(2000)` per eBay call, one
retry **only** for network-level failures (not 4xx/5xx), JSON parsed defensively. eBay
errors map to: 429/5xx → cooldown + 503 temporary-failure; 400 → treated as zero results
(malformed query already prevented locally); token 401 → single token refresh + one retry.

**Rationale**: Keeps the uncached path comfortably under the 3s SC-001 target even at
timeout, with zero added dependencies. Distinguishing "no market" (valid RIP) from "eBay
down" (503) is FR-015.

**Alternatives considered**: axios/got/undici-request wrappers (no capability we need —
rejected); aggressive multi-retry (violates back-off rule and latency budget — rejected).

## R9. Fee model

**Decision**: Keep the existing flat final-value fee rate (13.25% default) in `verdict.ts`,
now sourced from `EBAY_FEE_RATE` config. Per-category fee schedules and the ~$0.30/order
fixed fee are explicitly deferred (spec assumption).

**Rationale**: Spec-settled; the flat rate is within a point of the real media-category rate,
and verdicts near the threshold are dominated by shipping and price variance anyway.

**Alternatives considered**: Category-based fee table (needs category detection we don't do
yet — deferred); adding the fixed $0.30 (real but sub-noise for MVP; revisit with real
usage — deferred).

## R10. Testing strategy

**Decision**: `EbayBrowseClient` is an interface (`ebay/types.ts`); production impl in
`ebay/browse.ts`, tests inject a fake returning fixture listings. Unit tests per module
(identify, valuation, shipping, cache, rate-limit, verdict extensions); integration tests
drive `POST /api/lookup` via `fastify.inject()` with the fake client (all acceptance
scenarios + edge cases from the spec, including cap-exhaustion, cooldown 503, cache-hit
zero-call assertions). Real-sandbox verification lives in `scripts/sandbox-smoke.ts`, run
manually inside the container when credentials exist — CI/tests never require live
credentials.

**Rationale**: Sandbox data is sparse and fake (spec assumption), so correctness is proven
against fixtures; the smoke script proves wiring/auth against the real sandbox. Everything
runs via `docker compose run --rm api npm test` (Principle V).

**Alternatives considered**: Recording live sandbox responses into tests via nock/VCR
(brittle, credential-coupled CI — rejected); testing only through HTTP (misses precise
step-boundary contracts Principle VII demands — rejected, both layers tested).

## New configuration (additions to `.env.example`)

| Variable | Default | Purpose |
|----------|---------|---------|
| `EBAY_MARKETPLACE_ID` | `EBAY_US` | Marketplace header (spec: US/USD only) |
| `EBAY_FEE_RATE` | `0.1325` | Flat final-value fee rate (R9) |
| `SHIPPING_FLAT_CENTS` | `500` | Flat shipping estimate (clarification Q3) |
| `VALUATION_CACHE_TTL_HOURS` | `24` | Valuation cache TTL (FR-011) |
| `LOOKUP_DAILY_CAP` | `50` | Per-client daily lookups (FR-012) |
| `EBAY_DAILY_CALL_BUDGET` | `2500` | Global daily eBay-call stop (SC-004) |

Existing: `EBAY_CLIENT_ID`, `EBAY_CLIENT_SECRET`, `EBAY_ENV=sandbox`,
`PROFIT_THRESHOLD_DEFAULT=10` (dollars in env for founder convenience; converted to cents
once at startup — env files are config edge, not API payload).
