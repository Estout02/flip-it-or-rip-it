# Implementation Plan: Realization Rate Correction

**Branch**: `003-realization-rate` | **Date**: 2026-09-19 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/003-realization-rate/spec.md`

## Summary

Replace the implicit 1.0 multiplier on the asking-price median with a configurable realization
rate (default 0.8), so the estimated value reflects expected *sale* price rather than *asking*
price. Fees compute from the corrected value, the valuation basis label becomes
`ADJUSTED_ASKING_PRICE`, and the response carries the raw median, the corrected value, and the rate
linking them.

The change is small arithmetically but touches a structural wart: `Valuation.estimatedValueCents`
is computed and cached today yet **never consumed** — `computeVerdict` independently recomputes the
median from `samplePricesCents`, and only that second computation reaches the response. Applying
the correction to one of those two sites would silently produce disagreeing numbers, exactly what
FR-002 forbids. The plan removes the dead field so there is structurally one place a value is
produced (research R1).

## Technical Context

**Language/Version**: TypeScript on Node 24 (ESM, `.js` import specifiers)

**Primary Dependencies**: Fastify (API surface only — no new deps required)

**Storage**: N/A — stateless; the in-memory `TtlCache<Valuation>` is unaffected (see research R8)

**Testing**: Vitest, run inside Docker (`docker compose run --rm api npm test`)

**Target Platform**: Linux container (compose service `api`)

**Project Type**: Single backend web service

**Performance Goals**: No measurable latency change — one multiply and one round added to the
verdict step

**Constraints**: Zero additional eBay API calls (constitution III); money stays integer cents
(constitution VI); valuation labeling must stay honest (constitution I)

**Scale/Scope**: 5 source files touched (`verdict.ts`, `valuation.ts`, `pipeline.ts`,
`server.ts`, `.env.example`) plus their tests, and 2 ancillary files in polish
(`scripts/sandbox-smoke.ts`, `CLAUDE.md`). No new modules, no schema, no migrations.

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| Principle | Assessment | Status |
|-----------|-----------|--------|
| **I. eBay Compliance Is Non-Negotiable** | No new eBay calls; pure post-processing of prices already fetched. Valuation honesty is **improved**: the basis label stops calling an adjusted number a raw asking price, and the response exposes both the raw median and the rate so the figure is fully auditable. | ✅ PASS |
| **II. Latency First** | One multiplication and one rounding operation on the existing hot path. No I/O. | ✅ PASS |
| **III. Cost Discipline** | Zero new external calls (FR-010/SC-006). No cache-key or TTL change. | ✅ PASS |
| **IV. Spec-Driven Development** | Traces to `specs/003-realization-rate/spec.md`; both clarifications resolved before planning. | ✅ PASS |
| **V. Sandbox-First Testing** | All tests and typechecks run in the container. | ✅ PASS |
| **VI. Money Is Integer Cents** | Corrected value is `Math.round(rawMedian × rate)` — integer cents. The rate is a dimensionless ratio, matching the `feeRate` and `riskyMarginMultiplier` precedents; it is never stored or returned as money. | ✅ PASS |
| **VII. Extensible Verdict Pipeline** | Worth stating plainly: this consolidates value computation into `verdict.ts`. That is not a transfer of ownership — `estimateValueCents` **already** lives in `verdict.ts`, and `valuation.ts` merely called it into a field nothing read. Removing that dead call reduces cross-step duplication rather than creating it. Step interfaces are otherwise unchanged. | ✅ PASS |

**Post-Phase 1 re-check**: ✅ All gates still pass. See "Post-Design Constitution Re-Check" below.

## Project Structure

### Documentation (this feature)

```text
specs/003-realization-rate/
├── plan.md              # This file
├── research.md          # Phase 0 output
├── data-model.md        # Phase 1 output
├── quickstart.md        # Phase 1 output
├── contracts/
│   └── lookup-api.yaml  # Phase 1 output — contract v0.4.0
├── checklists/
│   └── requirements.md  # From /speckit-specify
└── tasks.md             # Phase 2 output (/speckit-tasks — NOT created here)
```

### Source Code (repository root)

```text
src/
├── server.ts                 # MODIFIED: realizationRate config field + validation
├── server.test.ts            # MODIFIED: config cases, response shape, corrected verdicts
└── lib/
    ├── verdict.ts            # MODIFIED: applyRealizationRate, corrected value, raw median, basis
    ├── verdict.test.ts       # MODIFIED: correction cases; existing cases pinned to rate 1.0
    ├── valuation.ts          # MODIFIED: remove the dead estimatedValueCents field
    ├── valuation.test.ts     # MODIFIED: assert the sample rather than the removed field
    ├── pipeline.ts           # MODIFIED: realizationRate on PipelineDeps.config, forwarded
    ├── identify.ts           # UNTOUCHED (constitution VII)
    └── shipping.ts           # UNTOUCHED (constitution VII)

.env.example                  # MODIFIED: VALUATION_REALIZATION_RATE documented
scripts/sandbox-smoke.ts      # MODIFIED (polish): print raw median + rate
CLAUDE.md                     # MODIFIED (polish): adjusted-value semantics, new env var
```

**Structure Decision**: Existing layout unchanged; no new module. `applyRealizationRate` is a small
exported pure function beside `estimateValueCents` in `verdict.ts`, which already owns valuation
arithmetic. A separate `pricing.ts` was considered and rejected (research R7) — it would split two
functions that are always called together across two files for no testability gain.

## Complexity Tracking

> No constitution violations. Table intentionally empty.

## Post-Design Constitution Re-Check

After Phase 1 design (data model + contract):

- **No new dependency, module, or external call** introduced.
- **Contract change** is an enum value replacement (`ASKING_PRICE` → `ADJUSTED_ASKING_PRICE`) plus
  two additive fields (`rawAskingMedianCents`, `realizationRate`). Version bumped 0.3.0 → 0.4.0.
  Still no consumer, so the breaking change costs nothing today.
- **Constitution I re-verified**: the design makes the response *more* auditable than before — a
  reader can reconstruct the corrected value from the raw median and rate, which was impossible
  when the number was an unlabelled raw median.
- **Constitution VI re-verified**: `realizationRate` appears in the response as a ratio, never as
  a money field; every money field remains integer cents.

✅ All gates pass. Ready for `/speckit-tasks`.
