# Tasks: Core Valuation Pipeline

**Input**: Design documents from `/specs/001-valuation-pipeline/`

**Prerequisites**: plan.md, spec.md, research.md, data-model.md, contracts/lookup-api.yaml, quickstart.md

**Tests**: INCLUDED — the plan's testing strategy (research R10) mandates fake-client unit +
integration coverage; write each story's tests first and watch them fail. All test/typecheck
runs happen inside Docker: `docker compose run --rm api npm test` (constitution V).

**Organization**: Tasks are grouped by user story so each story is an independently
testable increment. Tests are colocated `*.test.ts` next to source (existing convention).

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies)
- **[Story]**: Which user story this task belongs to (US1, US2, US3)

## Phase 1: Setup

**Purpose**: Configuration surface for everything the pipeline needs

- [ ] T001 Add new config vars to `.env.example` with comments and defaults per research.md: `EBAY_MARKETPLACE_ID=EBAY_US`, `EBAY_FEE_RATE=0.1325`, `SHIPPING_FLAT_CENTS=500`, `VALUATION_CACHE_TTL_HOURS=24`, `LOOKUP_DAILY_CAP=50`, `EBAY_DAILY_CALL_BUDGET=2500`

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Shared infrastructure every story flows through — eBay client, cache, rate
limiter, extended verdict math, shipping step, injectable app factory

**⚠️ CRITICAL**: No user story work can begin until this phase is complete

- [ ] T002 [P] Create `src/lib/ebay/types.ts`: `ListingSummary` (`title`, `priceCents`, `epid?`), `SearchResult` (`listings`, `totalActive`), and the injectable `EbayBrowseClient` interface (`search(query: { gtin?: string; title?: string }): Promise<SearchResult>`) per data-model.md
- [ ] T003 [P] Implement generic TTL cache in `src/lib/cache.ts` (Map + expiry, lazy eviction + periodic sweep, TTL injected) with tests in `src/lib/cache.test.ts` (hit, miss, expiry via fake timers, sweep)
- [ ] T004 [P] Implement `src/lib/rate-limit.ts`: per-client daily counter (cap injected, UTC-midnight reset), global eBay-call budget counter, and 30s cooldown state, per data-model.md RateLimitState; tests in `src/lib/rate-limit.test.ts` (cap boundary at 50/51, window reset, budget stop, cooldown expiry — fake timers)
- [ ] T005 [P] Implement `src/lib/shipping.ts`: `estimateShipping() → { shippingEstimateCents, method: 'FLAT_DEFAULT' }` with configurable flat cents (default 500); tests in `src/lib/shipping.test.ts`
- [ ] T006 [P] Extend `src/lib/verdict.ts` for the asking-price world: add `supplySideLiquidity(activeListingCount)` = `min(1, 10/active)` (0 when 0 active, constant configurable), generalize `ValuationInput.soldPricesCents` naming to sample prices with a `pricingBasis` passthrough, and extend `Verdict` with `liquidityBasis`, `pricingBasis`, `noMarketData` (true iff sampleSize = 0) per data-model.md; extend `src/lib/verdict.test.ts` accordingly (keep all existing cases green, add threshold-boundary case profit == threshold → FLIP per SC-005)
- [ ] T007 Implement OAuth2 client-credentials token manager in `src/lib/ebay/auth.ts`: sandbox/production token URL from `EBAY_ENV`, Basic auth from client id/secret, in-memory token cache with proactive refresh (< 5 min remaining), single retry on 401 per research R1/R8; tests in `src/lib/ebay/auth.test.ts` with mocked `fetch` (mint, cached reuse, proactive refresh, refresh-on-401)
- [ ] T008 Implement Browse API client in `src/lib/ebay/browse.ts` (implements `EbayBrowseClient`): `item_summary/search` with `gtin=` or `q=`, `filter=buyingOptions:{FIXED_PRICE}`, `sort=price`, `limit=50`, marketplace header; `AbortSignal.timeout(2000)`, one retry on network error only, price→cents conversion at the boundary, 429/5xx → typed `EbayUnavailableError` (feeds cooldown), 400 → empty result, per research R2/R8; tests in `src/lib/ebay/browse.test.ts` with mocked `fetch`
- [ ] T009 Refactor `src/server.ts` into an exported `buildApp(deps)` factory (deps: browse client, cache, rate limiter, config) with listen-only-when-main behavior, keeping the current stubbed route working; this makes integration tests injectable per research R10

**Checkpoint**: Foundation ready — `docker compose run --rm api npm test` green, user story implementation can begin

---

## Phase 3: User Story 1 - Scan a barcode, get a verdict (Priority: P1) 🎯 MVP

**Goal**: A UPC/ISBN/EAN lookup returns a complete real-data verdict payload (sandbox
listings, no stubbed numbers): FLIP/RIP + value, fees, shipping, profit, liquidity,
sample size, `pricingBasis`, `matchedTitle` — with cache, cap, and failure taxonomy live.

**Independent Test**: `curl -X POST localhost:3000/api/lookup -d '{"identifier":"9780345391803"}'`
returns the full contract shape in <3s; repeat call returns `cached: true` in <500ms;
malformed identifier → 400 with zero eBay calls (quickstart §3-US1).

### Tests for User Story 1 (write first, watch them fail) ⚠️

- [ ] T010 [P] [US1] Unit tests for identifier handling in `src/lib/identify.test.ts`: strip hyphens/spaces, classify EAN-8/ISBN-10/UPC-A/EAN-13/GTIN-14, ISBN-10→ISBN-13 conversion with recomputed check digit, malformed inputs rejected, `cacheKey` = `gtin:<digits>`, missing identifier+title rejected (research R3)
- [ ] T011 [P] [US1] Unit tests for valuation in `src/lib/valuation.test.ts` (fake `EbayBrowseClient`): median of the 10 lowest positive prices from ≤50 sorted listings, <10 listings → smaller sampleSize, zero-price listings skipped, zero listings → sampleSize 0 valuation (still cacheable), `matchedTitle` from top listing, `activeListingCount` from `totalActive`, `pricingBasis: 'ASKING_PRICE'` always (research R4)
- [ ] T012 [P] [US1] Integration tests (fastify.inject + fake client) in `src/server.test.ts` covering US1 acceptance scenarios 1–4 and edge cases: full contract shape incl. flags (SC-003), FLIP over / RIP under threshold, no-listings → 200 RIP `noMarketData: true`, cache hit → `cached: true` + fake client called exactly once (SC-002), malformed identifier → 400 + zero client calls (SC-006), 51st lookup → 429 `limit-reached` (FR-012), client throwing `EbayUnavailableError` → 503 `temporarily-unavailable` and cooldown short-circuits the next miss (FR-015), budget exhausted → 503

### Implementation for User Story 1

- [ ] T013 [US1] Implement `src/lib/identify.ts` (identifier path): normalization, classification, ISBN-10→13 conversion, `ItemQuery { kind: 'gtin', gtin, cacheKey }`, typed `ValidationError` for malformed/missing input per data-model.md
- [ ] T014 [US1] Implement `src/lib/valuation.ts`: `ItemQuery` → `Valuation` via injected `EbayBrowseClient` — median-of-10-lowest (reusing `estimateValueCents`), `samplePricesCents`, `sampleSize`, `activeListingCount`, `matchedTitle`, `pricingBasis`, `computedAt`
- [ ] T015 [US1] Implement `src/lib/pipeline.ts`: `lookup(request, deps) → VerdictResult` orchestrating cache check → valuation (on miss; store even when sampleSize 0) → shipping → extended verdict; sets `cached`, counts eBay budget on actual calls only; steps communicate only via the data-model types (constitution VII)
- [ ] T016 [US1] Rewrite `POST /api/lookup` in `src/server.ts`: JSON schema validation (`identifier` string, `costBasisCents`/`profitThresholdCents` non-negative ints, cents everywhere per FR-013), per-route `onRequest` rate-limit check (429), pipeline invocation, error mapping to the contract taxonomy (400 `validation` / 429 `limit-reached` / 503 `temporarily-unavailable`), `trustProxy` for client IP; remove all stubbed data and the `stubbed` field

**Checkpoint**: MVP — barcode lookups fully functional against sandbox; all US1 tests green

---

## Phase 4: User Story 2 - Look up an item by name (Priority: P2)

**Goal**: Free-text title lookups return the identical verdict payload; identifier takes
precedence with title as fallback; title results cached under normalized-title keys.

**Independent Test**: `curl -X POST localhost:3000/api/lookup -d '{"title":"Chrono Trigger SNES"}'`
returns the full shape; `{}` → 400; repeat with different casing/whitespace hits the cache
(quickstart §3-US2 and cache scenario).

### Tests for User Story 2 (write first, watch them fail) ⚠️

- [ ] T017 [P] [US2] Extend `src/lib/identify.test.ts`: title-only input → `kind: 'title'` with original-casing `titleQuery` and `cacheKey` = `title:<lowercased, trimmed, whitespace-collapsed>`; title length bounds (1–200 after trim); identifier+title → gtin kind retains `titleQuery` for fallback
- [ ] T018 [P] [US2] Extend `src/server.test.ts` for US2 acceptance scenarios 1–3 + edge cases: title lookup returns full contract shape, `{}` → 400 `validation` + zero client calls, identifier+title where gtin search returns empty → exactly one fallback `q=` search (2 calls max, research R2), normalized-title cache hit across casing variants (FR-011), vague title small-sample visible via `sampleSize`

### Implementation for User Story 2

- [ ] T019 [US2] Extend `src/lib/identify.ts` with the title path: trim/length validation, normalized cache key, original-casing query; identifier precedence with title retained as fallback (FR-003)
- [ ] T020 [US2] Extend `src/lib/pipeline.ts` (and `src/lib/valuation.ts` if needed): gtin search with zero results + available title → single title-search fallback, result cached under the gtin cache key (the scanned code stays the lookup identity); budget counts both calls

**Checkpoint**: Barcode AND title lookups both work; US1 tests still green

---

## Phase 5: User Story 3 - Real profit for serious sellers (Priority: P3)

**Goal**: `costBasisCents` and `profitThresholdCents` personalize profit and the FLIP/RIP
cutoff per request — served from the shared cached valuation.

**Independent Test**: Same title with `costBasisCents: 1500` drops `profitCents` by exactly
1500 and can flip the verdict to RIP; `profitThresholdCents: 200` rescues a small-profit
FLIP (quickstart §3-US3).

### Tests for User Story 3 (write first, watch them fail) ⚠️

- [ ] T021 [US3] Extend `src/server.test.ts` for US3 acceptance scenarios 1–3 + edge cases: cost basis deducted exactly (FR-007), omitted basis defaults to 0, custom threshold honored, omitted threshold uses config default (1000), negative basis/threshold → 400 + zero client calls, and two requests differing only in basis/threshold share one cached valuation (fake client called once) with different verdicts

### Implementation for User Story 3

- [ ] T022 [US3] Wire personalization end-to-end: confirm/extend `src/server.ts` schema for optional `costBasisCents`/`profitThresholdCents` (≥ 0, integers) and `src/lib/pipeline.ts` passthrough so verdict math runs per-request on top of the cached valuation; config default threshold from `PROFIT_THRESHOLD_DEFAULT` converted once at startup

**Checkpoint**: All three user stories independently functional

---

## Phase 6: Polish & Cross-Cutting Concerns

- [ ] T023 [P] Create opt-in live sandbox smoke script `scripts/sandbox-smoke.ts` (research R10, quickstart §4): mint token → real Browse search → print formatted VerdictResult; clear error if credentials missing; never imported by tests
- [ ] T024 [P] Quota headroom observability (constitution I; SC-004; closes analyze findings C1/G1): (a) add a Developer Analytics `getRateLimits` check to `scripts/sandbox-smoke.ts` that prints remaining Browse API quota; (b) on server startup in `src/server.ts`, fire a non-blocking `getRateLimits` call that logs quota headroom and skips gracefully when credentials are absent (never on the lookup hot path); (c) expose the internal `ebayCallsToday` counter in `GET /health` so daily consumption is verifiable
- [ ] T025 [P] Update `CLAUDE.md` Current state section: eBay integration + identifier resolution + shipping estimate are real (sandbox); note the six new env vars and the smoke-script command
- [ ] T026 Full verification inside Docker: `docker compose run --rm api npm test` and `npm run typecheck` green; then run quickstart.md §2–3 manual scenarios incl. SC-001 (<3s uncached) and SC-002 (<500ms cached) timing spot-checks

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: none — start immediately
- **Foundational (Phase 2)**: after T001 (config names referenced by modules) — BLOCKS all stories
- **User Stories (Phases 3–5)**: all require Phase 2 complete
  - US2 (Phase 4) builds on US1's `identify.ts`/`pipeline.ts` — sequential after US1 for a solo dev; parallelizable with care if staffed
  - US3 (Phase 5) touches only `server.ts` schema + `pipeline.ts` passthrough — independent of US2
- **Polish (Phase 6)**: after desired stories complete (T026 last)

### Within Phase 2

- T002–T006 are fully parallel (distinct files)
- T007 → T008 (browse client uses the token manager); T008 also needs T002
- T009 anytime (touches only `server.ts`)

### Within Each User Story

- Test tasks first (fail), then implementation
- identify → valuation → pipeline → server route (each consumes the previous step's types)

### Parallel Opportunities

- Phase 2: T002, T003, T004, T005, T006 simultaneously; T007+T009 in a second wave with T008 after
- US1: T010, T011, T012 (three different test files) simultaneously
- US2: T017, T018 simultaneously
- Polish: T023, T024, T025 simultaneously (T023 and T024 both touch `scripts/sandbox-smoke.ts` — do T023 before T024's smoke-script addition, or combine)

## Parallel Example: User Story 1

```bash
# Wave 1 — all US1 test files in parallel (they must fail):
Task: "Unit tests for identifier handling in src/lib/identify.test.ts"          # T010
Task: "Unit tests for valuation in src/lib/valuation.test.ts"                   # T011
Task: "Integration tests for POST /api/lookup in src/server.test.ts"            # T012

# Wave 2 — implementation, sequential (each consumes the previous step's types):
# T013 identify.ts → T014 valuation.ts → T015 pipeline.ts → T016 server.ts route
```

## Implementation Strategy

### MVP First (User Story 1 Only)

1. Phase 1 (T001) + Phase 2 (T002–T009) — foundation
2. Phase 3 (T010–T016) — barcode lookups end-to-end
3. **STOP and VALIDATE**: quickstart §3-US1 + cache/rate-limit probes; demo-able MVP
4. Then US2 → US3 → Polish, validating at each checkpoint

### Incremental Delivery

Each story lands with its tests green and previous stories unbroken (checkpoint gates).
Commit after each task or logical group; the suite must pass in Docker before every commit.

## Notes

- All money integer cents end-to-end — no dollar floats anywhere (constitution VI; FR-013)
- The fake `EbayBrowseClient` is the only eBay surface tests touch; live credentials are
  never required for CI/tests — only for the opt-in T023 smoke script (constitution I, V)
- Pipeline steps communicate only via data-model.md types (constitution VII); a task that
  needs to reach into another step's internals signals a design problem — stop and re-check
