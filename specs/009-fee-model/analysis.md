# Specification Analysis Report — 009-fee-model

**Date**: 2026-11-07. Spec Kit `/speckit-analyze` skill is Claude Code; this pass follows that
skill's structure by hand. Artifacts: `spec.md`, `plan.md`, `tasks.md`, plus research / data-model /
quickstart / contracts. Constitution: v1.1.0 in force on `main`; v2.0.0 **proposed** on this branch
(`65be0ff`). No `.specify/extensions.yml`.

`check-prerequisites.sh --json --require-tasks --include-tasks` →
`FEATURE_DIR=/workspace/specs/009-fee-model`, docs present.

The 2026-11-06 run-log row that marked this phase `done` with evidence `see analysis.md` was
**false** — the file did not exist. This is the first analysis. Findings below were taken against
the recovered draft, then the planning artifacts were edited (user asked to fix flaws in scope, not
to pretend ready). The **Status** column is after those edits.

## Findings

| ID | Category | Severity | Location(s) | Summary | Recommendation | Status |
|----|----------|----------|-------------|---------|----------------|--------|
| C1 | Constitution / honesty | CRITICAL | spec FR-014, plan D10, tasks T018 | Shipped `THIRD_PARTY_UNVERIFIED` rates would have been attached by `buildProductionDeps` and would have changed live `feesCents` / FLIP vs RIP. A response flag is not a gate. Violates proposed IX/X and the founder's "must not silently become production-ready". | FR-017 / D11: apply the schedule iff `FOUNDER_VERIFIED` (tests may pass `applySchedule: true`). | **Fixed** in spec, plan, research R14, data-model, tasks T010–T018, T021 |
| H1 | Coverage | HIGH | plan R13, tasks T017–T018 | Existing tests omit `fees`; production always attached it. A green suite would not have proved the live path. | T017 cases 5–6 + exported `withFeeService`; `buildProductionDeps` must use it. | **Fixed** |
| H2 | Inconsistency | HIGH | spec SC-001 vs quickstart §1 vs T005 | SC-001 required every snapshot category at 0/1/999/1000/1001/mid/boundaries. The table had 17 rows across 6 keys. | Narrowed SC-001; added rows 18–26 (one 2000-cent point per remaining key). | **Fixed** |
| H3 | Coverage | HIGH | tasks T002 | Expected brackets were to be typed by hand from `tasks.md`, which is itself a transcription of the snapshot. A bad dollar→cents conversion would have been copied into both code and test. Snapshot amounts are dollars (`upTo: 7500`). | T002 round-trips `ebay-us-fee-source.snapshot.json` (`upTo * 100`, `rate * 10000`). | **Fixed** |
| H4 | Inconsistency | HIGH | spec FR-008 vs plan D4 vs data-model | FR-008 said the injected function returns a breakdown; D4/code seam returns total cents. | FR-008 rewritten to match D4; lookup owns the breakdown. | **Fixed** |
| H5 | Ambiguity | HIGH | spec US1 acceptance 1 | Documented `round(2000 × 0.153)` (float) as the expected fee. The code rule is integer half-up. They match here; they would not be the source of truth. | Acceptance scenarios now cite `floor((c × bps + 5000) / 10000)`. | **Fixed** |
| M1 | Inconsistency | MEDIUM | tasks Work Packages WP2 | WP2 `Owns` still listed `schedule.ebay-us.test.ts` after T007 (the un-todo) was removed. | Dropped from WP2 owns. | **Fixed** |
| M2 | Underspecification | MEDIUM | research R3, deferred D-1 | Empty category map: UPC books/movies/CDs undercharged by 1.7 points once the schedule applies. ISBN path is fine. | Left as blocker B1 — needs founder decision + Taxonomy API, out of 009 build. | **Open** |
| M3 | Process | MEDIUM | run-log.md (2026-11-06 draft) | Analyze marked `done` pointing at a file that did not exist; times 22:05–23:05 were not evidenced (only `65be0ff` at 22:00:16 UTC is). | Run-log rewritten from git/workspace evidence; no invented clock times. | **Fixed** |
| M4 | Coverage | MEDIUM | spec US2 vs D11 | US2 assumed every lookup exposes a schedule-applied breakdown. Production-unverified uses `LEGACY_FLAT` + `SCHEDULE_NOT_FOUNDER_VERIFIED`. | US2 scenario 5 added; scenarios 2–4 marked "schedule applied". | **Fixed** |
| L1 | Terminology | LOW | plan/tasks vs server.ts | Tasks said `createDeps`-style; the function is `buildProductionDeps`. | T018 names `buildProductionDeps`. | **Fixed** |
| L2 | Scope | LOW | web/src/lib/api.ts | Client casts JSON to `VerdictResult` and ignores extra keys (confirmed 2026-11-07). `feeBreakdown` will not display until a UI spec. | T019 re-confirms at implement time; D-3 unchanged. | **Noted** |

No CRITICAL findings remain in the artifacts. Open items are founder gates, not missing spec work.

## Coverage Summary

| Requirement Key | Has Task? | Task IDs | Notes |
|-----------------|-----------|----------|-------|
| FR-001 integer schedule fee | yes | T005–T007, T011 | |
| FR-002 per-bracket half-up | yes | T005–T006 | |
| FR-003 modes / waiver / min | yes | T003, T005–T006 | athletic shoes rows 14–15 |
| FR-004 per-order 30/40 | yes | T003, T005, T010 | |
| FR-005 fee base + defaults | yes | T005 (c), T010 (3) | |
| FR-006 resolution order | yes | T008–T009, T015 | |
| FR-007 empty valid map | yes | T009, T015 (4) | population is D-1, not 009 |
| FR-008 verdict seam | yes | T013–T014, T016 | architecture guard in T013 (6) |
| FR-009 additive feeBreakdown | yes | T016–T017, contract | |
| FR-010 zero price → 0 fee | yes | T005 row 1, T010 (4), T015 (6) | |
| FR-011 assumption codes | yes | T010, T017, contract enum | SC-005 |
| FR-012 provenance + stale | yes | T002, T010 (5), T011 | |
| FR-013 no-schedule fallback | yes | T010 (6) | `EBAY_GB` |
| FR-014 THIRD_PARTY_UNVERIFIED | yes | T002 (4), T010 (10), T017 (5) | founder flip is D-2 |
| FR-015 no new I/O / deps | yes | plan R12; T016 "no new await" | |
| FR-016 other verdict math | yes | T013 (2), T017 (4)(5), SC-003 | |
| FR-017 unverified not applied | yes | T010 (10), T017 (5)(6), T018 | D11 |
| SC-001 table + remaining keys | yes | T005 (26 rows) | |
| SC-002 flip→rip demo | yes | T013, T015 (1) | opt-in `applySchedule` |
| SC-003 existing tests untouched | yes | T013, T017, T020 | |
| SC-004 no new await | yes | T016 | not a load test |
| SC-005 assumption codes tested | yes | T010 | |

**Unmapped tasks:** T004, T007, T012, T020 are verify commands; T019 web tolerance; T021–T023 docs. All mapped to US3 / FR-015 / SC-003.

## Constitution Alignment Issues

None remaining in this spec. Principle I (proposed): 009 adds no eBay call and does not fetch
ebay.com. It does not make Browse-derived valuation any more permissible (R11). Principle VII:
verdict does not import `src/lib/fees/`. Principle IX (proposed): snapshot is the rate oracle;
unverified rates are not applied. v1.1.0 still in force on `main` until Eric approves v2.0.0.

## Metrics

- Requirements: 17 FR + 5 SC (buildable)
- Tasks: 23 (T001–T023)
- Coverage: 17/17 FR, 5/5 SC have ≥1 task
- Ambiguity remaining: working defaults still need founder confirmation (not unmarked NEEDS CLARIFICATION)
- Duplication: 0
- Critical remaining: 0 in artifacts; 2 founder gates (constitution approval, FR-014 verify)

## Arithmetic and provenance (independent re-check, 2026-11-07)

- Snapshot v1.1.1, publisher verifiedAt 2026-11-01, 15 category keys match `tasks.md`.
- All snapshot rates are exact multiples of 0.0005 (lossless ×10000 bps).
- Dollar→cents: `upTo` 7500 → 750000; per-order 0.30/0.40 → 30/40; athletic min 150 → 15000.
- `share(c,bps)=floor((c×bps+5000)/10000)` reproduces source "At a glance": $50 → 720 cents, $200 → 2760 cents.
- SC-002: `round(2188×0.8)=1750`; legacy fee 232, profit 1018 FLIP; books fee 308, profit 942 RIP.
- T017 ISBN median 3900: books 637 / profit 2763; most-categories 570; legacy 517 / profit 2883.
- Stale window: 2026-11-01 + 45 days = 2026-12-16 (not stale); +46 = 2026-12-17 (stale).

## Next actions

- **Do not `/speckit-implement`.** Checkpoint 1 is the stop.
- Eric reviews `CHECKPOINT-1.md` (constitution v2.0.0 + spec 009).
- If he approves both, implementation can start from `tasks.md` as written.
- If he wants unverified rates applied immediately, that is an explicit override of FR-017 — do not infer it.
- Category map (B1) stays deferred.

No extension hooks.
