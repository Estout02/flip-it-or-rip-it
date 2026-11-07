# Tasks: eBay Fee Model

**Input**: `specs/009-fee-model/` — spec.md, plan.md (decisions D1–D11), research.md, data-model.md, quickstart.md (hand-derived fee table), contracts/lookup-api.delta.yaml

**Status**: PLANNED ONLY. Nothing below is started. Implementation begins only after the founder approves at Checkpoint 1.

**Tests**: INCLUDED, written before the code they cover. Expected values come from the hand-derived table in `quickstart.md` §1 — never computed by the code under test. Everything runs in Docker.

**Safety**: use one-off `docker compose run --rm api …` only. Never `up`/`down`/`build`, never the production overlay, no live eBay call in any task.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: can run in parallel (different files, no dependency on an incomplete task)
- **[Story]**: US1 / US2 / US3 from spec.md

## Pinned constants (defined once, referenced everywhere)

| Name | Value | Where |
|---|---|---|
| `FEE_REVIEW_INTERVAL_DAYS` | `45` | `schedule.ebay-us.ts` → `provenance.reviewIntervalDays` |
| Schedule `verifiedAt` | `'2026-11-01'` | publisher's check date; the founder replaces it when verifying |
| Schedule `verification.status` | `'THIRD_PARTY_UNVERIFIED'` | until the founder flips it (FR-014) |
| Schedule `marketplaceIds` | `['EBAY_US']` | |
| Schedule `scope` | `'US seller to US buyer, standard account (no Store subscription), meets seller performance standards, no Promoted Listings, no international or currency fees'` | returned verbatim |
| Legacy `scope` | `'Flat configured rate; no fee schedule for this marketplace'` | |
| Per-order fee | threshold 1000, low 30, high 40 | |
| `applySchedule` | omitted in production; tests that want schedule math pass `true` | D11 / FR-017 |

Snapshot amounts are **dollars**; the table below is **cents** (`upTo × 100`) and **basis points** (`rate × 10000`). T002 round-trips the snapshot JSON so a bad conversion cannot hide behind this table.

Category table to transcribe into `schedule.ebay-us.ts` (bps = percent × 100; bounds in cents; `mode` M = MARGINAL, W = WHOLE; last bracket bound `null`):

| key | label | mode | brackets (upToCents → bps) | extra |
|---|---|---|---|---|
| most_categories | Most categories | M | 750000→1360, null→235 | default |
| books_magazines | Books & Magazines | M | 750000→1530, null→235 | |
| movies_tv | Movies & TV | M | 750000→1530, null→235 | |
| music_non_vinyl | Music (except vinyl records) | M | 750000→1530, null→235 | |
| coins | Coins & Paper Money | M | 750000→1325, null→235 | |
| trading_cards | Trading cards | M | 750000→1325, null→235 | |
| comics | Comic books | M | 750000→1325, null→235 | |
| watches | Watches | M | 100000→1500, 750000→650, null→300 | |
| guitars_basses | Guitars & Basses | M | 750000→670, null→235 | |
| business_industrial_heavy | Heavy equipment and select Business & Industrial | M | 1500000→300, null→50 | notExpectedReachable |
| bullion | Bullion | W | 750000→1360, null→700 | notExpectedReachable |
| handbags | Handbags | W | 200000→1500, null→900 | |
| jewelry | Jewelry | W | 500000→1500, null→900 | |
| athletic_shoes | Athletic shoes | W | null→800 | minimumOrderTotalCents 15000, belowMinimumKey most_categories, waivesPerOrderFee |
| nft | NFTs | W | null→500 | notExpectedReachable |

(15 categories. Source: `contracts/ebay-us-fee-source.snapshot.json`; rates there are fractions, e.g. 0.136 → 1360 bps.)

---

## Phase 1: Fee schedule data (WP1)

- [ ] T001 [US3] Create `src/lib/fees/types.ts` with exactly the types in `data-model.md` ("Types", "Calculation", "Resolution", "Service" sections): `FeeCategoryKey`, `Bracket`, `FeeCategory`, `PerOrderFeeRule`, `FeeSchedule`, `FeeInput`, `FeeResult`, `FeeCategoryContext`, `CategoryResolution`, `FeeAssumptionCode`, `FeeBreakdown`, `FeeServiceOptions`, `FeeService`. Types only; no runtime code.
- [ ] T002 [P] [US3] Write `src/lib/fees/schedule.ebay-us.test.ts` first. Import `ebayUsSchedule` (pinned export: `export const ebayUsSchedule: FeeSchedule`). This file needs no calculator (WP2's `calculate.test.ts` asserts `validateSchedule(ebayUsSchedule)` is empty). Cases: (1) `ebayUsSchedule.categories.map(c => c.key)` equals the 15 keys of the table above, in that order; (2) **snapshot round-trip** — `readFileSync` the JSON at `new URL('../../../specs/009-fee-model/contracts/ebay-us-fee-source.snapshot.json', import.meta.url)`, and for every `ebay.categories.list` entry assert the matching schedule category: `mode` uppercased (`marginal` → `MARGINAL`), each `brackets[].upTo === null ? null : Math.round(upTo * 100)` equals `upToCents`, `Math.round(rate * 10000)` equals `rateBps`; `athletic_shoes.minimumOrderTotalCents === Math.round(150 * 100)`; `perOrderFee.lowCents === Math.round(0.3 * 100)` and `highCents === Math.round(0.4 * 100)`. Do **not** type the expected brackets by hand from the table above — the snapshot is the oracle (dollars → cents). (3) `perOrderFee` equals `{ thresholdCents: 1000, lowCents: 30, highCents: 40 }`; (4) `provenance.verifiedAt === '2026-11-01'`, `reviewIntervalDays === 45`, `verification.status === 'THIRD_PARTY_UNVERIFIED'`, `license === 'MIT'`, `tableVersion === '1.1.1'`; (5) `marketplaceIds` equals `['EBAY_US']`; (6) at least one source has `kind: 'THIRD_PARTY_OPEN_DATA'` with url `https://www.underpriced.app/data/reseller-fees` and one `kind: 'MARKETPLACE_PAGE'` with url `https://www.ebay.com/help/selling/fees-credits-invoices/selling-fees?id=4822` (cited, not fetched).
- [ ] T003 [US3] Create `src/lib/fees/schedule.ebay-us.ts` exporting `ebayUsSchedule` from the table and pinned constants above. File header comment (keep): source, MIT licence notice and URL, table version, "verified by publisher 2026-11-01; NOT yet verified against eBay's own page — see specs/009-fee-model/quickstart.md §4". No logic, no imports besides the types.
- [ ] T004 [US3] Run `docker compose run --rm api npx vitest run src/lib/fees/schedule.ebay-us.test.ts` and `docker compose run --rm api npm run typecheck`; both pass.

**Checkpoint**: schedule data matches the snapshot exactly.

---

## Phase 2: Calculator (WP2) — depends on WP1

- [ ] T005 [US1] Write `src/lib/fees/calculate.test.ts` first. (a) Table-driven: for each of the 26 rows in `quickstart.md` §1, `calculateEbayFees(ebayUsSchedule, { itemPriceCents, categoryKey })` returns `totalCents` equal to the table's fee, with `finalValueFeeCents + perOrderFeeCents === totalCents`; spot-assert components for rows 3 (109 + 30), 11 (103175 + 40), 15 (1200 + 0), 13 (45000 + 40). Category keys: row→key as listed. (b) Row 14 returns `appliedCategoryKey === 'most_categories'` while the input key is `athletic_shoes`; row 15 returns `athletic_shoes`. (c) Fee base: `{ itemPriceCents: 800, buyerShippingCents: 200, categoryKey: 'most_categories' }` → order total 1000, fee 166 (row 5), `orderTotalCents === 1000`; `{ itemPriceCents: 900, salesTaxCents: 101 }` → order total 1001 → per-order 40, fvf `share(1001,1360)=136` → 176. (d) Errors: non-integer (`10.5`), negative (`-1`), `NaN`, `1e12`, and an unknown `categoryKey` each throw (`RangeError`, `RangeError`, `RangeError`, `RangeError`, `Error` with message containing the key). (e) Property (marginal categories only: `most_categories`, `books_magazines`, `coins`): for prices `[0..3000 step 7]` and `[749990..750010]`, fee is non-decreasing. Do NOT assert monotonic for whole-bracket categories. (f) `validateSchedule(ebayUsSchedule)` returns `[]`. (g) `validateSchedule` negative cases on deep clones of the schedule, each returns a non-empty array containing the quoted substring: rateBps `1360.5` → `'rateBps'`; last bracket bound `750000` instead of null → `'last bracket'`; a source url `''` → `'source'`; `verifiedAt: '2026-13-45'` → `'verifiedAt'`; `reviewIntervalDays: 0` → `'reviewIntervalDays'`; `FOUNDER_VERIFIED` without `verifiedBy` → `'verifiedBy'`; unknown `belowMinimumKey` → `'belowMinimumKey'`; unknown `defaultCategoryKey` → `'defaultCategoryKey'`; unsorted brackets → `'ascending'`.
- [ ] T006 [US1] Create `src/lib/fees/calculate.ts` exporting `calculateEbayFees` and `validateSchedule` exactly per `data-model.md` "Calculation" (algorithm steps 1–5, `share` formula, safe-integer guard rejecting prices above 900,000,000,000 cents, RangeError messages naming the offending field). Pure, no I/O, no clock, no imports except types.
- [ ] T007 [US1] Run `docker compose run --rm api npx vitest run src/lib/fees` and `npm run typecheck`; all pass.

**Checkpoint**: calculator reproduces every hand-derived row and the source's own $7.20 / $27.60 examples.

---

## Phase 3: Category resolution and service (WP3) — depends on WP2

- [ ] T008 [P] [US1] Write `src/lib/fees/category.test.ts` first. With a test map `{ '261186': 'movies_tv', '999': 'not_a_real_key' }` (IDs are test fixtures, not claims about eBay): (1) gtin `'9780345391803'` → `{ key: 'books_magazines', resolution: 'ISBN_IDENTIFIER' }` even if `leafCategoryId` is in the map; (2) gtin `'9790000000001'` (979 prefix) → books; (3) gtin `'0123456789012'` + `leafCategoryId: '261186'` → `{ 'movies_tv', 'CATEGORY_MAP' }`; (4) `leafCategoryId: '999'` (maps to a key absent from the schedule) → default, `DEFAULT_ASSUMED`; (5) `leafCategoryId: 'unknown'` or null or undefined, no gtin → `{ 'most_categories', 'DEFAULT_ASSUMED' }`; (6) gtin with 12 or 14 digits starting `978` → NOT books (13 digits required); (7) empty map → rules 1 and 3 only.
- [ ] T009 [US1] Create `src/lib/fees/category-map.ts`: `export const EBAY_CATEGORY_TO_FEE_CATEGORY: Record<string, FeeCategoryKey> = {};` with a header comment: IDs must come from eBay's official Taxonomy API via a reviewed script (research R3), never from memory; empty is valid. Create `src/lib/fees/category.ts` per `data-model.md` "Resolution".
- [ ] T010 [P] [US2] Write `src/lib/fees/index.test.ts` first, with a fake clock `now = () => Date.parse('2026-11-06T00:00:00Z')` unless stated and `schedules: [ebayUsSchedule]`, `marketplaceId: 'EBAY_US'`, `legacyFlatRate: 0.1325`, `categoryMap: {}`. **Cases 1–5 and 8 pass `applySchedule: true`.** Cases: (1) ISBN ctx, price 2000 → `breakdown.totalCents === 346`, `finalValueFeeCents 306`, `perOrderFeeCents 40`, `orderTotalCents 2000`, `categoryKey 'books_magazines'`, `categoryResolution 'ISBN_IDENTIFIER'`, `totalCents(2000) === 346`; (2) empty ctx, price 800 → 139, `DEFAULT_ASSUMED`, assumptions contain `FEE_CATEGORY_ASSUMED`; (3) every schedule-applied breakdown has assumptions ⊇ `['SELLER_PAYS_SHIPPING','SALES_TAX_EXCLUDED','STANDARD_SELLER_NO_STORE','NO_PROMOTED_LISTING_FEES','SCHEDULE_NOT_FOUNDER_VERIFIED']`; (4) price 0 → all zeros, categoryResolution still reported; (5) staleness: clock at `2026-11-01` + 45 days (`2026-12-16`) → `schedule.stale === false` and no `SCHEDULE_STALE`; + 46 days (`2026-12-17`) → `stale === true` and assumptions contain `SCHEDULE_STALE`, and `startupWarnings()` mentions stale; (6) `marketplaceId: 'EBAY_GB'` (no `applySchedule`) → no-schedule legacy: price 2000 → `totalCents 265` (`round(2000×0.1325)`), `perOrderFeeCents 0`, `categoryKey 'legacy_flat'`, `categoryResolution 'LEGACY_FLAT'`, assumptions equal `['LEGACY_FLAT_RATE_NO_SCHEDULE']`, `schedule.verificationStatus 'THIRD_PARTY_UNVERIFIED'`, `categoryLabel` equals `'Flat configured rate'`, `schedule.scope` equals the pinned legacy scope, and `startupWarnings()` has exactly one entry naming `EBAY_GB`; (7) `startupWarnings()` for the default US case (no `applySchedule`) contains exactly one entry mentioning "not verified against eBay"; (8) with `applySchedule: true`, `totalCents(p)` equals `breakdown(p).totalCents` for p in `[0, 1, 999, 1000, 1001, 20000]`; (9) constructing a service with an invalid schedule (clone with `rateBps: 1360.5`) throws at construction with the validateSchedule message; (10) **D11 default**: US, `applySchedule` omitted, ISBN ctx, price 2000 → `totalCents 265`, `perOrderFeeCents 0`, `categoryResolution 'LEGACY_FLAT'`, `categoryKey 'legacy_flat'`, assumptions equal `['SCHEDULE_NOT_FOUNDER_VERIFIED']` (must not include `LEGACY_FLAT_RATE_NO_SCHEDULE`), `schedule.region === 'US'`, `schedule.verificationStatus === 'THIRD_PARTY_UNVERIFIED'`, `schedule.verifiedAt === '2026-11-01'`.
- [ ] T011 [US2] Create `src/lib/fees/index.ts` exporting `createFeeService(opts: FeeServiceOptions): FeeService` per `data-model.md` "Service": select schedule whose `marketplaceIds` includes `opts.marketplaceId`; run `validateSchedule` at construction and throw `Error` on any message; `const apply = opts.applySchedule ?? (selected?.provenance.verification.status === 'FOUNDER_VERIFIED')`; when no schedule, D7 legacy; when a schedule exists and `apply` is false, D11 legacy-amount + real US provenance; when `apply` is true, schedule math. Staleness = `now() - Date.parse(verifiedAt + 'T00:00:00Z') > reviewIntervalDays * 86_400_000`; assemble assumptions in the contract's enum order; `rateNote` text built from the category's brackets (format: `"<rate>% of order total up to $<cap>, <rate2>% above, + $<perOrder> per order"` for marginal; `"<rate>% of the whole order total (<size rule>) + …"` for whole — exact strings not asserted beyond containing the first bracket's percentage). Production never passes `applySchedule`.
- [ ] T012 [US1] Run `docker compose run --rm api npx vitest run src/lib/fees` and `npm run typecheck`; all pass.

---

## Phase 4: Verdict seam (WP4) — independent of WP1–3

- [ ] T013 [P] [US1] Add to `src/lib/verdict.test.ts` (new `describe('computeFees seam (spec 009)')`): (1) a `computeFees` spy returning `() => 308` with samples all 2188, `realizationRate: 0.8`, shipping 500, cost 0, threshold 1000, `activeListingCount: 5` → spy called once with `1750`; result `feesCents === 308`, `profitCents === 942`, `verdict === 'RIP'`, `reasonCode === 'BELOW_THRESHOLD'`; (2) same input without `computeFees`, `feeRate: 0.1325` → `feesCents === 232`, `profitCents === 1018`, `verdict === 'FLIP'` (legacy unchanged — SC-002 pair); (3) `computeFees` takes precedence over `feeRate` when both are given; (4) empty samples → `computeFees` is called with `0` and its return is used (the fee function owns the zero rule); (5) `computeFees` returning `-1`, `1.5` or `NaN` makes `computeVerdict` throw a `RangeError` naming `computeFees`; (6) architecture guard (constitution VII, FR-008): read `src/lib/verdict.ts` with `node:fs` (path resolved from `process.cwd()`) and assert it contains no import specifier matching `/fees\//`. No existing test is edited.
- [ ] T014 [US1] In `src/lib/verdict.ts`: add `computeFees?: (priceCents: number) => number;` to `ValuationInput` with the doc comment `/** Total fees for a sale price, in cents. Supplied by the fee step (spec 009); when absent the legacy flat feeRate applies. */`; in `computeVerdict` replace the `feesCents` line with: use `input.computeFees(estimatedValueCents)` when given (validate non-negative integer else `throw new RangeError('computeFees must return a non-negative integer number of cents')`), else the existing `Math.round(estimatedValueCents * feeRate)`. `verdict.ts` imports nothing from `src/lib/fees/`. Run `docker compose run --rm api npx vitest run src/lib/verdict.test.ts` and `npm run typecheck`.

---

## Phase 5: Pipeline and server wiring (WP5) — depends on WP3, WP4

- [ ] T015 [US1] Pipeline tests first, in `src/lib/pipeline.test.ts`, new `describe('fee model (spec 009)')`. Build deps with `makeDeps(...)` then override `config.realizationRate: 0.8` and `config.fees = createFeeService({ schedules: [ebayUsSchedule], categoryMap: {}, marketplaceId: 'EBAY_US', legacyFlatRate: 0.1325, applySchedule: true })`. Inspect `src/lib/ebay/types.ts` for the listing/SearchResult shape (listings carry `leafCategoryId` / `leafCategoryName` used by `valuation.ts`). Cases: (1) SC-002 — ISBN `9780345391803`, fake client returns ≥ 3 listings all priced 2188 with `total` ≤ 10 and one leaf category → result `estimatedValueCents 1750`, `feesCents 308`, `profitCents 942`, `verdict 'RIP'`, `reasonCode 'BELOW_THRESHOLD'`, `feeBreakdown.categoryResolution 'ISBN_IDENTIFIER'`, `feeBreakdown.totalCents === feesCents`; (2) the same listings with deps lacking `fees` → `feesCents 232`, verdict `FLIP`, and `'feeBreakdown' in result === false`; (3) title lookup (no identifier) with listings in leaf `'261186'` and `categoryMap: { '261186': 'movies_tv' }` → `CATEGORY_MAP`, `categoryKey 'movies_tv'`; (4) title lookup, leaf unmapped → `DEFAULT_ASSUMED` and assumptions contain `FEE_CATEGORY_ASSUMED`; (5) a cached second lookup (same cache key) still returns a `feeBreakdown` and the fake client saw exactly 1 call (fees are not cached and add no eBay call); (6) no-market result (empty listings) → `feesCents 0`, `feeBreakdown.totalCents 0`.
- [ ] T016 [US1] Edit `src/lib/pipeline.ts`: import `type FeeService, type FeeBreakdown` from `./fees/index.js`/`types.js`; add `fees?: FeeService` to `PipelineDeps['config']`; add `feeBreakdown?: FeeBreakdown` to `VerdictResult`; in `lookup()` after `resolveValuation`, when `deps.config.fees` is set call `const fee = deps.config.fees.forLookup({ gtin: query.gtin ?? null, leafCategoryId: valuation.match.categoryId })`, pass `computeFees: fee.totalCents` into `computeVerdict`, then `feeBreakdown = fee.breakdown(verdict.estimatedValueCents)` and throw `Error('fee breakdown disagrees with verdict feesCents')` if `feeBreakdown.totalCents !== verdict.feesCents`. No new `await`. Leave every other field and the cache logic untouched.
- [ ] T017 [P] [US2] Server tests first, in `src/server.test.ts`. `testConfig` (marketplace `EBAY_US`, realization rate 1) has no `fees`, so every existing test keeps the legacy path and its current numbers (e.g. `feesCents 517`); do NOT edit `testConfig` or any existing assertion. Add a new `describe('fee model (spec 009)')`. Cases 1–3 build the app with `makeApp({ config: { fees: createFeeService({ schedules: [ebayUsSchedule], categoryMap: {}, marketplaceId: 'EBAY_US', legacyFlatRate: 0.1325, applySchedule: true }) } })` (if `makeApp` cannot override `fees`, extend `makeApp`'s override type only). Cases: (1) POST `/api/lookup` `{ identifier: '9780345391803' }` with the default fake (median 3900) → status 200, `body.estimatedValueCents 3900`, `feeBreakdown.categoryKey 'books_magazines'`, `categoryResolution 'ISBN_IDENTIFIER'`, fee `floor((3900×1530+5000)/10000)=597` plus 40, so `body.feesCents 637` and `body.profitCents 3900 − 637 − 500 = 2763`; (2) `body.feesCents === body.feeBreakdown.finalValueFeeCents + body.feeBreakdown.perOrderFeeCents` and `body.feeBreakdown.schedule.verificationStatus === 'THIRD_PARTY_UNVERIFIED'`; (3) a title lookup `{ title: 'Chrono Trigger SNES' }` → `categoryResolution 'DEFAULT_ASSUMED'`, `feesCents floor((3900×1360+5000)/10000)=530 → 530 + 40 = 570`; (4) the response of a default app (no `fees`) has no `feeBreakdown` key (test-only path); (5) **production wiring, unverified** — `makeApp({ config: withFeeService(testConfig) })` POST ISBN → `body.feesCents === 517`, `body.profitCents === 2883`, `body.verdict === 'FLIP'` (existing numbers unchanged), `body.feeBreakdown.categoryResolution === 'LEGACY_FLAT'`, assumptions include `SCHEDULE_NOT_FOUNDER_VERIFIED` and do not include `LEGACY_FLAT_RATE_NO_SCHEDULE`, `body.feeBreakdown.schedule.region === 'US'`; (6) **production wiring, verified** — clone `ebayUsSchedule` with `verification.status: 'FOUNDER_VERIFIED'`, `verifiedBy: 'test'`, `verifiedOn: '2026-11-07'`, build a FeeService from that clone with `applySchedule` omitted (so the status drives apply), `makeApp` with that service, POST ISBN → `body.feesCents === 637`. Import `withFeeService` from `./server.js`.
- [ ] T018 [US1] Edit `src/server.ts`: add `fees?: FeeService` to `AppConfig`; export `withFeeService(config: AppConfig): AppConfig` exactly as `data-model.md` "Server wiring" (spread, no mutation, **do not pass `applySchedule`**). `buildProductionDeps` (the function at ~line 423) must set `deps.config` to `withFeeService(config)` and `console.warn` each `config.fees.startupWarnings()` entry once there. Do not add an env var; do not change `loadConfig`'s validation of `EBAY_FEE_RATE`. `lookup(request.body, deps)` is unchanged.
- [ ] T019 [US2] Confirm the web client tolerates the extra response field: read `web/src/lib/api.ts` parsing of the lookup response; if it validates with a strict shape that rejects unknown keys, report it as a blocker to the orchestrator instead of editing `web/` (web is out of scope). Expected: it ignores unknown keys. Planning review 2026-11-07 already found `lookup()` does `return (await res.json()) as VerdictResult` with no extra-key strip; re-confirm at implement time in case that file moved. Record the finding in `run-log.md`.
- [ ] T020 [US1] Run `docker compose run --rm api sh -c "npx vitest run src/lib/pipeline.test.ts src/server.test.ts && npm run typecheck"`. Then run the whole suite `docker compose run --rm api npm test`. No existing expectation should move, because existing test deps omit `fees` and keep the legacy path; if one does, stop and report it rather than editing the expectation.

---

## Phase 6: Docs and sync (WP6, haiku) — depends on WP5

- [ ] T021 [P] [US3] `.env.example`: replace the `EBAY_FEE_RATE` comment with: `# Flat final-value fee rate. Live lookup rate until the eBay US schedule in src/lib/fees/schedule.ebay-us.ts is FOUNDER_VERIFIED (spec 009 FR-017). After that, used only when EBAY_MARKETPLACE_ID has no schedule. Not a typical-media rate.` Keep `EBAY_FEE_RATE=0.1325` unchanged.
- [ ] T022 [P] [US3] Append to `specs/009-fee-model/run-log.md` one line per completed package (the orchestrator normally does this; mark `[X]` for T001–T021 in this file once their packages are verified).
- [ ] T023 [US3] `CLAUDE.md`: add a "Current state" paragraph for spec 009 (fee schedule, resolution order, `feeBreakdown`, `EBAY_FEE_RATE` remains the live rate until FOUNDER_VERIFIED, schedule is third-party-sourced and unverified until the founder verifies, new `src/lib/fees/` layout). Do not touch any other paragraph. Also correct the env-var list sentence for `EBAY_FEE_RATE`.

---

## Work Packages

| WP | Tasks | Owns (files/globs) | Depends on | Tier | Verify |
|----|-------|--------------------|------------|------|--------|
| WP1 | T001–T004 | src/lib/fees/types.ts, src/lib/fees/schedule.ebay-us.ts, src/lib/fees/schedule.ebay-us.test.ts | — | sonnet | docker compose run --rm api npx vitest run src/lib/fees/schedule.ebay-us.test.ts |
| WP2 | T005–T007 | src/lib/fees/calculate.ts, src/lib/fees/calculate.test.ts | WP1 | sonnet | docker compose run --rm api npx vitest run src/lib/fees |
| WP3 | T008–T012 | src/lib/fees/category-map.ts, src/lib/fees/category.ts, src/lib/fees/category.test.ts, src/lib/fees/index.ts, src/lib/fees/index.test.ts | WP2 | sonnet | docker compose run --rm api npx vitest run src/lib/fees |
| WP4 | T013–T014 | src/lib/verdict.ts, src/lib/verdict.test.ts | — | sonnet | docker compose run --rm api npx vitest run src/lib/verdict.test.ts |
| WP5 | T015–T020 | src/lib/pipeline.ts, src/lib/pipeline.test.ts, src/server.ts, src/server.test.ts, specs/009-fee-model/run-log.md | WP3, WP4 | sonnet | docker compose run --rm api npx vitest run src/lib/pipeline.test.ts src/server.test.ts |
| WP6 | T021–T023 | .env.example, CLAUDE.md, specs/009-fee-model/tasks.md | WP5 | haiku | docker compose run --rm api npm run typecheck |

Waves: W1: WP1 ∥ WP4 · W2: WP2 · W3: WP3 · W4: WP5 · W5: WP6. WP6 owns `tasks.md` for the `[X]` marks; WP5 owns `run-log.md` entries for its own packages only.

## Deferred — NOT part of this build (needs founder decisions)

- **D-1 Category map population** (blocker B1): a one-off, opt-in script `scripts/fee-category-map.ts` that reads eBay's official Taxonomy API (`getCategorySubtree` for each fee root), prints a reviewable `leafId → feeKey` map, and is never run by default. Needs: the founder's decision on environment (sandbox trees may not match production IDs) and a written statement that classification data is outside the price-modelling restriction. Own spec/amendment, or a task here once approved.
- **D-2 Founder verification of the schedule** (quickstart §4). This is also the production on-switch (FR-017). The schedule math can be built and tested before this; live `feesCents` must not change before it.
- **D-3 Surfacing `feeBreakdown` in a UI** — belongs to the web or Expo spec that shows it.
