# Quickstart & Validation: Realization Rate Correction

How to prove the feature works end-to-end. Contract:
[contracts/lookup-api.yaml](./contracts/lookup-api.yaml); types:
[data-model.md](./data-model.md); rationale: [research.md](./research.md).
Everything runs inside Docker (constitution V).

## Prerequisites

- Docker + Docker Compose
- `.env` copied from `.env.example`; `VALUATION_REALIZATION_RATE` may be left unset (default 0.8)
- Automated tests need **no** eBay credentials (fake `EbayBrowseClient`)

## 1. Automated tests — the authoritative proof

```bash
docker compose run --rm api npm test
docker compose run --rm api npm run typecheck
```

Expected coverage:

| Scenario | Setup | Expected |
|----------|-------|----------|
| US1-AS1 — false FLIP removed | raw median clears threshold only by less than the correction | corrected value lower, `RIP` |
| US1-AS2 — real FLIP survives | profit comfortably clears threshold after correction | `FLIP` |
| US1-AS3 — one number everywhere | any lookup | the value in the profit math equals the value reported; no uncorrected figure appears as `estimatedValueCents` |
| US2-AS1 — honest label | any lookup | `pricingBasis: ADJUSTED_ASKING_PRICE` |
| US2-AS2 — auditable | any lookup | `rawAskingMedianCents`, `realizationRate` present; `round(raw × rate) === estimatedValueCents` |
| US3-AS1 — retunable | configured rate changed | value and verdict shift, no code change |
| US3-AS2 — bad config | rate of `0`, `1.5`, `-1`, or non-numeric | falls back to 0.8 with a warning |
| Edge — rate 1.0 | `realizationRate: 1` | values and verdicts identical to pre-feature; `raw === corrected`; label still `ADJUSTED_ASKING_PRICE` |
| Edge — no market data | `sampleSize === 0` | raw 0, corrected 0, existing `NO_MARKET_DATA` RIP unchanged |
| Edge — fees follow the correction | any priced item | `feesCents === round(correctedValue × feeRate)`, never the raw median |
| Edge — rounding | a median that scales to a fraction of a cent | corrected value is a whole number of cents |
| Regression — liquidity gate | 002 fixtures | gate still fires on the corrected profit; some items legitimately shift across the margin split |

**On the existing suite**: 001/002 tests are pinned to `realizationRate: 1` so they keep proving
the underlying profit math unchanged (SC-003). The production default of 0.8 is covered by new
tests added at both the unit and HTTP level — don't let the pinning leave the real default
untested.

## 2. Run the API

```bash
docker compose up --build     # API on http://localhost:3000
```

## 3. Manual response-shape check

```bash
curl -s -X POST localhost:3000/api/lookup -H 'content-type: application/json' \
  -d '{"title":"Chrono Trigger SNES"}' | jq
```

Expected: 200 carrying `rawAskingMedianCents`, `realizationRate`, and
`pricingBasis: "ADJUSTED_ASKING_PRICE"`. Against the empty eBay sandbox this is legitimately
`RIP` / `NO_MARKET_DATA` with both values at 0 — correct behavior, not a failure.

## 4. Seeing the correction actually bite

The sandbox returns no listings, so the correction can't be observed through a live lookup. To see
it on real numbers, compare two configured rates through the test harness or a one-off script:

```bash
# rate 1.0 vs rate 0.8 on the same sample should differ by exactly the haircut
docker compose run --rm -e VALUATION_REALIZATION_RATE=1 api npm test
docker compose run --rm -e VALUATION_REALIZATION_RATE=0.5 api npm test
```

Both runs must stay green: the suite pins rates explicitly rather than inheriting the environment,
so an env override changing results would itself be a bug worth knowing about.

## 5. Optional: live sandbox smoke

```bash
docker compose run --rm api npx tsx scripts/sandbox-smoke.ts
```

Requires sandbox credentials. The printed summary should show the raw median and applied rate
beside the corrected value.

## Definition of done

- [ ] All suites green in Docker; typecheck clean
- [ ] Every row in the coverage table above has a test
- [ ] Contract examples in `contracts/lookup-api.yaml` match real output
- [ ] `.env.example` documents `VALUATION_REALIZATION_RATE` and states plainly that 0.8 is a
      judgment call awaiting calibration, not a measured value
- [ ] No new eBay calls (SC-006) — the cache-hit test still asserts zero external calls
