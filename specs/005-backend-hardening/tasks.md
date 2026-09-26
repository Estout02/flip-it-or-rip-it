# Tasks: Backend Hardening

**Input**: Design documents from `/specs/005-backend-hardening/`

**Prerequisites**: plan.md, spec.md, research.md (R1–R8), data-model.md, contracts/lookup-api.yaml, quickstart.md

**Tests**: INCLUDED. The success criteria (SC-001…SC-007) are each defined as an adversarial or
fixture test, so write each story's tests first and watch them fail. All runs happen inside Docker:
`docker compose run --rm api npm test` and `docker compose run --rm api npm run typecheck`
(constitution V). Tests are colocated `*.test.ts` next to source.

**Organization**: Grouped by user story, and each story is an independently testable increment.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies on incomplete tasks)
- **[Story]**: US1–US5 from spec.md

---

## Phase 1: Setup

- [ ] T001 Add `TRUST_PROXY=` to `.env.example` (empty by default), with a comment explaining: empty/`false` means forwarding headers are ignored and the per-client cap is keyed by the connecting address; set it to a hop count (e.g. `1`) or a comma list of proxy IPs/CIDRs **only** when deployed behind a proxy you control; `true` is refused, because it lets any client spoof `X-Forwarded-For` and reset its daily cap (research R3)

---

## Phase 2: Foundational (Blocking Prerequisites)

- [ ] T002 In `src/server.ts` add `trustProxy: false | number | string` to `AppConfig` and set it to `false` in `loadConfig()` for now (the parser lands in T010); in `src/server.test.ts` add `trustProxy: false` to `testConfig`. Pass `trustProxy: config.trustProxy` to `Fastify({...})` in `buildApp`, replacing the hard-coded `trustProxy: true`. Suite must stay green; this alone closes the bypass under default config

**Checkpoint**: Suite green, and the bypass is closed by default.

---

## Phase 3: User Story 1: Liquidity reads the item's own supply (Priority: P1) 🎯 MVP

**Goal**: Title-sourced valuations compute liquidity from `max(matchedCount, round(total × dominance))`; barcode-sourced ones are unchanged; the response carries both figures.

**Independent Test**: A title fixture where half the returned listings are merchandise and eBay reports 80 total yields `competingSupplyCount: 40` and tier MODERATE (raw 80 would be WEAK). A GTIN lookup's supply equals its raw total.

### Tests (write first, see them fail)

- [ ] T003 [P] [US1] In `src/lib/valuation.test.ts` add a `describe('competingSupplyCount')` block: (a) title search, dominance 0.2, total 500 → 100; (b) GTIN search, total 500 → 500; (c) title search where the matched group is all listings → equals total; (d) floor: title search with total 3 but 8 matched listings → 8; (e) floor: dominance tiny so rounding gives 0 while matched ≥ 1 → matched count; (f) zero priced listings → 0. Also assert `activeListingCount` still equals the raw total in every case
- [ ] T004 [P] [US1] In `src/server.test.ts` add an integration test: title lookup against a fake client returning 40 listings: 20 in the dominant category at 4000¢ each and 20 spread across 5 merchandise categories (4 each), with `total: 80`. Dominance = 0.5 (MEDIUM), dispersion = 1 (HIGH), so confidence is MEDIUM and the verdict is not UNCERTAIN. Assert `rawActiveListingCount: 80`, `competingSupplyCount: 40` (round(80 × 0.5)), `liquidityTier: 'MODERATE'` (the raw 80 would have been WEAK under the default 50 cutoff), and `verdict: 'FLIP'`. Add a GTIN lookup assertion that `competingSupplyCount === rawActiveListingCount`. Note: pick fixture numbers so dominance stays ≥ 0.35 (MEDIUM) and dispersion is low; otherwise the verdict becomes UNCERTAIN and the test proves nothing about liquidity

### Implementation

- [ ] T005 [US1] In `src/lib/valuation.ts` add `competingSupplyCount: number` to `Valuation` (doc comment: the figure liquidity consumes; title = dominance-scaled raw total floored at matched listings seen; GTIN = raw total; research R1). Compute it in `computeValuation` for both branches. For the title branch, `matched.length` is the matched count
- [ ] T006 [US1] In `src/lib/pipeline.ts` pass `activeListingCount: valuation.competingSupplyCount ?? valuation.activeListingCount` to `computeVerdict`; add `rawActiveListingCount: number` and `competingSupplyCount: number` to `VerdictResult` and populate them. `computeVerdict`'s interface in `src/lib/verdict.ts` MUST NOT change (constitution VII)

**Checkpoint**: T003/T004 pass and the full suite is green.

---

## Phase 4: User Story 2: Per-caller cap cannot be bypassed (Priority: P1)

**Goal**: Proxy trust is explicit and validated; default ignores forwarding headers.

**Independent Test**: 51 injected lookups from one `remoteAddress` with distinct `x-forwarded-for` values → 51st is 429.

### Tests

- [ ] T007 [P] [US2] In `src/server.test.ts` add `describe('caller identity')`: (a) default config: set `lookupDailyCap: 3`, send 4 lookups from `remoteAddress: '10.0.0.1'`, each with header `x-forwarded-for: 203.0.113.<i>` → the 4th is 429; (b) `trustProxy: '10.0.0.1'`: 4 lookups from remote `10.0.0.1` with distinct forwarded addresses → all 4 succeed (each is a distinct caller); (c) `trustProxy: '10.0.0.1'`: 4 lookups from remote `10.9.9.9` (untrusted) with distinct forwarded addresses → the 4th is 429. Extend the existing `lookup()` helper with an optional `headers` param (or use `app.inject` directly)
- [ ] T008 [P] [US2] In `src/server.test.ts` add `describe('loadConfig — TRUST_PROXY')` with `it.each`: unset → `false`; `''` → `false`; `'false'` → `false`; `'1'` → `1`; `'2'` → `2`; `'10.0.0.1'` → `'10.0.0.1'`; `'10.0.0.0/8, 192.168.1.1'` → `'10.0.0.0/8,192.168.1.1'` (trimmed, rejoined); `'::1'` → `'::1'`; `'fd00::/8'` → `'fd00::/8'`. Invalid, falling back to `false` with `console.warn` called (spy): `'true'`, `'0'`, `'-1'`, `'1.5'`, `'banana'`, `'10.0.0.1/33'`, `'10.0.0.1,nope'`

### Implementation

- [ ] T009 [US2] In `src/server.ts` implement `parseTrustProxy(raw: string | undefined): false | number | string` per research R3 and data-model.md: trim; empty/undefined/`'false'` → `false`; `/^\d+$/` and ≥ 1 → number; otherwise split on `,`, trim each, validate each as `isIP(addr) !== 0` from `node:net` with an optional `/prefix` (0–32 for IPv4, 0–128 for IPv6) → joined string; anything else → `console.warn('Invalid TRUST_PROXY ... — falling back to false (forwarding headers ignored).')` and `false`. Use it in `loadConfig()` in place of T002's hard-coded `false`
- [ ] T010 [US2] (T002 placeholder is now replaced.) Confirm with `grep -n "trustProxy" src/server.ts` that the only `trustProxy` value passed to Fastify comes from config

**Checkpoint**: T007/T008 pass.

---

## Phase 5: User Story 3: Barcode + title fallback gets its own answer (Priority: P2)

**Goal**: The four-case cache ladder of research R2 / data-model.md.

**Independent Test**: An unknown barcode alone, then barcode+title → the second makes exactly one call, a title search.

### Tests

- [ ] T011 [P] [US3] In `src/lib/identify.test.ts`: `fallbackCacheKey` is `gtin:<digits>|title:<normalized>` when both are given (normalization identical to the `title:` key: trim, collapse whitespace, lowercase); absent for barcode-only and title-only; ISBN-10 input produces the ISBN-13 digits in the key
- [ ] T012 [P] [US3] In `src/lib/valuation.test.ts`: `computeValuation(query, client, MATCH_DEFAULTS, { skipBarcodeSearch: true })` for a gtin query with a title makes exactly one call, `{ title }`, and returns `sourcedFrom: 'title'`; `emptyBarcodeValuation()` returns the shape in data-model.md (`sourcedFrom: 'gtin'`, `sampleSize: 0`, `competingSupplyCount: 0`, `match.filtered: false`)
- [ ] T013 [US3] Create `src/lib/pipeline.test.ts` (reuse the counting fake-client pattern from `src/server.test.ts`; build `PipelineDeps` directly with a fresh `TtlCache` and `RateLimiter` per test, and `realizationRate: 1`). Cover every row of the data-model "Cache key states" table, asserting both the result and `client.calls`: (1) B has listings → B+T1 and B+T2 afterwards make 0 calls and share the barcode answer; (2) B empty alone → 1 gtin call, `noMarketData: true`; then B+T → exactly 1 call, `{ title: T }`, result `matchFiltered: true`; (3) then B+T again → 0 calls, `cached: true`; (4) then B+T2 → 1 title call for T2 with T2's answer, not T's; (5) then B alone → 0 calls, empty answer (not T's); (6) cold B+T where the barcode is empty → 2 calls (gtin then title), and afterwards B alone → 0 calls, empty

### Implementation

- [ ] T014 [P] [US3] In `src/lib/identify.ts` add optional `fallbackCacheKey` to `ItemQuery` (doc comment referencing research R2) and set it in the gtin branch when `titleQuery` is present, reusing `normalizeTitle`
- [ ] T015 [P] [US3] In `src/lib/valuation.ts` add a 4th optional parameter `options: { skipBarcodeSearch?: boolean } = {}` to `computeValuation`. When the query is gtin, `skipBarcodeSearch` is set and a `titleQuery` exists, perform only the title search (`sourcedFrom: 'title'`); if `skipBarcodeSearch` is set without a title, return `emptyBarcodeValuation()` without calling. Export `emptyBarcodeValuation()` and `isEmptyBarcodeValuation(v)` (`sourcedFrom === 'gtin' && sampleSize === 0`)
- [ ] T016 [US3] In `src/lib/pipeline.ts` extract `async function resolveValuation(query, deps): Promise<{ valuation: Valuation; cached: boolean }>` implementing the data-model ladder exactly, and use it from `lookup`. The cooldown check (`deps.rateLimiter.inCooldown()` → `EbayUnavailableError`) must run before any compute, as today. When a cold full valuation for a gtin+title query comes back `sourcedFrom: 'title'`, store `emptyBarcodeValuation()` under `query.cacheKey` **and** the result under `query.fallbackCacheKey`. Keep the header comment accurate

**Checkpoint**: T011–T013 pass, including all pre-existing server tests for GTIN fallback.

---

## Phase 6: User Story 4: Burst traffic costs one marketplace call per product (Priority: P2)

**Goal**: In-flight coalescing per cache key (research R5).

**Independent Test**: 10 concurrent cold lookups → 1 fake-client call.

### Tests

- [ ] T017 [US4] In `src/lib/pipeline.test.ts` add `describe('coalescing')`, using a fake client whose `search` awaits a manually released deferred promise: (a) 10 concurrent `lookup()` calls for one title → `client.calls.length === 1`, and all 10 results equal in `estimatedValueCents`; (b) concurrent calls with different `costBasisCents` get different `profitCents` from the same valuation; (c) the deferred rejects with `EbayUnavailableError` → all 10 reject with it, and a subsequent lookup (after releasing the cooldown, e.g. `new RateLimiter({..., cooldownMs: 0})`) makes a fresh call (the failure was not remembered); (d) `rateLimiter.ebayCallsToday()` is 1 after (a). In `src/server.test.ts` add one integration test: 10 concurrent `app.inject` lookups from distinct `remoteAddress`es → 1 call, all 200

### Implementation

- [ ] T018 [US4] In `src/lib/pipeline.ts` add a module-private `const inflightByCache = new WeakMap<TtlCache<Valuation>, Map<string, Promise<Valuation>>>()` and `function coalesce(cache, key, compute: () => Promise<Valuation>): Promise<Valuation>`: return the existing promise if present; otherwise create `compute()`, register it, and `.finally()` delete it (delete only if the map still holds this same promise). Wrap each compute-and-store in `resolveValuation` with it, keyed by the key the result is stored under (`fallbackCacheKey` for the barcode-empty + title path, otherwise `cacheKey`). The cache write happens inside `compute` so it happens once. Waiters report `cached: false`

**Checkpoint**: T017 passes and the full suite is green.

---

## Phase 7: User Story 5: Misconfiguration and malformed requests fail safe (Priority: P3)

**Goal**: Validated numeric settings, bounded per-caller memory, strict request bodies.

**Independent Test**: `LOOKUP_DAILY_CAP=abc` → warning + 50; `{"title":"x","costBasis":0}` → 400 naming `costBasis`.

### Tests

- [ ] T019 [P] [US5] In `src/server.test.ts` add `describe('loadConfig — numeric settings')` with `it.each` over every setting in the data-model AppConfig table: valid custom value accepted (e.g. `LOOKUP_DAILY_CAP=7` → 7, `EBAY_FEE_RATE=0` → 0, `SHIPPING_FLAT_CENTS=0` → 0, `VALUATION_CACHE_TTL_HOURS=0.5` → 1_800_000 ms, `PROFIT_THRESHOLD_DEFAULT=12.5` → 1250, `PORT=8080`); invalid values fall back to the default with `console.warn` called, naming the env var: `LOOKUP_DAILY_CAP` in {`abc`, `0`, `-5`, `2.5`}; `EBAY_DAILY_CALL_BUDGET` in {`x`, `0`}; `EBAY_FEE_RATE` in {`1`, `-0.1`, `abc`}; `SHIPPING_FLAT_CENTS` in {`-1`, `4.5`, `x`}; `VALUATION_CACHE_TTL_HOURS` in {`0`, `-1`, `x`}; `PROFIT_THRESHOLD_DEFAULT` in {`-1`, `x`}; `PORT` in {`0`, `70000`, `x`}. Unset keeps the defaults silently (no warn)
- [ ] T020 [P] [US5] In `src/lib/rate-limit.test.ts` (use `vi.useFakeTimers()` / `vi.setSystemTime`): 10,000 distinct clients on day 1 → `trackedClientCount === 10000`; advance to the next UTC day, one lookup from a new client → `trackedClientCount === 1`; a day-1 client's count is reset (can consume `lookupDailyCap` again)
- [ ] T021 [P] [US5] In `src/server.test.ts` add strict-body tests: `{"title":"x","costBasis":0}` → 400, `error: 'validation'`, message contains `costBasis`, and the fake client made 0 calls; `{"title":"x","costBasisCents":0,"extra":1}` → 400 naming `extra`; a valid body with all four allowed fields → 200

### Implementation

- [ ] T022 [US5] In `src/server.ts` add `function numericSetting(env, name, fallback, isValid: (n: number) => boolean): number` (research R4): unset → fallback silently; `Number(raw)` failing `Number.isFinite` or `isValid` → `console.warn(\`Invalid ${name} ${JSON.stringify(raw)} — falling back to ${fallback}.\`)` and fallback. Apply the ranges from the data-model table to every scalar in `loadConfig()`. Convert hours→ms and dollars→cents **after** validation, keeping the existing "converted to cents exactly once" comment
- [ ] T023 [P] [US5] In `src/lib/rate-limit.ts` add a private `currentDay` field; in `tryConsumeLookup`, when `utcDayStart(now) !== this.currentDay`, run `this.perClient.clear()` and update `currentDay` (comment: amortised O(1) since it runs once per UTC day, and memory is bounded by today's distinct callers; research R6). Add a `get trackedClientCount(): number`
- [ ] T024 [US5] In `src/server.ts` set `additionalProperties: false` on `lookupBodySchema`, and construct Fastify with `ajv: { customOptions: { removeAdditional: false } }`, with a comment that Fastify's default `removeAdditional: true` would silently strip unknown fields instead of rejecting them (research R7). In `setErrorHandler`, when `err.validation` contains an entry with `keyword === 'additionalProperties'`, reply 400 with `message: \`Unknown field "${params.additionalProperty}". Allowed: identifier, title, costBasisCents, profitThresholdCents.\``

**Checkpoint**: T019–T021 pass and the full suite is green.

---

## Phase 8: Polish & Cross-Cutting

- [ ] T025 [P] In `CLAUDE.md` fix the quick smoke test body to `{"title":"Chrono Trigger SNES","costBasisCents":0}`, add `TRUST_PROXY` to the env-var list, and add a short "Current state" paragraph for spec 005: liquidity uses `competingSupplyCount` (dominance-scaled on title searches); barcode fallbacks are cached per title; proxy trust is off unless `TRUST_PROXY` is set; request bodies are strict; identical in-flight lookups coalesce
- [ ] T026 [P] Grep for other `costBasis"` / `"costBasis":` usages in `docs/`, `specs/*/quickstart.md`, `scripts/`, `AGENTS.md` (`grep -rn '"costBasis"' --include=*.md --include=*.ts .`) and fix any outside historical spec text
- [ ] T027 Run `docker compose run --rm api npm test` and `docker compose run --rm api npm run typecheck`; both must pass with 0 failures. Then walk the quickstart §2 manual checks that don't need live eBay data (strict-body 400, the `loadConfig` warning one-liner)
- [ ] T028 Mark every task above `[X]` in this file as it completes

---

## Dependencies & Execution Order

- **Phase 1 → Phase 2** before any story.
- **US1 (Phase 3)** and **US2 (Phase 4)** are independent of each other.
- **US3 (Phase 5)** depends on US1's T005 only in that both edit `valuation.ts`. Do them sequentially in that file.
- **US4 (Phase 6)** depends on US3's T016 (`resolveValuation` is what gets wrapped).
- **US5 (Phase 7)**: T022/T024 edit `server.ts` alongside US2's T009. Sequence those edits; T023 is independent.
- **Polish** last.

### File ownership (for parallel agents)

| File | Tasks |
|---|---|
| `src/lib/valuation.ts` / `.test.ts` | T003, T005, T012, T015 |
| `src/lib/identify.ts` / `.test.ts` | T011, T014 |
| `src/lib/pipeline.ts`, `pipeline.test.ts` (new) | T006, T013, T016, T017, T018 |
| `src/lib/rate-limit.ts` / `.test.ts` | T020, T023 |
| `src/server.ts` / `server.test.ts` | T002, T004, T007–T010, T019, T021, T022, T024 |

### Parallel Opportunities

- T003 ∥ T004 ∥ T007 ∥ T008 (tests in different describe blocks; the server.test.ts edits are appends)
- T011 ∥ T012, then T014 ∥ T015
- T020 + T023 (rate-limit) can run at any time after Phase 2
- T025 ∥ T026

## Implementation Strategy

**MVP** = Phase 2 (bypass closed) + US1 (correct liquidity). These are the two answer- and cost-changing
fixes. US3/US4 follow because they share the pipeline refactor, and US5 is independent hygiene.
Because every story is small, a single implementer may go phase by phase. For parallel agents, split
by the file-ownership table: (A) valuation+identify+pipeline = US1, US3, US4; (B) server+rate-limit = Phase 2, US2, US5.
