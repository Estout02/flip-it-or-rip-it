# Tasks: Realization Rate Correction

**Input**: Design documents from `/specs/003-realization-rate/`

**Prerequisites**: plan.md, spec.md, research.md, data-model.md, contracts/lookup-api.yaml, quickstart.md

**Tests**: INCLUDED — SC-003 is defined in terms of the existing suite, SC-005 demands every
reported value be reconstructable, and quickstart §1 carries a full coverage table. Write each
story's tests first and watch them fail. All test/typecheck runs happen inside Docker:
`docker compose run --rm api npm test` (constitution V).

**Organization**: Tasks are grouped by user story so each story is an independently testable
increment. Tests are colocated `*.test.ts` next to source (existing convention).

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies)
- **[Story]**: Which user story this task belongs to (US1, US2, US3)

---

## Phase 1: Setup

**Purpose**: Configuration surface for the rate

- [X] T001 Add `VALUATION_REALIZATION_RATE=0.8` to `.env.example` with a comment stating the valid range (`0 < rate <= 1`), that it is the fraction of the asking-price median an item is expected to sell for, and — explicitly — that 0.8 is a founder judgment call awaiting calibration against real sale outcomes, not a measured figure

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: The correction primitive, its config, and — critically — pinning the existing suite
at rate 1.0 *before* any behavior changes, so intended shifts can never be confused with
regressions

**⚠️ CRITICAL**: No user story work can begin until this phase is complete

- [X] T002 In `src/lib/verdict.ts` add the correction primitive per data-model.md: exported `REALIZATION_RATE_DEFAULT = 0.8`, the pure function `applyRealizationRate(rawCents, rate)` returning `Math.round(rawCents * rate)`, and the optional `realizationRate?: number` field on `ValuationInput` (defaulting to `REALIZATION_RATE_DEFAULT` when absent, matching the existing `feeRate?` precedent so all 001/002 call sites keep compiling); add unit tests to `src/lib/verdict.test.ts` for the function alone — rounding to whole cents, a rate of 1 returning the input unchanged, and a 0-cent input returning 0. Do **not** wire it into `computeVerdict` yet; that is T008
- [X] T003 [P] In `src/server.ts` add `realizationRate: number` to `AppConfig` and read `VALUATION_REALIZATION_RATE` in `loadConfig()`, validating `0 < rate <= 1` and falling back to `REALIZATION_RATE_DEFAULT` with a logged warning otherwise (research R4, mirroring the existing `loadLiquidityConfig` pattern); in `src/server.test.ts` add `loadConfig` tests for default-when-unset, a valid custom rate, and fallback on each invalid case (`0`, `1.5`, `-1`, non-numeric), and add `realizationRate: 1` to the shared `testConfig` fixture to pin the existing integration suite (research R9)
- [X] T004 [P] In `src/lib/verdict.test.ts` pin the existing unit suite at rate 1.0 (research R9): add `realizationRate: 1` to the shared `base` fixtures in the `computeVerdict`, `liquidity gate (US1)`, `verdict reasons (US2)`, and `liquidity honesty (US3)` describe blocks so every pre-existing expected number keeps proving the underlying profit math once the correction lands. Leave the `pricingBasis: 'ASKING_PRICE' as const` literals in those same fixtures untouched here — they are typed inputs, so they can only change atomically with the type itself in T011

**Checkpoint**: `docker compose run --rm api npm test` green, no behavior change yet — the suite is now pinned and the primitive exists unused

---

## Phase 3: User Story 1 - Aspirational asking prices stop producing false FLIPs (Priority: P1) 🎯 MVP

**Goal**: The estimated value becomes `round(median × rate)`, fees follow the corrected value, and
the false-FLIP band disappears — items that only cleared the threshold because of the optimistic
median now correctly RIP.

**Independent Test**: Value an item whose raw median clears the threshold by less than the
correction and confirm it becomes RIP, while an item comfortably clear stays FLIP (quickstart §1
rows US1-AS1/2/3).

### Tests for User Story 1 (write first, watch them fail) ⚠️

- [X] T005 [P] [US1] Correction unit tests in `src/lib/verdict.test.ts`: an item clearing the threshold only by less than the haircut becomes `RIP` at the default rate while staying `FLIP` at rate 1 (the false-FLIP band, SC-002); an item comfortably clear stays `FLIP`; `feesCents` equals `round(correctedValue * feeRate)` and never the raw median (FR-003); `profitCents` derives from the corrected value; `sampleSize === 0` still yields value 0 and the unchanged `NO_MARKET_DATA` RIP (FR-006); a median that scales to a fractional cent rounds to a whole number of cents
- [X] T006 [P] [US1] Integration tests in `src/server.test.ts` exercised **at the production default rate of 0.8**, not the pinned 1.0 — this closes the risk research R9 flags, that pinning leaves the real default untested: a fixture whose verdict is `FLIP` at rate 1 but `RIP` at 0.8 returns `RIP` through `POST /api/lookup` when the config carries the default, and a comfortably profitable fixture still returns `FLIP`

### Implementation for User Story 1

- [X] T007 [US1] In `src/lib/valuation.ts` remove the dead `estimatedValueCents` field from the `Valuation` interface and stop computing it in `computeValuation` (research R1 — it is cached but read by nothing, and leaving it would become a second, diverging source of truth the moment T008 lands); update `src/lib/valuation.test.ts` to assert the sample prices and `sampleSize` directly instead of the removed field. Sequenced before T008 so no window exists in which two value computations disagree
- [X] T008 [US1] In `src/lib/verdict.ts` wire the correction into `computeVerdict`: compute `rawAskingMedianCents` via the existing `estimateValueCents`, derive `estimatedValueCents` by applying `applyRealizationRate` with the resolved rate, and compute `feesCents` and `profitCents` from the **corrected** value (data-model.md "Derivation"). also edit `src/lib/pipeline.ts` — add `realizationRate: number` to `PipelineDeps.config` and pass `realizationRate: deps.config.realizationRate` into the `computeVerdict` call; it performs no arithmetic of its own (constitution VII)

**Checkpoint**: The correction is live. Response still lacks `rawAskingMedianCents`, `realizationRate`, and the new basis label, so it does not yet satisfy contract v0.4.0 — US2 closes that.

---

## Phase 4: User Story 2 - The number stays honest about what it is (Priority: P2)

**Goal**: The response stops describing an adjusted figure as a raw asking price, and carries
enough data to reconstruct the corrected value.

**Independent Test**: Inspect any response and confirm `pricingBasis: ADJUSTED_ASKING_PRICE` plus
`rawAskingMedianCents` and `realizationRate`, with `round(raw × rate) === estimatedValueCents`
(quickstart §1 rows US2-AS1/2).

### Tests for User Story 2 (write first, watch them fail) ⚠️

- [X] T009 [P] [US2] Labeling and audit unit tests in `src/lib/verdict.test.ts`: `pricingBasis` reads `ADJUSTED_ASKING_PRICE` at the default rate **and at a rate of exactly 1.0** (research R5 — the label is constant, which is the one place FR-005's "reproduces current behavior" deliberately does not extend); `rawAskingMedianCents` and `realizationRate` are present on every result; `Math.round(rawAskingMedianCents * realizationRate) === estimatedValueCents` holds across several samples; at rate 1 the raw and corrected values are equal
- [X] T010 [P] [US2] Response-shape tests in `src/server.test.ts`: add `rawAskingMedianCents` and `realizationRate` to the `REQUIRED_VERDICT_FIELDS` list so the existing contract-shape assertions enforce contract v0.4.0, and assert a `POST /api/lookup` response can be reconstructed — raw median times rate equals the reported estimated value (SC-005)

### Implementation for User Story 2

- [X] T011 [US2] In `src/lib/verdict.ts` change the `PricingBasis` type from `'ASKING_PRICE'` to `'ADJUSTED_ASKING_PRICE'` and add `rawAskingMedianCents: number` and `realizationRate: number` to the `Verdict` interface, returning both from `computeVerdict`; update the `pricingBasis` literal in `src/lib/valuation.ts` to match, since `Valuation` carries the same type. **Keep `pricingBasis` a passthrough input on `ValuationInput`** rather than deriving it in `computeVerdict` — deriving it is arguably cleaner but widens the diff, and the label's only producer is `valuation.ts`, which this task updates. The type change breaks 8 existing occurrences that MUST all be updated in this task, four of which are typed inputs that stop *compiling* rather than merely failing: fixtures at `src/lib/verdict.test.ts` lines ~87, ~159, ~264, ~315, and assertions at `src/lib/verdict.test.ts` (~143), `src/lib/valuation.test.ts` (~85-90), and `src/server.test.ts` (~114)

**Checkpoint**: Response matches `contracts/lookup-api.yaml` v0.4.0 exactly; US1 verdicts unchanged

---

## Phase 5: User Story 3 - The rate can be tuned and later calibrated (Priority: P3)

**Goal**: Prove the rate is genuinely retunable through configuration alone, end to end.

**Note**: This story needs **no implementation task** — the capability is delivered by T003
(config) and T008 (application). This phase exists to verify it rather than assume it, which is
the honest shape for a story whose requirement is "this must remain changeable."

**Independent Test**: Run the same item through the API under two configured rates and confirm the
value and verdict shift with no code change (quickstart §1 rows US3-AS1/2).

### Tests for User Story 3 (write first, watch them fail) ⚠️

- [X] T012 [P] [US3] End-to-end retune tests in `src/server.test.ts`: the same fixture served by apps configured at two different rates returns proportionally different `estimatedValueCents` and, at a rate low enough to drop it under the threshold, a different verdict — with no source change between runs (US3-AS1); assert the reported `realizationRate` matches the configured one in each case. Invalid-config fallback is already covered by T003's `loadConfig` tests (US3-AS2) and is not duplicated here

**Checkpoint**: All three stories delivered

---

## Phase 6: Polish & Cross-Cutting Concerns

- [X] T013 [P] Update `scripts/sandbox-smoke.ts` to print the raw median and applied rate beside the corrected value in its formatted summary, so a live sandbox run shows what adjustment was applied (quickstart §5)
- [X] T014 [P] Update the Current state section of `CLAUDE.md`: `estimatedValueCents` is now a realization-rate-corrected estimate rather than a raw asking median, note `VALUATION_REALIZATION_RATE` alongside the other env vars, state plainly that 0.8 is an uncalibrated judgment call, and reference `specs/003-realization-rate/`
- [X] T015 [P] Verify the three worked examples in `specs/003-realization-rate/contracts/lookup-api.yaml` against real output by feeding each example's raw median through the pipeline at rate 0.8 — expected `3900→3120/413/2207`, `15000→12000/1590/9910`, `2200→1760/233/1027`; adjust the contract examples, not the code, if the arithmetic differs
- [X] T016 Full verification inside Docker: `docker compose run --rm api npm test` and `docker compose run --rm api npm run typecheck` green; walk the coverage table in `specs/003-realization-rate/quickstart.md` §1 and confirm every row has a test; **explicitly re-verify the spec 002 liquidity fixtures** rather than assuming them — the correction moves `FLOODED_THIN` from clearing the threshold by $4.08 to clearing it by $0.27, so confirm the gate's margin split still lands where those tests expect; confirm SC-006 — the cache-hit test still asserts zero external calls

---

## Dependencies & Execution Order

- **Setup (Phase 1)**: T001 documents the knob T003 reads
- **Foundational (Phase 2)**: T002 → then T003 and T004 in parallel. **Blocks all stories.**
- **US1 (Phase 3)**: after Phase 2. T005, T006 (tests, parallel) → T007 → T008
- **US2 (Phase 4)**: after US1. T009, T010 (parallel) → T011
- **US3 (Phase 5)**: after US1 (needs the correction live); independent of US2
- **Polish (Phase 6)**: after the desired stories; T013, T014, T015 parallel; T016 last

### Within Phase 2

- T002 creates `applyRealizationRate`, `REALIZATION_RATE_DEFAULT`, and the `ValuationInput` field that T003 forwards and T004 pins against — it must land first
- T003 (`server.ts`, `server.test.ts`) and T004 (`verdict.test.ts`) touch disjoint files → parallel
- Pinning (T003/T004) must complete **before** T008 changes behavior, or the whole suite goes red at once and intended shifts become indistinguishable from regressions

### Within Each User Story

- Test tasks first (they must fail), then implementation
- US1 implementation order is deliberate: T007 (remove the dead field) precedes T008 (apply the correction) so there is never a moment where `valuation.ts` and `verdict.ts` both compute a value and disagree

### Parallel Opportunities

- Phase 2: T003 + T004 simultaneously (after T002)
- US1: T005 + T006 simultaneously (different test files)
- US2: T009 + T010 simultaneously (different test files)
- Polish: T013 + T014 + T015 simultaneously (three different files)

## Parallel Example: User Story 1

```bash
# Wave 1 — both US1 test files in parallel (they must fail):
Task: "Correction unit tests in src/lib/verdict.test.ts"            # T005
Task: "Integration tests at the default rate in src/server.test.ts" # T006

# Wave 2 — implementation, strictly ordered:
# T007 remove dead field in src/lib/valuation.ts
# T008 apply correction in src/lib/verdict.ts
```

## Implementation Strategy

### MVP First (User Story 1 Only)

1. Phase 1 (T001) + Phase 2 (T002–T004) — primitive, config, and a pinned suite; no behavior change
2. Phase 3 (T005–T008) — the correction goes live; false FLIPs disappear
3. **STOP and VALIDATE**: quickstart §1 US1 rows; verdicts are now centered rather than optimistic
4. Then US2 (honest labeling) → US3 (retune proof) → Polish

### Incremental Delivery

Each story lands with its tests green and previous stories unbroken. Full contract v0.4.0
conformance is reached at the end of US2, not US1 — safe because no frontend consumes this API.

## Notes

- All money integer cents; `realizationRate` is a dimensionless ratio like `feeRate` and
  `riskyMarginMultiplier`, never a money value (constitution VI)
- Zero new eBay calls — the correction is arithmetic on prices already fetched (constitution III)
- `identify.ts` and `shipping.ts` must not be modified by any task in this feature (constitution VII)
- The default rate of 0.8 is a guess, and every artifact should keep saying so. The feature's real
  deliverable is that the guess is *replaceable* once user-reported sale outcomes exist
