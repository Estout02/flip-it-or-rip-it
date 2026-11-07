# Feature Specification: eBay Fee Model

**Feature Branch**: `cursor/constitution-v2-fee-model-spec-c607` (spec dir `009-fee-model`; Spec Kit did not create a git branch)

**Created**: 2026-11-06

**Status**: Draft — planning complete through analyze; awaiting founder review at Checkpoint 1. Do not implement.

**Input**: User description: "Fix the fee model. Replace the single flat 13.25% rate with eBay's category-aware final value fee plus the per-order fee, computed deterministically from dated, source-backed rules, with every assumption stated. This is spec 009 of the phone-app roadmap (`docs/REVIEW-AND-PLAN.md` on branch `plan/phone-app`, debt item D2). It must not decide, assume, or widen anything about where prices come from."

**Governing constitution**: v2.0.0 is **proposed** (commit `65be0ff` on this branch). This spec is written to pass both v1.1.0 (in force) and v2.0.0 (proposed); where they differ the plan says so.

## Background

Today the verdict step charges `round(estimatedValue × EBAY_FEE_RATE)` with `EBAY_FEE_RATE` defaulting
to `0.1325` (`src/lib/verdict.ts` `DEFAULT_FEE_RATE`; `src/server.ts` `numericSetting`). Three things
are wrong with that, and all three bias the verdict toward FLIP:

1. **The rate is wrong for the core category.** A third-party open fee table, verified 2026-11-01,
   lists eBay's final value fee at **15.3%** for Books & Magazines, Movies & TV and Music (non-vinyl),
   and **13.6%** for most other categories. 13.25% matches only coins, trading cards and comics.
2. **There is no per-order fee.** The same table lists $0.30 per order when the order total is
   $10.00 or less and $0.40 above that. On a $12 sale that is more than 3% of the price.
3. **The fee base is unstated.** eBay charges the percentage on the *order total* — item price plus
   buyer-paid shipping plus sales tax — not on the item price. The current code silently assumes the
   item price alone.

The flat $5.00 shipping estimate (debt D6) and the 0.8 realization rate (spec 003) are **not**
changed here.

### What this spec deliberately does not do

`docs/REVIEW-AND-PLAN.md` §3 reports that eBay's API License Agreement forbids using eBay Content to
"suggest or model prices" without written consent, and that consent has **not** been obtained. That
is a data-source question and belongs to spec 010. This spec's fee computation takes a price as an
input and returns cents; it does not fetch, store, or derive any eBay Content, adds no eBay call,
and does not make the current Browse-derived valuation any more or less permissible. It also makes
no claim that consent exists. The existing pipeline keeps using whatever price source it uses today,
unchanged, and stays limited to the founder's personal use under the proposed Principle I.

### Where the rules come from

The schedule in this spec is transcribed from the Underpriced open fee table (MIT licence; table
version 1.1.1; eBay entry verified by its publisher 2026-11-01; we read it 2026-11-06). That table
cites eBay's own page (`https://www.ebay.com/help/selling/fees-credits-invoices/selling-fees?id=4822`).
**We did not fetch ebay.com** (repo rule: no fetching eBay pages). The rates are therefore
*third-party-sourced and unverified against eBay's own page*; FR-014 makes the founder's check a
gate before the schedule is marked verified. The eBay entry is preserved verbatim in
`contracts/ebay-us-fee-source.snapshot.json`.

## Clarifications

### Session 2026-11-06 (working defaults, pending founder confirmation)

The spec author cannot ask the founder; each default below is encoded in the requirements and is
also listed as a question at Checkpoint 1.

- Q: When the item's fee category can't be determined, which rate applies? → A: "Most categories" (13.6%), returned with a `DEFAULT_ASSUMED` resolution so the UI can say "fee category assumed". Rejected: guessing the highest rate (false RIPs on ordinary goods).
- Q: What is the buyer-paid shipping and sales tax in the fee base? → A: Both zero by default (seller offers free shipping; buyer's state unknown), returned as named assumptions. Both are function parameters so spec 011's sales log can pass real figures later. No new request fields in 009.
- Q: What happens when `EBAY_MARKETPLACE_ID` is not `EBAY_US`? → A: There is no schedule, so the existing flat `EBAY_FEE_RATE` is used as a clearly flagged fallback. The number is never silently presented as a schedule.
- Q: How old can a schedule be before it is flagged? → A: 45 days from `verifiedAt` (the source re-checks about monthly).
- Q: Does `EBAY_FEE_RATE` go away? → A: No. It is the rate used when there is no schedule for the marketplace, **and** the rate that still drives `feesCents` / the verdict on `EBAY_US` until the founder marks the schedule `FOUNDER_VERIFIED`.
- Q: Until the founder verifies the third-party table against eBay's own page, does the new schedule change live verdicts? → A: **No.** The schedule is loaded, dated, and returned in `feeBreakdown` so the unverified status is visible, but it MUST NOT drive `feesCents` or the verdict. Tests may apply it only with an explicit `applySchedule: true`. This is FR-017. Rejected: shipping unverified rates into production lookups with only a flag (the numbers would still decide FLIP vs RIP).

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Fees that match what eBay would charge (Priority: P1) 🎯 MVP

A reseller scans a paperback. **Once the founder has verified the schedule** (FR-014 / FR-017), the
verdict for the book reflects the 15.3% books rate plus the per-order fee, so a book that looked
like a $10.18 profit at a flat 13.25% no longer clears the $10 threshold when it really nets $9.42.
Until that verification, live lookups keep the legacy flat rate and say so.

**Why this priority**: Every verdict depends on the fee. A fee that is too low produces false FLIPs,
which is the failure the product exists to prevent. It is also the smallest slice that changes a
user-visible number. Verification is a gate on *applying* the math, not on *building* it.

**Independent Test**: With a fake eBay client (no network) and `applySchedule: true`, look up an
ISBN whose median sells for a known amount; assert `feesCents` equals the hand-computed schedule
fee and that the verdict flips across the threshold exactly where the arithmetic says it should.
A second case with production wiring (`withFeeService`, no override) keeps the legacy cents.

**Acceptance Scenarios**:

1. **Given** an ISBN lookup whose estimated sale value is 2,000 cents and the schedule is being
   applied (`applySchedule: true` or `FOUNDER_VERIFIED`), **When** the verdict is computed, **Then**
   `feesCents` is `floor((2000 × 1530 + 5000) / 10000) + 40 = 306 + 40 = 346`, not the legacy 265.
2. **Given** an estimated sale value of 800 cents in the default category (schedule applied),
   **When** the verdict is computed, **Then** the fee is
   `floor((800 × 1360 + 5000) / 10000) + 30 = 109 + 30 = 139` (order total ≤ $10.00 so the
   per-order fee is 30 cents).
3. **Given** an estimated sale value of exactly 1,000 cents (schedule applied), **Then** the
   per-order fee is 30 cents; **given** 1,001 cents, **Then** it is 40 cents.
4. **Given** a title lookup whose matched leaf category is in the category map (schedule applied),
   **Then** that category's rate applies; **given** a leaf category that is not in the map, **Then**
   the default category applies and the response says the category was assumed.
5. **Given** an estimated value of 0 (no market data), **Then** the fee is 0, because no order exists.

---

### User Story 2 - The response explains the fee (Priority: P2)

A front end (web today, the Expo app later) wants to show "eBay fees $3.46" and, on tap, why: which
category rate was used, whether that was known or assumed, that shipping is assumed seller-paid, and
when the rules were last checked.

**Why this priority**: Constitution IX and X require assumptions to be surfaced, not silent. It also
unblocks the mobile verdict sheet without another API change.

**Independent Test**: Assert the lookup response carries a `feeBreakdown` object whose parts sum to
`feesCents` and whose assumptions list matches the inputs used.

**Acceptance Scenarios**:

1. **Given** any lookup with a valuation, **Then** `feesCents` equals
   `feeBreakdown.finalValueFeeCents + feeBreakdown.perOrderFeeCents`.
2. **Given** the default-category fallback (schedule applied), **Then** `feeBreakdown.categoryResolution`
   is `DEFAULT_ASSUMED` and `feeBreakdown.assumptions` includes `FEE_CATEGORY_ASSUMED`.
3. **Given** a US lookup with the schedule applied, **Then** `assumptions` includes
   `SELLER_PAYS_SHIPPING` and `SALES_TAX_EXCLUDED`.
4. **Given** an ISBN lookup with the schedule applied, **Then** `categoryResolution` is
   `ISBN_IDENTIFIER` and the category is Books & Magazines.
5. **Given** production wiring and the shipped `THIRD_PARTY_UNVERIFIED` schedule, **Then**
   `feesCents` equals the legacy flat rate, `categoryResolution` is `LEGACY_FLAT`, and assumptions
   include `SCHEDULE_NOT_FOUNDER_VERIFIED` (not `LEGACY_FLAT_RATE_NO_SCHEDULE` — a schedule exists).

---

### User Story 3 - Rules are dated, checkable, and flagged when stale (Priority: P3)

The founder or a future maintainer opens one data file, sees every rate with its source and
verification date, and updates it without touching the fee logic. If nobody has re-checked the
schedule for too long, the response and the server log say so.

**Why this priority**: Fees change. Constitution IX requires that unreviewed rules are flagged rather
than trusted forever. Without this the fix rots the way the 13.25% default did.

**Independent Test**: With an injected clock 46 days past `verifiedAt`, the response reports
`schedule.stale: true`; at 45 days it reports `false`.

**Acceptance Scenarios**:

1. **Given** a clock 46 days after `verifiedAt`, **Then** `feeBreakdown.schedule.stale` is `true`.
2. **Given** a marketplace id with no schedule, **Then** the flat `EBAY_FEE_RATE` applies, the
   response carries `LEGACY_FLAT_RATE_NO_SCHEDULE`, and startup logs one `console.warn`.
3. **Given** a schedule file whose category lacks a source URL or verification date, **Then** the
   schedule's validation test fails (a rule without a source is a placeholder).

---

### Edge Cases

- **Whole-bracket categories** (bullion, handbags, jewelry) charge the *whole* order at the rate its
  size selects, so the fee can fall as the price crosses the boundary. No monotonicity is asserted
  for them; boundary inclusivity is (e.g. jewelry at exactly 500,000 cents uses 15%).
- **Athletic shoes**: below the 15,000-cent minimum the most-categories rate and per-order fee apply;
  at or above it, 8% and **no** per-order fee.
- **Marginal brackets** (most categories, books, watches...): each slice is rounded half-up
  separately, then summed; the fixed per-order fee is added after.
- **Non-integer or negative cents** passed to the fee function is a programming error and throws.
- **Very large prices** stay inside safe-integer arithmetic (cents × basis points < 2^53 for any
  price under about $9 billion); the function guards that bound.
- **Cached valuations** do not cache fees: fees are computed after the cache read, so a schedule
  change takes effect immediately.
- **NFT / bullion / heavy-equipment categories** are in the schedule for completeness but are not
  expected to be reachable from the category map in this spec.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: The system MUST compute the eBay fee as `finalValueFee + perOrderFee` from a typed,
  versioned US fee schedule, in integer cents, with no floating-point arithmetic on money
  (rates are held as integer basis points).
- **FR-002**: The percentage fee MUST be computed per bracket, each bracket's slice × rate rounded
  half-up to the cent, summed; fixed fees are added after rounding (the schedule's stated rule).
- **FR-003**: The schedule MUST support marginal brackets and whole-order brackets, inclusive upper
  bounds, a category minimum order total with a below-minimum fallback category, and a per-order-fee
  waiver — as needed to represent every category in the source snapshot.
- **FR-004**: The per-order fee MUST be 30 cents when the order total is 1,000 cents or less and
  40 cents above that, unless the category waives it.
- **FR-005**: The fee base (order total) MUST be `itemPriceCents + buyerShippingCents + salesTaxCents`
  with the last two defaulting to 0 and reported as assumptions when defaulted.
- **FR-006**: A fee category MUST be resolved by this order: (1) an ISBN identifier → Books &
  Magazines; (2) the matched leaf category ID found in the category map; (3) otherwise the default
  category. The resolution method MUST be returned.
- **FR-007**: The category map MUST be a reviewable data file keyed by eBay category ID, and the plan
  MUST state how its IDs are sourced (research R3). IDs are never invented; an empty or partial map
  is valid and degrades to FR-006 (3).
- **FR-008**: The verdict step MUST receive the fee as an explicit typed input: an injected pure
  function `(priceCents) => totalFeeCents`. The lookup step, not the verdict step, asks the same
  fee service for the matching `feeBreakdown`. The verdict step MUST NOT import the schedule,
  resolver, or category map (constitution VII).
- **FR-009**: `feesCents` on the lookup response MUST keep its meaning (total fees) and equal the
  breakdown's sum. The response MUST gain an additive `feeBreakdown` (see
  `contracts/lookup-api.delta.yaml`). No existing field is removed or renamed. Request bodies are
  unchanged.
- **FR-010**: Fees MUST be 0 when the price is 0 (no order exists).
- **FR-011**: The system MUST return the assumptions used as stable codes, and MUST NOT apply any
  assumption silently.
- **FR-012**: The schedule MUST record, per marketplace and region: source URL(s), `verifiedAt`,
  `reviewIntervalDays` (45), publisher of the data and its licence. The response MUST report
  `schedule.stale` using an injectable clock, and startup MUST warn once if stale.
- **FR-013**: When no schedule exists for the configured marketplace, the system MUST fall back to
  the flat `EBAY_FEE_RATE`, flag it with `LEGACY_FLAT_RATE_NO_SCHEDULE`, and warn once at startup.
- **FR-014**: The schedule MUST ship with `verification.status: "THIRD_PARTY_UNVERIFIED"` until the
  founder compares it against eBay's own selling-fees page and records the date and initials; only
  then may it read `"FOUNDER_VERIFIED"`. The response MUST expose that status.
- **FR-015**: The feature MUST add no eBay API call, no new runtime dependency, no new request field,
  and no new paid service. The fee path adds no I/O to the lookup hot path (constitution II).
- **FR-016**: Every other behavior of the verdict (realization rate, liquidity gate, match
  confidence, thresholds) MUST be unchanged; only `feesCents` and the values derived from it move,
  and only when FR-017 allows the schedule to be applied.
- **FR-017**: Until `verification.status` is `FOUNDER_VERIFIED`, production wiring MUST NOT apply
  the third-party schedule to `feesCents` or the verdict. An unverified US schedule is still loaded
  so `feeBreakdown` can report `SCHEDULE_NOT_FOUNDER_VERIFIED` and the schedule's provenance; the
  amount charged is the legacy flat `EBAY_FEE_RATE` (no per-order fee). Tests MAY apply the
  schedule only by passing `applySchedule: true`. The flag alone is not enough: unverified rates
  must not silently become production-ready.

### Key Entities

- **Fee schedule**: per marketplace/region data — categories, brackets, per-order fee, rounding rule,
  provenance (sources, `verifiedAt`, review interval, licence), verification status.
- **Fee category**: one entry in the schedule (e.g. `books_magazines`) with a mode (marginal or
  whole), brackets, and flags.
- **Category map**: eBay category ID → fee category key; reviewable data, may be partial.
- **Fee breakdown**: the result — final value fee, per-order fee, total, category key and label,
  resolution method, order total used, assumption codes, schedule provenance and staleness.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: Rows 1–17 of `quickstart.md` §1 cover every distinct algorithm shape (marginal
  slice, whole-bracket drop, athletic-shoes minimum, per-order boundary, zero). In addition, every
  remaining category key in the snapshot has at least one hand-derived mid-price (2,000 cents) so a
  transcription error is caught. No expected value is generated by the code under test.
- **SC-002**: A book whose estimated sale value is 1,750 cents (median 2,188 × 0.8), with the flat
  500-cent shipping and a 1,000-cent threshold, returns FLIP under the old model (fee 232, profit
  1,018) and RIP / `BELOW_THRESHOLD` under the schedule (`applySchedule: true`; fee 268 + 40 = 308,
  profit 942). Demonstrated by a test with these fixed numbers. Production with the shipped
  `THIRD_PARTY_UNVERIFIED` schedule still returns the old FLIP numbers (FR-017).
- **SC-003**: `docker compose run --rm api npm test` and `npm run typecheck` pass, and no existing
  test is edited or weakened; the new behavior is covered by new, opt-in tests.
- **SC-004**: Lookup latency is unchanged within measurement noise: the fee computation is a pure
  in-memory function (a handful of integer operations); no new `await` appears in `lookup`.
- **SC-005**: Every FR-011 assumption code appears in at least one test and in the contract.

## Assumptions

- Standard seller (no eBay Store subscription), meets seller performance standards, US seller to US
  buyer, no Promoted Listings, no international or currency fees, no below-standard surcharge. These
  are exactly the source's scope and are returned in `feeBreakdown.schedule.scope`.
- eBay's published rates are **not** assumed to match the source snapshot. FR-017 keeps the snapshot
  out of live `feesCents` until the founder verifies it against eBay's own page (FR-014).
- Fees on sales tax are charged as eBay does today (tax is part of the order total); we default tax
  to zero because the buyer's state is unknown. This **understates** fees slightly for buyers in
  states with marketplace-facilitator tax, and the response says so.
- Spec 011 (sales log) will reuse the fee function with real order totals.
- Out of scope: other marketplaces' schedules, shipping-cost modelling (D6), the realization rate,
  value bands and the price source (spec 010), any UI change beyond what the existing `feesCents`
  display already does, and any claim that eBay data may be used to model prices.
