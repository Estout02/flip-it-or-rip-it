# Research: eBay Fee Model (spec 009)

Written 2026-11-06. No eBay API was called, no eBay page was fetched, no paid service or model was
used. One third-party open-data file was read.

## R1 — Where the fee rules come from

**Decision**: Transcribe the eBay US entry of the Underpriced open fee table (MIT, table v1.1.1,
`updatedAt` 2026-11-01, eBay entry `verifiedAt` 2026-11-01) into a typed data module. Keep the
verbatim entry in `contracts/ebay-us-fee-source.snapshot.json` as the audit trail.

**Why**: It is structured, dated, cites eBay's own page per rule, states its rounding rule, and is
MIT licensed for commercial use. The roadmap (`docs/REVIEW-AND-PLAN.md` §1.3) already named it.

**Rejected**: (a) remembering rates from memory — invention, forbidden by Principle IX; (b) fetching
ebay.com's fee page — the repo rule is not to fetch eBay pages, and the founder can read it himself
in a minute; (c) a runtime fetch of the JSON — adds I/O and a dependency on a third party's uptime
to the lookup path.

**Consequence**: the schedule ships `THIRD_PARTY_UNVERIFIED`. The MIT notice and source URL travel
with the data (file header + `schedule.sources`). Shipping it is not the same as applying it —
see R14.

## R2 — Verification gate (founder action)

eBay's page to compare against: `https://www.ebay.com/help/selling/fees-credits-invoices/selling-fees?id=4822`
(the URL the source cites). The founder checks: most-categories 13.6%, Books/Movies/Music 15.3%,
per-order $0.30 at ≤ $10 / $0.40 above, the $7,500 breakpoint and 2.35% above it, and the
categories he actually sells. Then he flips `verification.status` to `FOUNDER_VERIFIED` and records
the date. Until then every production response carries `SCHEDULE_NOT_FOUNDER_VERIFIED` **and
`feesCents` stays on the legacy flat rate** (R14). The flag is not a licence to use the numbers.

## R3 — Mapping eBay leaf categories to fee categories (the open design problem)

The valuation step yields `match.categoryId` / `categoryName` for the *leaf* category (e.g. "Video
Game Accessories"). The fee schedule keys on a *top-level* grouping (Books & Magazines, Movies & TV,
Music, Coins, Trading cards, Comics, Watches, ...). Leaf → grouping needs eBay's category tree.

| Option | Verdict |
|---|---|
| Hard-code root IDs from memory | **Rejected.** Same sin as inventing a rate; wrong IDs silently misprice. |
| Match on leaf *names* | **Rejected.** "Fiction & Literature" does not say it is a book to a regex that also sees "Fiction Writing Software". |
| ISBN identifier ⇒ Books | **Adopted (rule 1).** Deterministic, needs no eBay call: a 978/979 (Bookland) GTIN is a book. ISBN-10 is already converted to 978 by `identify`. |
| Category map data file keyed by eBay category ID | **Adopted (rule 2)**, shipped **empty or partial** in 009. Valid by FR-007. |
| Populate the map from eBay's official **Taxonomy API** (`getCategorySubtree` per fee root) via a one-off, opt-in script, human-reviewed before commit | **Recommended follow-up, not built in 009.** Official API, app token, free, classification not price data. Needs credentials and a call against the real category tree; the sandbox tree may not match production IDs. Founder decides when/where it runs. |
| Fetch the Taxonomy tree at runtime and cache it | **Rejected for now.** New eBay calls on the hot-ish path and quota use for a table that changes rarely; revisit if the map goes stale. |

**Effect on users**: Until the map is populated, books found by ISBN get 15.3%; everything else gets
13.6% with `FEE_CATEGORY_ASSUMED`. DVDs and CDs found by UPC are under-charged by 1.7 points until
mapped — visible to the user through the assumption, not hidden. This is the honest limit of 009.

**Blocker B1**: populating the map (founder decision to run the Taxonomy script; which environment).

## R4 — The fee base

eBay charges the final value fee on the *order total*: item price + buyer-paid shipping + sales tax
(the source's `bases.order`). Today's code applies the rate to the item price only. For a seller
offering free shipping (the app's existing model: shipping is a seller cost) the buyer-paid shipping
is 0. Sales tax depends on the buyer's state and is unknown at scan time.

**Decision**: `calculateEbayFees(schedule, { itemPriceCents, buyerShippingCents = 0, salesTaxCents = 0, categoryKey })`.
Defaults reported as `SELLER_PAYS_SHIPPING` and `SALES_TAX_EXCLUDED`. Sales log (011) passes real
values. This understates fees slightly for taxed orders and says so.

## R5 — Rounding, in integers

Source rule: each percentage fee in cents, rounded to nearest cent (half a cent rounds up),
**separately per bracket**; fixed fees added after rounding.

`roundedShare(sliceCents, rateBps) = floor((sliceCents * rateBps + 5000) / 10000)`

Rates are integer basis points (13.6% → 1360, 15.3% → 1530, 2.35% → 235, 13.25% → 1325). Every rate
in the snapshot is an exact multiple of 5 bps, so conversion is lossless. Safe-integer guard:
`sliceCents * rateBps < 2^53` ⇒ reject prices above 9e11 cents (≈ $9B).

Worked check against the source's own examples: $50.00, most categories: `floor((5000*1360+5000)/10000)`
= 680 → $6.80 + $0.40 = **$7.20**; $200.00: 2720 + 40 = **$27.60**. Both match the source page's
"At a glance" table. (Hand arithmetic recorded in `quickstart.md`; the unit test re-derives these.)

## R6 — Bracket modes

From the snapshot: `marginal` (each slice at its bracket rate: most categories, books, movies,
music, coins, cards, comics, watches, guitars, heavy equipment) and `whole` (the whole order at the
rate its size selects: bullion, handbags, jewelry, athletic shoes, NFT). `upTo` bounds are inclusive
("when it's $7,500 or less"). Athletic shoes: below `minimumOrderTotal` $150 use `most_categories`
and the per-order fee; at/above, 8% whole and the per-order fee is waived (`waivesPerOrderFee`).

## R7 — What happens to `EBAY_FEE_RATE`

It stays. Two jobs:

1. **Live rate until FOUNDER_VERIFIED** (R14), including on `EBAY_US`.
2. **No-schedule fallback** after that (e.g. `EBAY_GB`). Tests use `EBAY_GB` and there is no UK
   schedule; none should be invented.

Removing the setting would force either a crash or a made-up number. Each use is flagged
(`SCHEDULE_NOT_FOUNDER_VERIFIED` vs `LEGACY_FLAT_RATE_NO_SCHEDULE`) and warned once at startup.

## R8 — Staleness

`reviewIntervalDays = 45` (source re-checks about monthly; one missed cycle plus slack). Computed
against an injectable clock, per response — cheap, no timers. Startup `console.warn` once if stale.
A stale schedule still computes (the numbers are the best we have); it is flagged, not refused,
because refusing would take lookups down over a date.

## R9 — Gaps in the source we must carry, not paper over

- The per-order fee for NFTs, bullion and heavy equipment is not separately described; the source
  applies it to every category except the waiver. We do the same and mark these categories
  "not expected to be reachable".
- Store subscriptions, below-standard surcharges, Promoted Listings, international and currency
  fees are out of the table's scope; stated in `schedule.scope` and as `STANDARD_SELLER_NO_STORE`
  / `NO_PROMOTED_LISTING_FEES`.
- A user with an eBay Store pays different rates. Out of scope; no user-level setting in 009.

## R10 — Seam design (constitution VII)

The verdict step must not import fee internals. Chosen: `ValuationInput.computeFees?:
(priceCents: number) => number` (total cents). `lookup()` builds a closure that already knows the
category resolution, hands it to `computeVerdict`, then calls the same pure closure's detailed twin
on `verdict.estimatedValueCents` to build `feeBreakdown`, asserting equality with `verdict.feesCents`.
`feeRate` stays on the interface for the 36 existing call sites and as the fallback.

**Rejected**: putting fee logic in the verdict file (fuses steps); moving fees into the shipping step
(wrong responsibility, and fees depend on the value that the verdict computes); computing fees inside
`valuation` (would bake fees into the cached valuation and defeat immediate schedule updates).

## R11 — Interaction with the eBay price-modelling restriction

Fee computation needs a price; it does not care where it came from, and it adds no eBay call or
data. It therefore neither relies on nor argues for the permissibility of Browse-derived valuation.
That question stays with spec 010 and the founder's consent request. This spec's plan, tests and
docs must not state or imply that consent exists.

## R12 — Cost and quota

External calls added: **0**. New dependencies: **0**. New paid services: **0**. Hot-path work: one
pure function call with a few integer operations, run once in `computeVerdict` and once for the
breakdown. No new `await`.

## R13 — Existing tests vs production wiring

No existing test should move. `PipelineDeps.config.fees` and `AppConfig.fees` are optional;
`testConfig` / `makeDeps` omit `fees` and keep literals such as `feesCents 517`.

The predecessor plan had `buildProductionDeps` always attach a schedule-backed FeeService. That
would have changed every live US lookup the moment 009 shipped, while every existing test still
ran the optional-legacy path — so a green suite would not have proved production. That is the
gap this revision closes:

- Export `withFeeService(config): AppConfig` (new object, no mutation of `testConfig`).
- `buildProductionDeps` uses it and does **not** pass `applySchedule`.
- T017 cases 5–6 call `makeApp({ config: withFeeService(testConfig) })` and assert the unverified
  production behaviour (ISBN `feesCents` still 517, `SCHEDULE_NOT_FOUNDER_VERIFIED`) and the
  verified behaviour (a FOUNDER_VERIFIED clone → 637).
- T015 / T017 cases 1–3 pass `applySchedule: true` to exercise schedule math without pretending
  that is production.

If any existing expectation moves, stop and report it.

## R14 — Unverified rates are not production-ready

`createFeeService` applies the schedule iff
`opts.applySchedule ?? (selected?.provenance.verification.status === 'FOUNDER_VERIFIED')`.
The shipped file is `THIRD_PARTY_UNVERIFIED`, so production never applies it until the founder
edits that field after checking eBay's own page. A status flag on a response that already used
the unverified cents would still have decided FLIP vs RIP — that is what FR-017 forbids.

When a US schedule exists but is not applied, `feeBreakdown` still names it (provenance, dates,
`verificationStatus`) and uses `LEGACY_FLAT` / `SCHEDULE_NOT_FOUNDER_VERIFIED` for the amount.
That is not `LEGACY_FLAT_RATE_NO_SCHEDULE` (D7, no schedule at all).
