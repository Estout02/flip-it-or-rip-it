# Requirements Checklist: eBay Fee Model (spec 009)

First pass 2026-11-06 against an earlier spec draft. Re-checked 2026-11-07 after critical review
(FR-017, D11, SC-001 narrowing, snapshot oracle).

- [x] No `[NEEDS CLARIFICATION]` markers remain; working defaults are recorded under Clarifications and repeated as questions at Checkpoint 1
- [x] Every functional requirement is testable (FR-001…FR-017 each map to a task or acceptance scenario)
- [x] Success criteria are measurable (SC-001…SC-005); SC-001 was narrowed from "every price point on every category" to distinctive shapes + one mid-price per remaining key — the original wording was not what the 17-row table covered
- [x] User stories are prioritised and independently testable (US1 P1 MVP, US2 P2, US3 P3)
- [x] Edge cases enumerated (whole vs marginal brackets, boundaries, athletic shoes, zero price, overflow, cache interaction, unverified-vs-applied)
- [x] Scope and non-goals explicit (no price-source decision, no UI, no new request fields, no eBay call, no other marketplaces)
- [x] Assumptions explicit and returned to the user (FR-005, FR-011); none silent
- [x] Money is integer cents; rates are integer basis points (constitution VI)
- [x] Rules are dated and source-backed; unverified status is a first-class, visible state (constitution IX proposed; FR-012, FR-014)
- [x] Unverified third-party rates do not drive live `feesCents` (FR-017 / D11)
- [x] Does not assume or imply eBay consent to price modelling (spec "does not do"; research R11)
- [x] No invented current rates: every rate traces to `contracts/ebay-us-fee-source.snapshot.json`; T002 round-trips that file
- [x] Hand-derived expected values exist and were independently re-derived 2026-11-07 (quickstart §1, 26 rows)
- [ ] Founder verified the rates against eBay's own page (deliberately open — FR-014 / D-2; this is also the production on-switch)
- [ ] Founder confirmed the working defaults at Checkpoint 1 (category fallback, fee base, non-US fallback, 45-day stale, FR-017 gate)
