# Implementation Plan: eBay Fee Model

**Branch**: `cursor/constitution-v2-fee-model-spec-c607` (spec dir `009-fee-model`) | **Date**: 2026-11-06 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/009-fee-model/spec.md`

## Summary

Build a deterministic, category-aware eBay US fee — final value fee by marginal or whole bracket
plus the per-order fee — computed in integer cents from a dated, sourced schedule held as data.
The verdict step receives the fee as an injected pure function (constitution VII), so it imports
nothing from the fee modules. The response gains an additive `feeBreakdown` and `feesCents` keeps
its meaning. Category resolution is: ISBN identifier ⇒ Books; leaf category found in a (initially
empty) reviewable map ⇒ that category; else the default category flagged as assumed.

**The shipped schedule is `THIRD_PARTY_UNVERIFIED` and does not drive live `feesCents` or the
verdict until the founder marks it `FOUNDER_VERIFIED` (D11 / FR-017).** Production still wires a
FeeService so the unverified status is visible. Tests apply the schedule only with
`applySchedule: true`. No eBay call, no new dependency, no new request field, no UI change.

## Technical Context

**Language/Version**: TypeScript 5.7 (ESM), Node 24 (existing API package)

**Primary Dependencies**: none added (existing `fastify`, `@fastify/static`)

**Storage**: N/A — schedule and category map are source-controlled data modules; nothing persisted

**Testing**: Vitest, colocated `*.test.ts`; fake `EbayBrowseClient` (existing); injected clock

**Target Platform**: the existing Fastify API (Docker); web client untouched

**Project Type**: web-service (backend change only)

**Performance Goals**: no measurable change to lookup latency; fee path is a pure function of a few
integer operations, no new `await` in `lookup()` (constitution II)

**Constraints**: integer cents and integer basis points only; no I/O in the fee path; no new env
var (`EBAY_FEE_RATE` remains the live rate until FOUNDER_VERIFIED, and the no-schedule fallback
after that); strict request bodies unchanged; unverified third-party rates must not silently become
production-ready

**Scale/Scope**: one schedule (eBay US, 15 categories), one resolver, one seam, 23 tasks

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-checked after Phase 1 design — still passes.*

Checked against **v1.1.0 (in force)** and **v2.0.0 (proposed, commit `65be0ff`)**. Where v2.0.0 adds
a rule, the second column says whether the plan already satisfies it, so approval of the amendment
does not invalidate this plan.

| Principle | v1.1.0 | v2.0.0 (proposed) | How the plan satisfies it |
|---|---|---|---|
| I. Compliance | PASS | PASS | Adds no eBay call and fetches no eBay page (rates read from a third-party MIT table; `ebay.com` not fetched). Cites the licence basis: MIT for the table; fee data is not eBay Content. Does not assert that eBay consent exists (research R11). The v2.0.0 rule restricting price modelling is untouched by this spec. |
| II. Latency | PASS | PASS | Pure in-memory computation; no new await; schedule validated once at startup, not per request. |
| III. Cost | PASS | PASS | 0 external calls, 0 new services. Fees computed after the cache read so the 24h valuation cache is unaffected. |
| IV. Spec-driven | PASS | PASS | This spec; implementation waits for Checkpoint 1 approval. |
| V. Sandbox testing | PASS | PASS | All tests in Docker; no live call needed. |
| VI. Integer cents | PASS | PASS | Money in cents; rates in integer basis points; rounding rule stated and tested (stronger than today's `Math.round(cents × float)`). |
| VII. Pipeline | PASS | PASS | Fee is an explicit typed input to the verdict step; verdict imports nothing from `src/lib/fees/`. Sanctioned by v2.0.0's named seam; under v1.1.0 it is "explicit inputs/outputs", also satisfied. |
| VIII. Accessibility | N/A | N/A | No UI change. (If a UI later shows `feeBreakdown`, its spec carries the a11y work.) |
| IX. Source-backed rules | n/a (new) | PASS | Schedule carries source URLs, `verifiedAt`, review interval, licence, verification status; assumptions are returned; staleness flagged; `validateSchedule` fails a rule without a source. Unverified rates are not applied to live cents (D11). |
| X. Honest claims | n/a (new) | PASS | Fee category assumed ⇒ said so; unverified schedule ⇒ said so *and not applied*; no tax or price-modelling claims. |

**Complexity Tracking**: none required — no violations. One *deviation from the roadmap wording*
worth knowing: the roadmap describes 009 as "per-category fee plus per-order fee"; this plan also
adds the schedule provenance/staleness machinery because Principle IX (proposed) requires it and
retrofitting it later would touch every response again.

## Project Structure

### Documentation (this feature)

```text
specs/009-fee-model/
├── spec.md
├── plan.md                 # this file
├── research.md             # R1–R14
├── data-model.md           # types, algorithm, seam, resolution order
├── quickstart.md           # hand-derived fee table, SC-002 demo, commands, founder gate
├── analysis.md             # Checkpoint 1 analyze pass (2026-11-07)
├── CHECKPOINT-1.md         # founder review screen
├── contracts/
│   ├── lookup-api.delta.yaml
│   └── ebay-us-fee-source.snapshot.json
├── checklists/requirements.md
├── tasks.md                # includes ## Work Packages
└── run-log.md
```

### Source Code (repository root)

```text
src/lib/fees/                 # NEW — pure, no I/O
├── types.ts
├── schedule.ebay-us.ts       # data + provenance
├── schedule.ebay-us.test.ts  # validateSchedule on the shipped schedule + snapshot equivalence
├── calculate.ts
├── calculate.test.ts         # the 26-row table + properties
├── category-map.ts           # data; starts empty
├── category.ts
├── category.test.ts
├── index.ts                  # createFeeService
└── index.test.ts             # breakdown, assumptions, staleness (injected clock), legacy fallback
src/lib/verdict.ts            # + computeFees seam (minimal diff)
src/lib/verdict.test.ts       # + seam tests
src/lib/pipeline.ts           # + fees dep, feeBreakdown on result
src/lib/pipeline.test.ts      # + SC-002, resolution tests (existing tests untouched)
src/server.ts                 # AppConfig.fees?; withFeeService(); production builder always wires it (D11)
src/server.test.ts            # + opt-in schedule tests AND a production-wiring test (no existing assertion edited)
.env.example                  # comment: EBAY_FEE_RATE live until FOUNDER_VERIFIED, then no-schedule fallback
```

**Structure Decision**: a new `src/lib/fees/` directory rather than adding to `verdict.ts`
(fusing steps is a violation) or to `valuation.ts` (would cache fees inside the 24h valuation).

## Phase 0 outputs — see research.md

Key outcomes: rules sourced from the MIT table and shipped `THIRD_PARTY_UNVERIFIED` (R1–R2); leaf →
fee-category mapping cannot be completed without calling eBay's Taxonomy API, so 009 ships ISBN and
default rules plus an empty reviewable map, and the population script is a follow-up (R3, blocker
B1); fee base and rounding pinned (R4–R5); `EBAY_FEE_RATE` remains the live rate until
FOUNDER_VERIFIED and the no-schedule fallback after that (R7, R14); staleness 45 days (R8); seam
shape chosen (R10); production wiring is tested and gated (R13–R14).

## Phase 1 outputs — see data-model.md, contracts/, quickstart.md

## Design decisions (binding on tasks)

- **D1** Schedule is a TypeScript data module; no JSON read, no fetch at runtime.
- **D2** Rates are integer basis points; `share = floor((c × bps + 5000) / 10000)` per bracket.
- **D3** Category resolution order: ISBN (Bookland 978/979 GTIN) → category map → default (assumed).
- **D4** Seam: `ValuationInput.computeFees?: (priceCents) => number`; `feeRate` retained for legacy.
- **D5** `PipelineDeps.config.fees?` optional; absent ⇒ legacy math, no `feeBreakdown` (test-only path).
- **D6** Response: additive `feeBreakdown`; `feesCents === feeBreakdown.totalCents` asserted at runtime
  in `lookup()` (throws an internal error if violated — a bug, not a user condition).
- **D7** No schedule for `EBAY_MARKETPLACE_ID` ⇒ legacy flat fallback, flagged `LEGACY_FLAT_RATE_NO_SCHEDULE`, warned once.
- **D8** Staleness = 45 days from `verifiedAt`, injectable clock, flagged not refused.
- **D9** Fee for price 0 is 0.
- **D10** The shipped schedule status is `THIRD_PARTY_UNVERIFIED` and every production response says so until the founder flips it.
- **D11** `createFeeService` applies the schedule iff `opts.applySchedule ?? (selected.provenance.verification.status === 'FOUNDER_VERIFIED')`. Production (`withFeeService` / `buildProductionDeps`) never passes the override, so the shipped unverified table cannot change live verdicts. Tests that exercise schedule math pass `applySchedule: true`. When a US schedule exists but is not applied: `categoryResolution: 'LEGACY_FLAT'`, `categoryKey: 'legacy_flat'`, `perOrderFeeCents: 0`, `totalCents = Math.round(price × legacyFlatRate)`, assumptions `[SCHEDULE_NOT_FOUNDER_VERIFIED]`, and `schedule` still carries the real US provenance (`marketplace: 'ebay'`, `region: 'US'`, `verifiedAt`, `verificationStatus: 'THIRD_PARTY_UNVERIFIED'`). This is distinct from D7 (no schedule at all).

## Risks

| Risk | Mitigation |
|---|---|
| Rates in the third-party table are wrong or out of date | FR-014 + FR-017: unverified rates never drive live cents; snapshot kept; only the founder can mark verified |
| Most books/DVDs/CDs found by UPC priced at 13.6% not 15.3% (once applied) | `FEE_CATEGORY_ASSUMED` shown; map population follow-up (B1); ISBN rule covers the main book path |
| Existing tests don't exercise the schedule (they keep the legacy path) | Opt-in tests (T015, T017) with `applySchedule: true`; production-wiring test (T017 cases 5–6) uses `withFeeService` without the override; a moved existing expectation is a stop-and-report |
| Snapshot dollars transcribed as cents | T002 round-trips the snapshot JSON (dollars × 100 → cents, rate × 10000 → bps); the tasks.md table is human-readable, not the test oracle |
| Contract drift between API and future Expo client | `feeBreakdown` fully specified in `contracts/lookup-api.delta.yaml`; fields additive only |
| Someone reads this spec as approval to show Browse-derived values publicly | Spec "does not do" section; Principle I (proposed); R11 |
