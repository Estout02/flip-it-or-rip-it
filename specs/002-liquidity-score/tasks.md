# Tasks: Liquidity-Gated Verdict

**Input**: Design documents from `/specs/002-liquidity-score/`

**Prerequisites**: plan.md, spec.md, research.md, data-model.md, contracts/lookup-api.yaml, quickstart.md

**Tests**: INCLUDED — spec SC-006 explicitly requires new tests covering every edge case, and the
eBay sandbox cannot produce the active-listing counts this feature keys on (quickstart §1), so
fake-client tests are the only real proof. Write each story's tests first and watch them fail. All
test/typecheck runs happen inside Docker: `docker compose run --rm api npm test` (constitution V).

**Organization**: Tasks are grouped by user story so each story is an independently testable
increment. Tests are colocated `*.test.ts` next to source (existing convention).

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies)
- **[Story]**: Which user story this task belongs to (US1, US2, US3)

---

## Phase 1: Setup

**Purpose**: Configuration surface for the three new tuning knobs

- [X] T001 Add the three liquidity knobs to `.env.example` with comments and defaults per data-model.md: `LIQUIDITY_STRONG_MAX_LISTINGS=10` (also feeds the supply-side score constant — research R3), `LIQUIDITY_MODERATE_MAX_LISTINGS=50`, `LIQUIDITY_RISKY_MARGIN_MULTIPLIER=2` (dimensionless ratio applied to the profit threshold, like `EBAY_FEE_RATE`)

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: The tier classifier, config types, and config plumbing every story flows through

**⚠️ CRITICAL**: No user story work can begin until this phase is complete

- [X] T002 In `src/lib/verdict.ts` add the types and classifier per data-model.md: `LiquidityTier` (`'STRONG' | 'MODERATE' | 'WEAK' | 'UNPROVEN'`), `VerdictReasonCode` (5 members), `LiquidityConfig` (`strongMaxListings`, `moderateMaxListings`, `riskyMarginMultiplier`), an exported `LIQUIDITY_DEFAULTS` (10 / 50 / 2), the optional `liquidity?: Partial<LiquidityConfig>` field on `ValuationInput` (per-field defaults from `LIQUIDITY_DEFAULTS`, matching the existing `feeRate?` precedent so all 001 call sites and tests stay green), and the pure classifier `liquidityTier(activeListingCount, config)` — `0 → UNPROVEN`, `1..strongMax → STRONG`, `..moderateMax → MODERATE`, else `WEAK`, inclusive on the more-liquid side (research R7); add tier tests to `src/lib/verdict.test.ts` covering each band, both boundary values (exactly `strongMax` → STRONG, exactly `moderateMax` → MODERATE), and `0 → UNPROVEN` (never STRONG)
- [X] T003 [P] Plumb config through in `src/server.ts` and `src/lib/pipeline.ts`: add `liquidity: LiquidityConfig` to `AppConfig`, read the three env vars in `loadConfig()` with the data-model.md validation rules (`moderateMaxListings >= strongMaxListings`, `riskyMarginMultiplier >= 1`, `strongMaxListings >= 1`; on violation fall back to defaults and `console.warn`/log rather than crash), add `liquidity` to `PipelineDeps.config`, and forward it into `computeVerdict` — `pipeline.ts` performs no liquidity logic of its own (constitution VII); add `loadConfig` tests to `src/server.test.ts` for defaults-when-unset and fallback-on-invalid
- [X] T004 [P] In `src/lib/verdict.ts` pass the configured `strongMaxListings` (read from `ValuationInput.liquidity`, defaulted in T002) into the existing `supplySideLiquidity` call as its `strongSupplyMax` argument — the formula itself is unchanged (research R3); add a `src/lib/verdict.test.ts` case asserting score and tier agree at the boundary (a count of exactly `strongMax` yields `liquidityScore === 1` **and** tier `STRONG`)

**Checkpoint**: Foundation ready — `docker compose run --rm api npm test` green with no behavior change yet; user story implementation can begin

---

## Phase 3: User Story 1 - Oversaturated item is caught before listing (Priority: P1) 🎯 MVP

**Goal**: The liquidity score actually gates the verdict. A weak-tier item with a thin margin
verdicts RIP; a weak-tier item that is genuinely valuable verdicts FLIP_RISKY; everything else is
unchanged.

**Independent Test**: Drive `computeVerdict` with a weak-tier active-listing count at two profit
levels — one just over threshold, one ≥ 2× threshold — and confirm `RIP` and `FLIP_RISKY`
respectively, while a strong/moderate/unproven count at the same profits still yields `FLIP`
(quickstart §1 rows US1-AS1/2/3).

### Tests for User Story 1 (write first, watch them fail) ⚠️

- [X] T005 [P] [US1] Gate unit tests in `src/lib/verdict.test.ts`: weak tier + profit just over threshold → `RIP`; weak tier + profit ≥ `riskyMarginCents` → `FLIP_RISKY`; strong, moderate, and unproven tiers + profit over threshold → `FLIP` (FR-004), including a moderate-tier item with profit ≥ `riskyMarginCents` to prove the margin split never fires outside `WEAK` (spec edge case, spec.md "Moderate liquidity tier"); weak tier + profit **below** threshold → `RIP` and never promoted (FR-005, downgrade-only); `sampleSize === 0` with a weak-tier count → `RIP` via the no-market-data branch, which outranks the gate (precedence, research R2); margin boundary — profit exactly `riskyMarginCents` → `FLIP_RISKY` (favorable side); `profitThresholdCents: 0` degenerate case → any profitable weak-tier item is `FLIP_RISKY`, never plain `FLIP` (research R4); custom `liquidity` config shifts every boundary accordingly
- [X] T006 [P] [US1] Integration tests in `src/server.test.ts` via `POST /api/lookup` with a fake `EbayBrowseClient`: a flooded-market fixture (high `totalActive`, high prices) returns `verdict: "FLIP_RISKY"`, and a flooded-market fixture with thin margin returns `verdict: "RIP"`; **and the cache-sharing case (research R1)** — two requests for the same query with different `profitThresholdCents` produce different verdicts from a single cached valuation, with the second request making zero eBay calls

### Implementation for User Story 1

- [X] T007 [US1] Implement the gate in `computeVerdict` in `src/lib/verdict.ts` per the data-model.md state machine: widen `Verdict['verdict']` to `'FLIP' | 'FLIP_RISKY' | 'RIP'`, compute `riskyMarginCents = Math.round(profitThresholdCents * riskyMarginMultiplier)` (integer cents, constitution VI), and evaluate the fixed precedence ladder — (1) `sampleSize === 0` → RIP, (2) `profit < threshold` → RIP, (3) tier `WEAK` && `profit < riskyMarginCents` → RIP, (4) tier `WEAK` && `profit >= riskyMarginCents` → FLIP_RISKY, (5) otherwise FLIP. Structure each branch to already carry its internal branch identity (the `VerdictReasonCode` from T002) so US2 can surface codes without restructuring the ladder

**Checkpoint**: The gate is live and demo-able. Response shape still lacks `liquidityTier`/`reasonCode`/`reason`, so it does not yet satisfy contract v0.3.0 — US2 and US3 close that.

---

## Phase 4: User Story 2 - User understands why it's RIP or FLIP_RISKY (Priority: P2)

**Goal**: Every result explains itself — a machine-readable `reasonCode` plus plain-language
`reason` text, with the liquidity-driven outcomes clearly distinct from a plain
profit-below-threshold RIP.

**Independent Test**: Trigger each of the five ladder branches and confirm each returns its own
`reasonCode` and a distinct human-readable `reason` (quickstart §1 rows US2-AS1/2/3).

### Tests for User Story 2 (write first, watch them fail) ⚠️

- [X] T008 [P] [US2] Reason unit tests in `src/lib/verdict.test.ts`: each of the five ladder branches emits its matching `reasonCode`; the thin-margin RIP text differs from the below-threshold RIP text (FR-008); the two weak-tier reasons mention the competing-listing count so the copy matches the contract examples; a table-driven case asserts every `VerdictReasonCode` member has non-empty copy (exhaustiveness)
- [X] T009 [P] [US2] Response tests in `src/server.test.ts`: `POST /api/lookup` responses carry both `reasonCode` and `reason` for a FLIP, a FLIP_RISKY, a thin-margin RIP, a below-threshold RIP, and a no-market-data RIP

### Implementation for User Story 2

- [X] T010 [US2] In `src/lib/verdict.ts` add `reasonCode: VerdictReasonCode` and `reason: string` to the `Verdict` interface and emit both from the ladder branches implemented in T007; build the copy from an exhaustive `Record<VerdictReasonCode, (ctx) => string>` (or `Record<..., string>` plus a count-interpolating helper for the two weak-tier messages) so the compiler proves every code has text (research R6); wording must match the tone of the contract examples in `specs/002-liquidity-score/contracts/lookup-api.yaml`

**Checkpoint**: Results are self-explaining; US1 verdicts unchanged and still green

---

## Phase 5: User Story 3 - Degraded signal stays honest (Priority: P3)

**Goal**: The liquidity tier is visible on the wire, the supply-side-only limitation stays
explicit, and the zero-competing-supply case is labeled `UNPROVEN` rather than silently treated as
strong liquidity.

**Independent Test**: Any response exposes `liquidityTier` alongside `liquidityBasis:
"SUPPLY_SIDE_ONLY"`; a zero-active-listing item with a valid price sample reads `UNPROVEN` and has
its verdict decided by profit alone (quickstart §1 rows US3-AS1/2).

### Tests for User Story 3 (write first, watch them fail) ⚠️

- [X] T011 [P] [US3] Honesty tests in `src/lib/verdict.test.ts` and `src/server.test.ts`: every response includes `liquidityTier` and retains `liquidityBasis: 'SUPPLY_SIDE_ONLY'`; a zero-active-listing result with a non-empty price sample reports tier `UNPROVEN` (not `STRONG`) and its verdict matches what profit-vs-threshold alone would produce, in both directions (profitable → FLIP, unprofitable → RIP), proving the gate never fires for `UNPROVEN` (FR-004); assert the weak-tier reason copy claims supply knowledge only — no substring implying sales/sold-through data (constitution I valuation honesty)

### Implementation for User Story 3

- [X] T012 [US3] In `src/lib/verdict.ts` add `liquidityTier: LiquidityTier` to the `Verdict` interface and return the tier computed in T007's ladder; confirm the field flows untouched through `VerdictResult` in `src/lib/pipeline.ts` and out of `POST /api/lookup`, completing conformance with contract v0.3.0's required-field list

**Checkpoint**: All three stories delivered; response matches `contracts/lookup-api.yaml` v0.3.0 exactly

---

## Phase 6: Polish & Cross-Cutting Concerns

- [X] T013 [P] Update `scripts/sandbox-smoke.ts` to print the new fields in its formatted summary — liquidity tier next to the existing score line, and the verdict reason — so a live sandbox run surfaces them (quickstart §5)
- [X] T014 [P] Update the Current state section of `CLAUDE.md`: the verdict is now three-way (FLIP / FLIP_RISKY / RIP) and liquidity-gated, note the three new env vars, and reference `specs/002-liquidity-score/`
- [X] T015 [P] Verify the three worked examples in `specs/002-liquidity-score/contracts/lookup-api.yaml` match real output — feed each example's inputs through the fake client and reconcile every field (adjust the contract examples, not the code, if the arithmetic differs)
- [X] T016 Full verification inside Docker: `docker compose run --rm api npm test` and `docker compose run --rm api npm run typecheck` green; walk the complete coverage table in `specs/002-liquidity-score/quickstart.md` §1 and confirm every row has a test; run `specs/002-liquidity-score/quickstart.md` §4 (temporarily lowered tier cutoffs) to observe a real `FLIP_RISKY` end-to-end and restore defaults afterwards; confirm SC-005 — the cache-hit test still asserts zero external calls, so the feature added no eBay traffic

---

## Dependencies & Execution Order

- **Setup (Phase 1)**: T001 first — nothing else depends on it, but it documents the knobs T003 reads
- **Foundational (Phase 2)**: T002 → then T003 and T004 in parallel. **Blocks all stories.**
- **US1 (Phase 3)**: after Phase 2. T005, T006 (tests, parallel) → T007
- **US2 (Phase 4)**: after US1 (attaches codes to T007's ladder branches). T008, T009 (parallel) → T010
- **US3 (Phase 5)**: after US1; independent of US2 in principle, but both touch the `Verdict` interface in `verdict.ts` — run US2 then US3 to avoid a merge conflict in one file
- **Polish (Phase 6)**: after the desired stories complete; T013, T014, T015 parallel; T016 last

### Within Phase 2

- T002 creates the types **and the `ValuationInput.liquidity` field** that T003 forwards into and T004 reads — it must land first, which is what makes T003/T004 safely parallel
- T003 (`server.ts`, `pipeline.ts`) and T004 (`verdict.ts`) touch disjoint files → parallel

### Within Each User Story

- Test tasks first (they must fail), then the single implementation task
- Implementation order inside `verdict.ts`: ladder (T007) → reasons (T010) → tier exposure (T012); each adds to the previous rather than reworking it

### Parallel Opportunities

- Phase 2: T003 + T004 simultaneously (after T002)
- US1: T005 + T006 simultaneously (different test files)
- US2: T008 + T009 simultaneously (different test files)
- Polish: T013 + T014 + T015 simultaneously (three different files)

## Parallel Example: User Story 1

```bash
# Wave 1 — both US1 test files in parallel (they must fail):
Task: "Gate unit tests in src/lib/verdict.test.ts"                    # T005
Task: "Integration tests in src/server.test.ts"                       # T006

# Wave 2 — implementation, single file:
# T007 computeVerdict precedence ladder in src/lib/verdict.ts
```

## Implementation Strategy

### MVP First (User Story 1 Only)

1. Phase 1 (T001) + Phase 2 (T002–T004) — config and classifier, no behavior change yet
2. Phase 3 (T005–T007) — the gate goes live; oversaturated items stop returning false FLIPs
3. **STOP and VALIDATE**: quickstart §1 US1 rows + §4 local gate exercise; this is the founder-visible win
4. Then US2 (explanations) → US3 (tier on the wire, honesty) → Polish, validating at each checkpoint

### Incremental Delivery

Each story lands with its tests green and previous stories unbroken (checkpoint gates). Note that
full contract v0.3.0 conformance is only reached at the end of US3 — US1 and US2 are intentionally
partial response shapes, which is safe because no frontend consumes this API yet.

## Notes

- All money integer cents end-to-end; `riskyMarginMultiplier` is a dimensionless ratio, never a
  money value (constitution VI; research R4)
- Zero new eBay calls — the gate reads only `activeListingCount` and `sampleSize`, which the
  valuation step already returns (constitution III; SC-005). A task that needs a new external call
  signals a design problem — stop and re-check
- Gate logic stays inside the verdict step; `identify.ts`, `valuation.ts`, and `shipping.ts` must
  not be modified by any task in this feature (constitution VII)
- Reason copy must never imply knowledge of actual sales — the signal is supply-side only until
  Marketplace Insights access is granted (constitution I)
