# Data Model: Realization Rate Correction

No persistent storage (stateless MVP, unchanged). These are the in-memory / wire types touched by
this feature. All money fields are integer **cents** (constitution VI).

## Where this feature sits in the flow

```text
LookupRequest ──identify──▶ ItemQuery ──valuation──▶ Valuation ──┐   (cached; loses a dead field)
                                                                 ├─shipping─▶ ShippingEstimate ─┐
LookupRequest.costBasisCents / profitThresholdCents ─────────────┤                              │
                                                                 │                              │
                            config.realizationRate (NEW) ────────┴──────────────────────────────┤
                                                                                                 ▼
                                                                                     verdict  ──▶ VerdictResult
                                                                                   (MODIFIED)      (EXTENDED)
```

The rate is global config, not per-request, and the in-memory cache dies with the process that
holds the config — so no cached value can outlive the rate that produced it (research R8).

## New

### Realization rate (config, owned by `server.ts` → `verdict.ts`)

| Field | Type | Default | Env var | Rules |
|-------|------|---------|---------|-------|
| `realizationRate` | `number` | `0.8` | `VALUATION_REALIZATION_RATE` | `0 < rate <= 1`; outside that range or non-numeric → fall back to default with a logged warning. Dimensionless ratio, never a money value. |

### `applyRealizationRate(rawCents, rate)` (owned by `verdict.ts`)

`Math.round(rawCents × rate)` → integer cents. Pure, exported, unit-testable. Sits beside
`estimateValueCents`, which is unchanged and continues to return the **raw** median.

## Modified

### `Valuation` (step 2 output, `valuation.ts` — the cached unit)

| Field | Change | Notes |
|-------|--------|-------|
| `estimatedValueCents` | **REMOVED** | Computed and cached today but read by nothing; `computeVerdict` recomputes independently. Deleting it makes "one value, one producer" structural rather than a convention (research R1). |
| `samplePricesCents`, `sampleSize`, `activeListingCount`, `pricingBasis`, `matchedTitle`, `computedAt` | unchanged | `pricingBasis` now carries the new literal (below) |

### `ValuationInput` (verdict step input, `verdict.ts`)

| New field | Type | Rules |
|-----------|------|-------|
| `realizationRate?` | `number` | Optional; defaults to `REALIZATION_RATE_DEFAULT` (0.8) when absent, matching the existing `feeRate?` precedent so 001/002 call sites keep compiling |

### `Verdict` (verdict step output, `verdict.ts`)

| Field | Type | Change | Rules |
|-------|------|--------|-------|
| `estimatedValueCents` | `int` | **SEMANTICS CHANGED** | Now the **corrected** value: `round(rawMedian × rate)`. Keeps its name so any consumer of "the number" gets the corrected one by default (research R6) |
| `rawAskingMedianCents` | `int` | **NEW** | The uncorrected median, for audit and future calibration (FR-009) |
| `realizationRate` | `number` | **NEW** | The rate actually applied, so the corrected value can be reconstructed |
| `feesCents` | `int` | **SEMANTICS CHANGED** | Computed from the corrected value, not the raw median (FR-003) |
| `pricingBasis` | `'ADJUSTED_ASKING_PRICE'` | **CHANGED** | Replaces `'ASKING_PRICE'`; constant at every rate including 1.0 (research R5) |
| everything else | — | unchanged | `profitCents` falls out of the corrected value automatically |

### `AppConfig` (`server.ts`)

Gains `realizationRate: number`, read from `VALUATION_REALIZATION_RATE` with the validation above
and forwarded through the existing `PipelineDeps.config` — `pipeline.ts` needs no new logic, only
the wider config object it already passes.

## Derivation

```text
rawAskingMedianCents = median(lowest ≤10 positive sample prices)   # unchanged
estimatedValueCents  = round(rawAskingMedianCents × realizationRate)
feesCents            = round(estimatedValueCents × feeRate)
profitCents          = estimatedValueCents − feesCents − shipping − costBasis
```

Every downstream behavior (threshold comparison, liquidity gate margin split) consumes
`profitCents` and therefore inherits the correction with no further change.

## Validation rules

- `0 < realizationRate <= 1` — a rate of 0 would RIP everything; above 1 would claim items sell
  above their asking price, incoherent for the fixed-price listings we query (research R4).
- A rate of exactly `1` MUST leave values and verdicts identical to pre-feature behavior, with
  `rawAskingMedianCents === estimatedValueCents`. The `pricingBasis` label still reads
  `ADJUSTED_ASKING_PRICE` (FR-005, scoped to values and verdicts).
- `sampleSize === 0` → raw median 0 → corrected 0; the existing no-market-data verdict and reason
  are unaffected (FR-006).
