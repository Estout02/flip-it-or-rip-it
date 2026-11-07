# Quickstart / validation guide: eBay Fee Model (spec 009)

For whoever implements and reviews. Everything runs in Docker (constitution V). Nothing here calls
eBay; the one-off live check at the end is optional and sandbox-only.

## 1. Hand-derived fee table (the expected values the tests must use)

Formula: `share(c, bps) = floor((c × bps + 5000) / 10000)`; total = Σ shares + per-order fee.
Per-order fee: 30 if order total ≤ 1,000 cents else 40, except athletic shoes ≥ 15,000 (waived).

| # | Category | Price (cents) | Working | Fee (cents) |
|---|---|---|---|---|
| 1 | most_categories | 0 | no order | 0 |
| 2 | most_categories | 1 | share(1,1360)=floor(6360/10000)=0, +30 | 30 |
| 3 | most_categories | 800 | share=floor(1,093,000/10000)=109, +30 | 139 |
| 4 | most_categories | 999 | share=floor(1,363,640/10000)=136, +30 | 166 |
| 5 | most_categories | 1000 | share=floor(1,365,000/10000)=136, +30 | 166 |
| 6 | most_categories | 1001 | share=floor(1,366,360/10000)=136, +40 | 176 |
| 7 | most_categories | 5000 | share=floor(6,805,000/10000)=680, +40 | 720 |
| 8 | most_categories | 20000 | share=floor(27,205,000/10000)=2720, +40 | 2760 |
| 9 | books_magazines | 2000 | share(2000,1530)=floor(3,065,000/10000)=306, +40 | 346 |
| 10 | books_magazines | 1750 | share=floor(2,682,500/10000)=268, +40 | 308 |
| 11 | most_categories | 800000 | slice1 750000@1360=floor(1,020,005,000/10000)=102,000; slice2 50000@235=floor(11,755,000/10000)=1,175; +40 | 103,215 |
| 12 | jewelry (whole) | 500000 | ≤ 500000 → 1500 bps: floor(750,005,000/10000)=75,000; +40 | 75,040 |
| 13 | jewelry (whole) | 500001 | > 500000 → 900 bps: floor(450,005,900/10000)=45,000; +40 | 45,040 |
| 14 | athletic_shoes | 14999 | below 15000 → most_categories: floor(20,403,640/10000)=2,040; +40 | 2,080 |
| 15 | athletic_shoes | 15000 | 800 bps: floor(12,005,000/10000)=1,200; waived | 1,200 |
| 16 | watches (marginal) | 100001 | slice1 100000@1500=15,000; slice2 1@650=floor(5,650/10000)=0; +40 | 15,040 |
| 17 | coins | 2000 | share(2000,1325)=floor(2,655,000/10000)=265, +40 | 305 |
| 18 | movies_tv | 2000 | same shape as books: 306 + 40 | 346 |
| 19 | music_non_vinyl | 2000 | 306 + 40 | 346 |
| 20 | trading_cards | 2000 | same shape as coins: 265 + 40 | 305 |
| 21 | comics | 2000 | 265 + 40 | 305 |
| 22 | guitars_basses | 2000 | share(2000,670)=floor(1,345,000/10000)=134, +40 | 174 |
| 23 | business_industrial_heavy | 2000 | share(2000,300)=floor(605,000/10000)=60, +40 | 100 |
| 24 | bullion (whole) | 2000 | 1360 bps: floor(2,725,000/10000)=272, +40 | 312 |
| 25 | handbags (whole) | 2000 | 1500 bps: floor(3,005,000/10000)=300, +40 | 340 |
| 26 | nft (whole) | 2000 | 500 bps: floor(1,005,000/10000)=100, +40 | 140 |

Cross-check against the source's own published examples (`reseller-fees` "At a glance"): row 7 →
$7.20 and row 8 → $27.60. ✔ Independently re-derived 2026-11-07.

Rows 5/6 pin the per-order boundary; 12/13 pin the whole-bracket boundary; 14/15 pin the athletic
shoes minimum; 11 pins the marginal slice above $7,500. Rows 18–26 are one mid-price per remaining
key so a transcription error in an unused category cannot hide (SC-001).

## 2. The SC-002 demonstration (flip → rip)

Fake Browse client returns an ISBN item whose sample prices are all 2,188 cents; realization rate
0.8 → estimated value `round(2188 × 0.8) = 1750`. Shipping 500, threshold 1,000, cost basis 0.
Active-listing count ≤ 10 (STRONG), match confidence HIGH.

- Legacy (`feeRate` 0.1325): fee 232, profit 1750 − 232 − 500 = **1,018 → FLIP**.
- Spec 009 with `applySchedule: true` (ISBN ⇒ books, row 10): fee 308, profit 1750 − 308 − 500 =
  **942 → RIP, BELOW_THRESHOLD**, `feeBreakdown.categoryResolution = 'ISBN_IDENTIFIER'`.
- Production with the shipped `THIRD_PARTY_UNVERIFIED` schedule: same as legacy (FR-017). The
  response still carries `feeBreakdown` with `SCHEDULE_NOT_FOUNDER_VERIFIED`.

## 3. Commands

```bash
docker compose run --rm api npx vitest run src/lib/fees         # WP1–WP3
docker compose run --rm api npx vitest run src/lib/verdict.test.ts # WP4
docker compose run --rm api npx vitest run src/lib/pipeline.test.ts src/server.test.ts # WP5
docker compose run --rm api sh -c "npm test && npm run typecheck"  # orchestrator verify
```

The web client is untouched, so `web` suites are not required. The orchestrator still runs one
`docker compose run --rm --no-deps web npx vitest run src/lib` to prove the new response field does
not break client parsing (WP5 task T019 checks `web/src/lib/api.ts` tolerates unknown fields first).

## 4. Founder verification gate (FR-014)

1. Open eBay's selling-fees page (URL in `research.md` R2) in a browser.
2. Compare rows 3, 7, 9, 17 above and the per-order fee to what the page says today.
3. If they match, edit `src/lib/fees/schedule.ebay-us.ts`: `verification.status: 'FOUNDER_VERIFIED'`,
   `verifiedBy`, `verifiedOn`, and set `verifiedAt` to that date. That flip is what turns the
   schedule on in production (FR-017). If they differ, change the data and the expectations in this
   file together, then re-run the suite. Do not flip the status to make tests pass.

## 5. Manual smoke (optional; sandbox only)

```bash
docker compose run --rm api npx tsx scripts/sandbox-smoke.ts   # prints the environment first; must say sandbox
curl -s -X POST localhost:3000/api/lookup -H 'content-type: application/json' \
  -d '{"identifier":"9780345391803"}' | jq '{feesCents, feeBreakdown}'
```

Until the founder marks the schedule `FOUNDER_VERIFIED`, expect **legacy** `feesCents`
(`round(estimatedValue × 0.1325)`, no per-order fee), `feeBreakdown.categoryResolution`
`LEGACY_FLAT`, and assumptions including `SCHEDULE_NOT_FOUNDER_VERIFIED` (not
`LEGACY_FLAT_RATE_NO_SCHEDULE`). After verification, expect `ISBN_IDENTIFIER` /
`books_magazines` and the schedule cents from §1. The sandbox has sparse listings, so a
no-market result (fees 0) is also a valid outcome there.
