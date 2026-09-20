# Implementation Plan: Product Match Filtering

**Branch**: `004-product-match-filtering` | **Date**: 2026-09-20 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/004-product-match-filtering/spec.md`

## Summary

Free-text lookups currently value accessories. The fix is entirely client-side on data the search
response already carries: keep only the listings belonging to the dominant product category, draw
the estimate from a central band rather than the cheapest listings, and report how confident the
match is — with an explicit `UNCERTAIN` verdict when it isn't.

One change does most of the work: **dropping `sort=price`**. Sorting ascending and taking the ten
cheapest is both what made accessories fatal *and* what would corrupt a dominant-category vote,
since the returned fifty are then disproportionately merchandise. Relevance ordering fixes the
sample and the vote together (research R1, R2).

## Technical Context

**Language/Version**: TypeScript on Node 24 (ESM, `.js` import specifiers)

**Primary Dependencies**: Fastify (API surface only — no new deps)

**Storage**: N/A — stateless; the in-memory `TtlCache<Valuation>` absorbs the new fields unchanged
(research R9)

**Testing**: Vitest, run inside Docker (`docker compose run --rm api npm test`)

**Target Platform**: Linux container (compose service `api`)

**Project Type**: Single backend web service

**Performance Goals**: No measurable latency change — grouping and dispersion over ≤50 in-memory
listings

**Constraints**: Zero additional marketplace calls (constitution III — the two-call
category-refinement approach was explicitly rejected); money in integer cents (VI); step boundaries
intact (VII)

**Scale/Scope**: 6 source files touched (`ebay/types.ts`, `ebay/browse.ts`, `valuation.ts`,
`verdict.ts`, `pipeline.ts`, `server.ts`) plus tests, and 2 ancillary in polish. No new deps, no
schema.

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| Principle | Assessment | Status |
|-----------|-----------|--------|
| **I. eBay Compliance** | No new calls, no scraping — grouping operates on a response already fetched. Honesty materially improved: the feature exists to stop presenting a keychain's price as a game's with unwarranted authority. | ✅ PASS |
| **II. Latency First** | Grouping, median and dispersion over ≤50 in-memory objects. No I/O added. | ✅ PASS |
| **III. Cost Discipline** | Zero new calls (FR-004/SC-006). The `fieldgroups=CATEGORY_REFINEMENTS` route was probed and **rejected precisely because it costs a dedicated call** — it returns refinements and zero items, so it would double per-lookup cost (research R3). | ✅ PASS |
| **IV. Spec-Driven** | Traces to spec 004; both clarifications resolved, and two design avenues killed by live probing before planning. | ✅ PASS |
| **V. Sandbox-First Testing** | Unit and integration tests run in Docker against a fake client. Live production probes were read-only and are not part of the suite. | ✅ PASS |
| **VI. Money Is Integer Cents** | Prices stay integer cents. Dispersion and dominance are dimensionless ratios, never money. | ✅ PASS |
| **VII. Extensible Verdict Pipeline** | "Which listings represent this item" is squarely the **valuation** step's job, and that is where filtering lands. The verdict step only consumes the resulting confidence. No step reaches into another's internals. | ✅ PASS |

**Post-Phase 1 re-check**: ✅ All gates pass. See "Post-Design Constitution Re-Check".

## Project Structure

### Documentation (this feature)

```text
specs/004-product-match-filtering/
├── plan.md              # This file
├── research.md          # Phase 0 output
├── data-model.md        # Phase 1 output
├── quickstart.md        # Phase 1 output
├── contracts/
│   └── lookup-api.yaml  # Phase 1 output — contract v0.5.0
├── checklists/
│   └── requirements.md  # From /speckit-specify
└── tasks.md             # Phase 2 output (/speckit-tasks — NOT created here)
```

### Source Code (repository root)

```text
src/
├── server.ts                 # MODIFIED: match-confidence threshold config
├── server.test.ts            # MODIFIED: config + response shape + end-to-end cases
└── lib/
    ├── ebay/
    │   ├── types.ts          # MODIFIED: ListingSummary gains category fields
    │   ├── browse.ts         # MODIFIED: drop sort=price; extract category per listing
    │   └── browse.test.ts    # MODIFIED: extraction + query-shape cases
    ├── valuation.ts          # MODIFIED: product grouping, central band, confidence
    ├── valuation.test.ts     # MODIFIED: grouping/dominance/dispersion cases
    ├── verdict.ts            # MODIFIED: UNCERTAIN verdict, confidence passthrough
    ├── verdict.test.ts       # MODIFIED: UNCERTAIN precedence cases
    ├── pipeline.ts           # MODIFIED: forwards config and the new fields
    ├── identify.ts           # UNTOUCHED (constitution VII)
    └── shipping.ts           # UNTOUCHED (constitution VII)

.env.example                  # MODIFIED: two new documented thresholds
scripts/sandbox-smoke.ts      # MODIFIED (polish): print match + confidence
CLAUDE.md                     # MODIFIED (polish): filtering and UNCERTAIN semantics
```

**Structure Decision**: Grouping and confidence live in `valuation.ts`, which already owns "what is
this item worth". No new module: the two helpers are small, exported and independently testable,
and splitting them out would separate them from the only code that calls them. This feature touches
more files than 002 or 003 because the category data must be carried from the eBay client boundary
(`browse.ts` → `types.ts`) through to valuation — unavoidable, since the wire response is where the
signal lives.

## Complexity Tracking

> No constitution violations. Table intentionally empty.

## Post-Design Constitution Re-Check

- **No new dependency, module, or marketplace call** introduced by the design.
- **Contract change** adds `UNCERTAIN` to the verdict enum plus match fields; version 0.4.0 →
  0.5.0. Fourth verdict state is a real cost to a future frontend, justified in research R6 — the
  alternatives were to report a confident verdict we do not believe, or to return RIP for
  "we don't know", which is a lie the product cannot afford.
- **Constitution III re-verified against the design**: the rejected two-call approach is documented
  in research so the cheaper path is not "optimised" back into existence later.
- **Constitution VII re-verified**: `browse.ts` only transports category data it already receives;
  the decision about which listings represent the item is made once, in the valuation step.

✅ All gates pass. Ready for `/speckit-tasks`.
