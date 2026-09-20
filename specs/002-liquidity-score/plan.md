# Implementation Plan: Liquidity-Gated Verdict

**Branch**: `002-liquidity-score` | **Date**: 2026-09-19 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/002-liquidity-score/spec.md`

## Summary

Turn the existing supply-side liquidity score from an informational field into a gate on the
verdict. The verdict becomes three-way (`FLIP` / `FLIP_RISKY` / `RIP`), every result carries a
liquidity **tier** (strong / moderate / weak / unproven) derived from active listing count, and a
weak-tier item's outcome depends on margin size: thin margin over threshold → `RIP`, comfortable
margin (≥ 2× threshold by default) → `FLIP_RISKY`.

Technically this is a contained change to the **verdict step only**: pure arithmetic over data the
valuation step already returns (`activeListingCount`, `sampleSize`), three new configurable knobs
plumbed through `loadConfig` → `PipelineDeps.config` → `computeVerdict`, and an expanded response
contract. Zero new external calls, zero new I/O on the lookup path.

## Technical Context

**Language/Version**: TypeScript on Node 24 (ESM, `.js` import specifiers)

**Primary Dependencies**: Fastify (API surface only — no new deps required by this feature)

**Storage**: N/A — stateless; the in-memory `TtlCache<Valuation>` is unaffected (see research R1)

**Testing**: Vitest, run inside Docker (`docker compose run --rm api npm test`)

**Target Platform**: Linux container (compose service `api`)

**Project Type**: Single backend web service

**Performance Goals**: No measurable addition to lookup latency — the gate is branch-and-compare
arithmetic executed after the existing verdict math

**Constraints**: Zero additional eBay API calls (constitution III); gate logic confined to the
verdict step (constitution VII); all money in integer cents (constitution VI)

**Scale/Scope**: 4 source files touched (`verdict.ts`, `pipeline.ts`, `server.ts`,
`.env.example`) plus their tests, and 2 ancillary files updated during polish
(`scripts/sandbox-smoke.ts`, `CLAUDE.md`). No new modules, no schema, no migrations.

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| Principle | Assessment | Status |
|-----------|-----------|--------|
| **I. eBay Compliance Is Non-Negotiable** | No new eBay calls, no scraping — the gate is pure post-processing of data the valuation step already fetched. Valuation honesty preserved: `liquidityBasis` stays `SUPPLY_SIDE_ONLY` and reason text is worded to claim supply knowledge only, never sales knowledge (spec US3). | ✅ PASS |
| **II. Latency First** | Integer/float comparisons only; no I/O, no middleware, no new blocking work on the hot path. | ✅ PASS |
| **III. Cost Discipline** | Zero new external calls (spec FR-009/SC-005). Cache behavior unchanged — gate is computed per-request *after* the cached valuation, so no cache-key or TTL impact (research R1). | ✅ PASS |
| **IV. Spec-Driven Development** | Feature traces to `specs/002-liquidity-score/spec.md`; all three founder clarifications resolved before planning. | ✅ PASS |
| **V. Sandbox-First Testing** | All tests and typechecks run in the container; no host execution. | ✅ PASS |
| **VI. Money Is Integer Cents** | The risky-margin cutoff is derived as integer cents (`Math.round(thresholdCents × multiplier)`); the multiplier is a dimensionless ratio, matching the existing `feeRate` precedent. | ✅ PASS |
| **VII. Extensible Verdict Pipeline** | Gate lives entirely in `verdict.ts`. `identify.ts`, `valuation.ts`, `shipping.ts` are untouched; steps still communicate only through declared input/output types. | ✅ PASS |

**Post-Phase 1 re-check**: ✅ All gates still pass — the design adds no module, no dependency, and
no call. See "Post-Design Constitution Re-Check" below.

## Project Structure

### Documentation (this feature)

```text
specs/002-liquidity-score/
├── plan.md              # This file
├── research.md          # Phase 0 output
├── data-model.md        # Phase 1 output
├── quickstart.md        # Phase 1 output
├── contracts/
│   └── lookup-api.yaml  # Phase 1 output — contract v0.3.0
├── checklists/
│   └── requirements.md  # From /speckit-specify
└── tasks.md             # Phase 2 output (/speckit-tasks — NOT created here)
```

### Source Code (repository root)

```text
src/
├── server.ts                 # MODIFIED: 3 new config fields in AppConfig/loadConfig
├── server.test.ts            # MODIFIED: response-shape + config-default cases
└── lib/
    ├── verdict.ts            # MODIFIED: tier fn, gate fn, 3-way verdict, reason codes
    ├── verdict.test.ts       # MODIFIED: tier/gate/boundary/precedence cases
    ├── pipeline.ts           # MODIFIED: pass liquidity config into computeVerdict
    ├── identify.ts           # UNTOUCHED (constitution VII)
    ├── valuation.ts          # UNTOUCHED (constitution VII)
    └── shipping.ts           # UNTOUCHED (constitution VII)

.env.example                  # MODIFIED: 3 new documented knobs
scripts/sandbox-smoke.ts      # MODIFIED (polish): print tier + reason in the summary
CLAUDE.md                     # MODIFIED (polish): three-way verdict, 3 new env vars
```

**Structure Decision**: Existing single-project layout is unchanged. This feature deliberately adds
no new module — the tier classifier and gate are two small pure functions inside `verdict.ts`,
which already owns `supplySideLiquidity` and `computeVerdict`. Splitting them into a separate
`liquidity.ts` was considered and rejected (research R5): it would fragment the verdict step's
logic across files for no testability gain, since the functions are exported and unit-testable
either way.

## Complexity Tracking

> No constitution violations. Table intentionally empty.

## Post-Design Constitution Re-Check

After Phase 1 design (data model + contract):

- **No new dependency, module, or external call** was introduced by the design.
- **Contract change is additive-plus-enum-expansion** (`verdict` gains `FLIP_RISKY`; four new
  response fields). Version bumped 0.2.0 → 0.3.0. No consumer exists yet (no frontend built), so
  the breaking enum expansion carries zero migration cost today — the spec's assumption that a
  future frontend designs around three states holds.
- **Constitution VI** re-verified against the data model: the only new money-derived value
  (`riskyMarginCents`) is an integer-cents field; the multiplier is a config ratio, never stored or
  returned as money.

✅ All gates pass. Ready for `/speckit-tasks`.
