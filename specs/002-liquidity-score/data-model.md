# Data Model: Liquidity-Gated Verdict

No persistent storage (stateless MVP, unchanged). These are the in-memory / wire types touched by
this feature. All money fields are integer **cents** (constitution VI). Only the **verdict step**
owns new types — `identify.ts`, `valuation.ts`, and `shipping.ts` are untouched (constitution VII).

## Where this feature sits in the flow

```text
LookupRequest ──identify──▶ ItemQuery ──valuation──▶ Valuation ──┐   (all unchanged)
                                          (cached)               │
                                                                 ├─shipping─▶ ShippingEstimate ─┐
LookupRequest.costBasisCents / profitThresholdCents ─────────────┴──────────────────────────────┤
                                                                                                 │
                                          config.liquidity (NEW) ────────────────────────────────┤
                                                                                                 ▼
                                                                                     verdict  ──▶ VerdictResult
                                                                                   (MODIFIED)      (EXTENDED)
```

The cached unit (`Valuation`) is unchanged — the tier and gate are computed per request at verdict
time, because the gate depends on the per-request profit threshold (research R1).

## New types

### LiquidityTier (owned by `verdict.ts`)

```ts
type LiquidityTier = 'STRONG' | 'MODERATE' | 'WEAK' | 'UNPROVEN';
```

Pure function of `activeListingCount` (research R7):

| Condition | Tier | Meaning shown to user |
|-----------|------|----------------------|
| `=== 0` | `UNPROVEN` | Nobody else is listing this — can't assess; use judgment |
| `1 … strongMax` (default 10) | `STRONG` | Little competing supply |
| `strongMax+1 … moderateMax` (default 50) | `MODERATE` | Some competition |
| `> moderateMax` | `WEAK` | Flooded market |

Boundaries are inclusive on the more-liquid side (`<=`), per the spec's tier-boundary edge case.

### VerdictReasonCode (owned by `verdict.ts`)

```ts
type VerdictReasonCode =
  | 'NO_MARKET_DATA'
  | 'BELOW_THRESHOLD'
  | 'WEAK_LIQUIDITY_THIN_MARGIN'
  | 'WEAK_LIQUIDITY_HIGH_VALUE'
  | 'PROFITABLE';
```

Exactly one is emitted per result, by the precedence ladder in research R2. Each maps to
plain-language copy through an exhaustive `Record<VerdictReasonCode, string>` (research R6).

### LiquidityConfig (owned by `verdict.ts`, supplied by `server.ts` config)

| Field | Type | Default | Env var | Rules |
|-------|------|---------|---------|-------|
| `strongMaxListings` | `int` | `10` | `LIQUIDITY_STRONG_MAX_LISTINGS` | ≥ 1. Also feeds `supplySideLiquidity`'s `strongSupplyMax` (research R3) |
| `moderateMaxListings` | `int` | `50` | `LIQUIDITY_MODERATE_MAX_LISTINGS` | Must be ≥ `strongMaxListings` |
| `riskyMarginMultiplier` | `number` | `2` | `LIQUIDITY_RISKY_MARGIN_MULTIPLIER` | ≥ 1. Dimensionless ratio, like `feeRate` — never a money value |

Derived at verdict time: `riskyMarginCents = Math.round(profitThresholdCents × riskyMarginMultiplier)`
— integer cents (constitution VI).

## Modified types

### ValuationInput (verdict step input, `verdict.ts`)

Unchanged fields: `samplePricesCents`, `pricingBasis`, `activeListingCount`,
`shippingEstimateCents`, `costBasisCents`, `profitThresholdCents`, `feeRate?`.

| New field | Type | Rules |
|-----------|------|-------|
| `liquidity?` | `Partial<LiquidityConfig>` | Optional; module defaults apply per-field when absent. Optional so existing 001 tests and call sites stay green (matches the existing `feeRate?` precedent) |

### Verdict (verdict step output, `verdict.ts`)

| Field | Type | Change | Rules |
|-------|------|--------|-------|
| `verdict` | `'FLIP' \| 'FLIP_RISKY' \| 'RIP'` | **EXPANDED** | `FLIP_RISKY` only ever emitted for tier `WEAK` with comfortable margin |
| `liquidityTier` | `LiquidityTier` | **NEW** | Always present |
| `reasonCode` | `VerdictReasonCode` | **NEW** | Always present; exactly one per result |
| `reason` | `string` | **NEW** | Plain-language sentence derived from `reasonCode` (FR-008) |
| `liquidityScore` | `number` 0–1 | unchanged | Still `min(1, strongMax/active)`; formula untouched |
| `liquidityBasis` | `'SUPPLY_SIDE_ONLY'` | unchanged | Honesty marker (constitution I, spec US3) |
| `estimatedValueCents`, `feesCents`, `shippingEstimateCents`, `profitCents`, `sampleSize`, `pricingBasis`, `noMarketData` | — | unchanged | `noMarketData` retained for 001 compatibility though now derivable from `reasonCode` (research R8) |

### AppConfig (`server.ts`)

| New field | Type | Source |
|-----------|------|--------|
| `liquidity` | `LiquidityConfig` | `loadConfig()` reads the three env vars with the defaults above |

### PipelineDeps.config (`pipeline.ts`)

Gains `liquidity: LiquidityConfig`, passed straight through to `computeVerdict`. `pipeline.ts`
performs **no** liquidity logic — it only forwards config (constitution VII).

## Verdict state machine

```text
                         sampleSize === 0 ──────────────▶ RIP / NO_MARKET_DATA
                                 │ no
                   profit < threshold ────────────────────▶ RIP / BELOW_THRESHOLD
                                 │ no  (gate only sees profitable items → downgrade-only, FR-005)
                      tier === WEAK ?
                        │ yes                    │ no
          profit >= riskyMarginCents ?           └────────▶ FLIP / PROFITABLE
            │ yes              │ no
   FLIP_RISKY /          RIP /
   WEAK_LIQUIDITY_       WEAK_LIQUIDITY_
   HIGH_VALUE            THIN_MARGIN
```

## Validation rules

- `moderateMaxListings >= strongMaxListings` — misconfiguration would make `MODERATE` unreachable.
  Validated at config load; fall back to defaults with a logged warning rather than crashing the
  API on a typo'd env var.
- `riskyMarginMultiplier >= 1` — a multiplier below 1 would make the "comfortable" cutoff *lower*
  than the threshold itself, which is incoherent given the gate only runs on already-profitable
  items.
- `strongMaxListings >= 1` — zero would make `STRONG` unreachable and collapse into `UNPROVEN`.
