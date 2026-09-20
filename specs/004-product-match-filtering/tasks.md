# Tasks: Product Match Filtering

**Input**: Design documents from `/specs/004-product-match-filtering/`

**Prerequisites**: plan.md, spec.md, research.md, data-model.md, contracts/lookup-api.yaml, quickstart.md

**Tests**: INCLUDED — quickstart §1 carries a full coverage table and the success criteria are
defined in terms of it. Write each story's tests first and watch them fail. All runs happen inside
Docker: `docker compose run --rm api npm test` (constitution V).

**Organization**: Grouped by user story so each is an independently testable increment. Tests are
colocated `*.test.ts` next to source.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies)
- **[Story]**: Which user story this task belongs to (US1, US2, US3)

---

## Phase 1: Setup

- [X] T001 Add the four match thresholds to `.env.example` with comments: `MATCH_MIN_DOMINANCE_HIGH=0.6`, `MATCH_MIN_DOMINANCE_MEDIUM=0.35`, `MATCH_MAX_DISPERSION_HIGH=2.5`, `MATCH_MAX_DISPERSION_MEDIUM=6`, documenting that dominance is the matched group's share of returned listings, dispersion is the p75/p25 price ratio *within* that group, and that **all four defaults are judgment calls** chosen so the live "Chrono Trigger SNES" reference case lands on LOW

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Carry per-listing category from the wire into valuation, and stop price-ascending
ordering from poisoning both the sample and the dominance vote

**⚠️ CRITICAL**: No user story work can begin until this phase is complete

- [X] T002 [P] Wire layer: in `src/lib/ebay/types.ts` add `leafCategoryId?: string` and `leafCategoryName?: string` to `ListingSummary`; in `src/lib/ebay/browse.ts` extract them from each summary's `leafCategoryIds[0]` and `categories[0].categoryName`, and **remove `sort: 'price'` from TITLE (`q=`) searches only, keeping it for GTIN searches** (research R2 — price-ascending returns the fifty *cheapest* matches, which both guarantees accessories in the sample and could elect the wrong dominant category; but GTIN lookups bypass filtering entirely, so changing the set they see would break FR-005/SC-003 and alter results on the one path that already works). The client transports category data and MUST NOT interpret it (research R8). Update `src/lib/ebay/browse.test.ts`: category extraction incl. listings with neither field present, and query-shape assertions that a title search carries **no** `sort` parameter while a GTIN search still carries `sort=price`
- [X] T003 [P] Config layer: in `src/lib/valuation.ts` add the `MatchConfig` interface, exported `MATCH_DEFAULTS` (0.6 / 0.35 / 2.5 / 6) and a `resolveMatchConfig` helper; in `src/server.ts` add `match: MatchConfig` to `AppConfig` and read the four env vars in `loadConfig()` validating `0 < dominance ≤ 1`, `minDominanceMedium ≤ minDominanceHigh`, `dispersion ≥ 1` and `maxDispersionHigh ≤ maxDispersionMedium`, falling back to defaults with a logged warning on any violation (mirroring `loadLiquidityConfig`); in `src/lib/pipeline.ts` add `match` to `PipelineDeps.config` and widen the `computeValuation(query, client)` signature to accept it as an **optional third parameter defaulting to `MATCH_DEFAULTS`** — there are 8 existing call sites (`grep -rn 'computeValuation(' src/`) and a required parameter would break every one at compile time. Add `loadConfig` tests to `src/server.test.ts` for defaults-when-unset, valid custom values, and fallback on each invalid case. Do **not** wire grouping yet — that is T006

**Checkpoint**: Suite green. Category data now reaches valuation and queries are relevance-ordered, but nothing filters yet.

---

## Phase 3: User Story 1 - A title search values the actual item (Priority: P1) 🎯 MVP

**Goal**: Stop valuing keychains. Listings are grouped by leaf category, only the dominant group is
valued, and the estimate comes from a central band of that group rather than the cheapest ten.

**Independent Test**: Value a contaminated result set — a dominant product group plus cheaper
accessories in other categories — and confirm the accessories contribute nothing and the estimate
reflects the dominant group (quickstart §1 rows US1-AS1/2/3).

### Tests for User Story 1 (write first, watch them fail) ⚠️

- [X] T004 [P] [US1] Grouping tests in `src/lib/valuation.test.ts`: a fixture mirroring the live reference case (dominant Video Games group plus merchandise/magnet/mousepad listings in other categories) yields a sample containing **zero** accessory listings; the estimate is the median of the **matched** listings, not of the ten cheapest overall; a single miscategorized listing inside an otherwise-clean set does not change which group wins (FR-003/SC-007); a GTIN-sourced result set is **not** filtered and is byte-identical to today (FR-005); **and the fallback trap — a GTIN query whose barcode search returns nothing and falls back to a title search IS filtered** (research R7), which requires the bypass to key on the search that actually ran rather than on `ItemQuery.kind`
- [X] T005 [P] [US1] Integration tests in `src/server.test.ts`: `POST /api/lookup` with a contaminated fake result set returns an estimate drawn from the dominant group, and `matchedTitle` is a listing from that group rather than an accessory

### Implementation for User Story 1

- [X] T006 [US1] In `src/lib/valuation.ts` implement grouping per data-model.md: bucket listings by `leafCategoryId`, select the group with the largest share, build `samplePricesCents` from that group only — **all of them, up to the 50 returned; this means removing the `SAMPLE_MAX = 10` cap at `src/lib/valuation.ts:20` and its use at line 46**, which is the constant that literally implements "ten cheapest". Set `matchedTitle` to the **first listing of the matched group in relevance order** (the order eBay returns, which T002 restores by dropping the price sort) — this is load-bearing, since T016's primary pass condition is that `matchedTitle` is never an accessory. Skip all of this when the listings came from a GTIN search. Record on the `Valuation` which search produced the listings so the bypass decision is made from fact, not from the original query kind

**Checkpoint**: Accessories no longer poison valuations. Response does not yet expose the match or its confidence — US2 adds that.

---

## Phase 4: User Story 2 - The user can tell how confident the match is (Priority: P2)

**Goal**: Surface what was matched and how strongly, including the case where a dominant category
still contains several distinct products.

**Independent Test**: Compare a clean single-product result set against a heterogeneous one and
confirm the reported confidence differs (quickstart §1 rows US2-AS1/2 and FR-010).

### Tests for User Story 2 (write first, watch them fail) ⚠️

- [X] T007 [P] [US2] Confidence tests in `src/lib/valuation.test.ts`: `dominanceShare` equals matched-group size over returned listings; `dispersionRatio` is p75/p25 **within** the matched group and is exactly `1` when that group holds fewer than 4 listings (quartiles are meaningless below that); `confidence` is the **worse** of the two measures; **a set with high dominance but a $6-to-$800 spread is LOW** (FR-010/SC-008 — this is the live reference case and the reason dominance alone is insufficient); listings spread evenly across categories are LOW on dominance
- [X] T008 [P] [US2] Response tests in `src/server.test.ts`: add `matchConfidence`, `matchedCategoryName`, `matchDominance` and `matchFiltered` to `REQUIRED_VERDICT_FIELDS` so the existing contract-shape assertions enforce v0.5.0, and assert a barcode lookup reports `matchFiltered: false` with a null `matchedCategoryName`

### Implementation for User Story 2

- [X] T009 [US2] In `src/lib/valuation.ts` compute and attach the `ProductMatch` (category id/name, `dominanceShare`, `dispersionRatio`, `confidence`, `filtered`) to the `Valuation`; in `src/lib/verdict.ts` add `matchConfidence` to the `Verdict` interface and accept it through `ValuationInput` as **`matchConfidence?: MatchConfidence` defaulting to `'HIGH'`** — there are 36 `computeVerdict({...})` call sites in the test suite (`grep -rn 'computeVerdict({' src/ --include='*.test.ts'`) and a required field would break all of them at compile time, matching the existing `feeRate?` / `liquidity?` precedent; in `src/lib/pipeline.ts` forward the match fields onto `VerdictResult`. The verdict step reads confidence but MUST NOT recompute it (constitution VII)

**Checkpoint**: Every response says what was valued and how sure we are. Verdict still claims confidence it may not have — US3 closes that.

---

## Phase 5: User Story 3 - Contaminated valuations stop reaching the verdict (Priority: P3)

**Goal**: A match we do not trust produces `UNCERTAIN`, not a confident FLIP or RIP.

**Independent Test**: A low-confidence lookup returns `verdict: UNCERTAIN` with
`reasonCode: LOW_MATCH_CONFIDENCE` (quickstart §1 row US3-AS1).

### Tests for User Story 3 (write first, watch them fail) ⚠️

- [X] T010 [P] [US3] Ladder tests in `src/lib/verdict.test.ts`: `matchConfidence: 'LOW'` yields `UNCERTAIN` / `LOW_MATCH_CONFIDENCE` with non-empty reason copy; **`NO_MARKET_DATA` still outranks it** (empty sample wins); **it outranks the liquidity gate** — a low-confidence *and* weak-liquidity item returns `UNCERTAIN`, not a liquidity verdict (research R6); `HIGH` and `MEDIUM` confidence leave every existing verdict path untouched; every `VerdictReasonCode` still has copy (the exhaustiveness test must cover the new code)
- [X] T011 [P] [US3] Integration test in `src/server.test.ts`: a heterogeneous fake result set returns `verdict: "UNCERTAIN"` through `POST /api/lookup`, with figures still present for transparency

### Implementation for User Story 3

- [X] T012 [US3] In `src/lib/verdict.ts` widen `Verdict['verdict']` to include `'UNCERTAIN'`, add `LOW_MATCH_CONFIDENCE` to `VerdictReasonCode` and `VERDICT_REASON_CODES`, add its copy to the reason map, and insert the branch into `decideVerdict` **immediately after the no-market-data check and before the profit/liquidity branches** per data-model.md's revised precedence. Copy must read as "we could not identify your item", never as a soft RIP

**Checkpoint**: All three stories delivered; response matches contract v0.5.0

---

## Phase 6: Polish & Cross-Cutting Concerns

- [X] T013 [P] Update `scripts/sandbox-smoke.ts` to print the matched category, dominance and confidence beside the existing figures (quickstart §5)
- [X] T014 [P] Update the Current state section of `CLAUDE.md`: title lookups are filtered to the dominant product category and valued from a central band, barcode lookups bypass filtering, the verdict is now four-way with `UNCERTAIN`, note the four `MATCH_*` env vars, and state plainly that variant/region separation is **not** solved
- [X] T015 [P] Verify the four worked examples in `specs/004-product-match-filtering/contracts/lookup-api.yaml` against real output from the fake client; adjust the contract examples, not the code, if figures differ
- [X] T016 **Live production regression** per `specs/004-product-match-filtering/quickstart.md` §4 — the only honest validation, since the sandbox cannot reproduce the contamination this feature exists to fix. Run the two title queries and the ISBN query against the production overlay and confirm: `matchedTitle` is never a keychain, magnet, mousepad or carrying case; the ISBN result is unchanged from its pre-feature value ($7.97 raw, RIP) with `matchFiltered: false`. The primary pass condition is that no accessory is ever valued; the verdict each query lands on is secondary. Record the measured results in quickstart §4 (the pre-implementation prediction that both would return `UNCERTAIN` proved wrong — see the table there)
- [X] T017 Full verification inside Docker: `docker compose run --rm api npm test` and `npm run typecheck` green; walk the coverage table in `specs/004-product-match-filtering/quickstart.md` §1 and confirm every row has a test; re-verify the spec 002 and 003 suites rather than assuming them, since sample composition changed beneath them; confirm SC-006 — the cache-hit test still asserts zero external calls

---

## Dependencies & Execution Order

- **Setup (Phase 1)**: T001 documents the knobs T003 reads
- **Foundational (Phase 2)**: T002 and T003 in parallel. **Blocks all stories.**
- **US1 (Phase 3)**: after Phase 2. T004, T005 (parallel) → T006
- **US2 (Phase 4)**: after US1 — confidence is computed over the group US1 selects. T007, T008 (parallel) → T009
- **US3 (Phase 5)**: after US2 — the verdict branch consumes the confidence US2 produces. T010, T011 (parallel) → T012
- **Polish (Phase 6)**: after the desired stories; T013-T015 parallel; T016 needs production credentials; T017 last

### Within Phase 2

- T002 (`ebay/types.ts`, `ebay/browse.ts`, `ebay/browse.test.ts`) and T003 (`valuation.ts`, `server.ts`, `server.test.ts`, `pipeline.ts`) touch disjoint files → parallel
- Both must land before US1: T006 needs category data on listings (T002) and thresholds (T003)

### Within Each User Story

- Test tasks first (they must fail), then the single implementation task
- The stories are deliberately sequential here, unlike 002/003: US2 measures the group US1 selects, and US3 gates on the confidence US2 computes. Attempting them in parallel would mean building against fields that do not exist yet

### Parallel Opportunities

- Phase 2: T002 + T003 simultaneously
- US1: T004 + T005 | US2: T007 + T008 | US3: T010 + T011
- Polish: T013 + T014 + T015 simultaneously

## Parallel Example: User Story 1

```bash
# Wave 1 — both US1 test files in parallel (they must fail):
Task: "Grouping tests in src/lib/valuation.test.ts"          # T004
Task: "Integration tests in src/server.test.ts"              # T005

# Wave 2 — implementation, single file:
# T006 grouping + central band + GTIN bypass in src/lib/valuation.ts
```

## Implementation Strategy

### MVP First (User Story 1 Only)

1. Phase 1 (T001) + Phase 2 (T002-T003) — category data flows, relevance ordering, config
2. Phase 3 (T004-T006) — accessories stop being valued. **This is the bug fix.**
3. **STOP and VALIDATE**: run quickstart §4 against production early — seeing a real title query
   stop returning a keychain is the moment this feature justifies itself
4. Then US2 (visibility) → US3 (UNCERTAIN) → Polish

### Incremental Delivery

Full contract v0.5.0 conformance arrives at the end of US3, not US1. Safe because no frontend
consumes this API.

## Notes

- Zero new marketplace calls. The `fieldgroups=CATEGORY_REFINEMENTS` route returns refinements and
  **zero items**, so it would double per-lookup cost — it is rejected in research R3 and MUST NOT
  be reintroduced as an "optimisation" (constitution III)
- `identify.ts` and `shipping.ts` must not be modified by any task in this feature (constitution VII)
- Money stays integer cents; dominance and dispersion are dimensionless ratios (constitution VI)
- This feature does **not** separate variants or regions. An honest `UNCERTAIN` on an ambiguous
  query is the deliverable, not a precise price for every query
