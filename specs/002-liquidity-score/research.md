# Research: Liquidity-Gated Verdict

Phase 0 design decisions. No `NEEDS CLARIFICATION` items remained in Technical Context — the three
product-level unknowns were resolved with the founder during `/speckit-specify` (see spec.md
"Resolved Design Decisions"). What follows are the implementation-level choices those answers
force.

---

## R1: Gate placement vs. the valuation cache

**Decision**: Compute the liquidity tier and gate **per request, at verdict time** — never bake
them into the cached `Valuation`.

**Rationale**: The gate's outcome depends on `profitThresholdCents`, which is a **per-request**
value (`request.profitThresholdCents ?? config default`), while the cached unit is deliberately
threshold-free so users share it (001 research R6). Two users scanning the same barcode with
different thresholds must be able to get `FLIP_RISKY` and `RIP` from the same cached valuation.
`activeListingCount` — the tier's only input — is already on the cached `Valuation`, so this needs
no cache change at all: no new key component, no TTL change, no invalidation.

**Alternatives considered**:

- *Store the tier on `Valuation` at cache-write time*: tier alone is threshold-independent so it
  would technically work, but it splits liquidity logic across two steps and violates constitution
  VII (valuation step reaching into verdict concerns) for zero benefit — the classification is a
  handful of integer comparisons.
- *Add threshold to the cache key*: would fragment the cache by threshold value, multiplying eBay
  calls for the same product. Directly contradicts constitution III.

---

## R2: Branch precedence and reason codes

**Decision**: Evaluate in a fixed precedence order, with exactly one reason code emitted per
result:

| # | Condition | `verdict` | `reasonCode` |
|---|-----------|-----------|--------------|
| 1 | `sampleSize === 0` | `RIP` | `NO_MARKET_DATA` |
| 2 | `profitCents < profitThresholdCents` | `RIP` | `BELOW_THRESHOLD` |
| 3 | tier is `WEAK` **and** `profitCents < riskyMarginCents` | `RIP` | `WEAK_LIQUIDITY_THIN_MARGIN` |
| 4 | tier is `WEAK` **and** `profitCents >= riskyMarginCents` | `FLIP_RISKY` | `WEAK_LIQUIDITY_HIGH_VALUE` |
| 5 | otherwise | `FLIP` | `PROFITABLE` |

**Rationale**: Ordering 1 before 3 satisfies the spec's explicit precedence edge case — a
no-market-data result must report *that*, not a liquidity story. Ordering 2 before 3/4 enforces
FR-005 (downgrade-only): the gate is only ever consulted on results that already cleared the
profit threshold, so it structurally cannot promote an unprofitable item. Branches 3/4 fire only
for `WEAK`, satisfying FR-004 (strong/moderate/unproven never alter the verdict).

One code per branch keeps the mapping to human-readable text total and exhaustive — a TypeScript
`Record<ReasonCode, string>` gives compile-time proof that every code has copy.

**Alternatives considered**:

- *Boolean flags (`liquidityDowngraded`, `noMarketData`, …) instead of a code*: composable flags
  permit contradictory combinations (downgraded + no market data) that the precedence rules
  forbid; an enum makes the illegal states unrepresentable.
- *Checking liquidity before profit*: would let the gate produce `FLIP_RISKY` for an unprofitable
  item, violating FR-005.

---

## R3: One tuning knob for "strong supply", not two

**Decision**: A single config value, `LIQUIDITY_STRONG_MAX_LISTINGS` (default `10`), drives **both**
the strong-tier upper boundary **and** the existing `supplySideLiquidity` score's `strongSupplyMax`
parameter.

**Rationale**: Both constants answer the same question — "at what active-listing count does supply
stop being a problem?" Letting them drift apart produces incoherent output: a response could show
`liquidityScore: 1.0` (perfectly liquid) next to `liquidityTier: MODERATE`. `supplySideLiquidity`
already accepts `strongSupplyMax` as a parameter with the module constant as its default, so
threading the config value through is a one-line change that leaves the formula itself untouched
(spec assumption: score computation unchanged).

**Alternatives considered**:

- *Two independent knobs*: maximum flexibility, but the incoherent-output failure mode is a
  support burden and the flexibility answers no real need the founder expressed.
- *Leave the score hardcoded at 10 and make only the tier configurable*: same drift problem the
  moment the founder retunes the tier.

---

## R4: Risky-margin cutoff as a multiplier of the threshold

**Decision**: `riskyMarginCents = Math.round(profitThresholdCents × LIQUIDITY_RISKY_MARGIN_MULTIPLIER)`,
default multiplier `2`. A weak-tier item is "comfortable" when `profitCents >= riskyMarginCents`.

**Rationale**: The founder's rule is relative, not absolute — "if it's genuinely valuable, waiting
is fine; if it's a few dollars over the threshold, rip it." A multiplier scales correctly with
whatever threshold a given user sets, where a fixed cushion would mean something different to a
$10-threshold declutterer than a $100-threshold serious seller. `Math.round` keeps the derived
cutoff in integer cents (constitution VI); the multiplier itself is a dimensionless ratio, exactly
like the existing `feeRate`.

**Known degenerate case (accepted)**: with `profitThresholdCents === 0`, the cutoff is `0`, so any
profitable weak-tier item resolves `FLIP_RISKY` rather than `RIP`. This is the correct reading of
an explicit user instruction that *any* profit is acceptable — and the user still receives the
`FLIP_RISKY` signal rather than a silent plain `FLIP`, so no information is lost.

**Alternatives considered**:

- *Absolute cushion in cents* (`profit >= threshold + LIQUIDITY_RISKY_CUSHION_CENTS`): handles the
  zero-threshold case gracefully but scales poorly across user types.
- *`max(multiplier × threshold, absolute floor)`*: robust to both, but introduces a second knob to
  explain and tune for a case that only arises when the user explicitly opts into "any profit
  counts." Rejected as premature.

---

## R5: Keep the logic in `verdict.ts`

**Decision**: Add `liquidityTier()` and the gate branch inside `verdict.ts`. No new module.

**Rationale**: `verdict.ts` already owns `supplySideLiquidity`, `liquidityScore`, and
`computeVerdict` — the gate is the same concern, and constitution VII requires it to live in the
verdict step. Both new functions are exported and independently unit-testable without a file split.

**Alternatives considered**: a dedicated `src/lib/liquidity.ts`. Rejected — it would scatter one
pipeline step's logic across two files, and the existing liquidity helpers would have to move with
it, producing a larger diff and a circular-ish dependency between the two modules for no gain.

---

## R6: Surface both a machine code and human text

**Decision**: Response carries `reasonCode` (stable enum, from R2) **and** `reason` (plain-language
sentence).

**Rationale**: FR-008 requires plain language a non-technical user can read. A code alone fails
that. Text alone would force a future frontend to string-match English prose to decide styling —
and `FLIP_RISKY` specifically needs distinct visual treatment from `RIP`. Emitting both costs one
object lookup and keeps the frontend's branching honest. Text is generated server-side from an
exhaustive code→copy map, so the two can never disagree.

**Alternatives considered**:

- *Text only*: brittle for consumers, unlocalizable.
- *Code only*: violates FR-008's plain-language requirement, pushes copywriting into an
  unbuilt frontend.

---

## R7: Tier is a pure function of `activeListingCount`

**Decision**:

```text
activeListingCount === 0                       → UNPROVEN
1 … strongMax                                  → STRONG
strongMax+1 … moderateMax                      → MODERATE
> moderateMax                                  → WEAK
```

Tier does **not** consult `sampleSize`.

**Rationale**: Keeping the classifier a pure single-argument function makes it trivially testable
and keeps "how much competing supply exists" separate from "do we have price data" — two genuinely
different questions. The spec defines `UNPROVEN` as zero active listings *with* a price sample, but
the sample-less case is already fully handled by precedence branch 1 (`NO_MARKET_DATA` wins), so the
tier value in that case never drives a verdict. Reporting `UNPROVEN` there is also simply honest:
with no listings and no prices, liquidity genuinely cannot be assessed.

Boundaries use `<=` on the more-liquid side, satisfying the spec's tier-boundary edge case (exactly
at the strong cutoff counts as strong).

**Alternatives considered**: making the tier `UNPROVEN` whenever `sampleSize === 0` regardless of
count. Rejected — it would mislabel a flooded-market item (200 active listings, all with
unparseable prices) as "unproven," hiding real supply information the response otherwise has.

---

## R8: Backward compatibility of the existing response fields

**Decision**: Keep `liquidityScore`, `liquidityBasis`, `sampleSize`, `pricingBasis`, and
`noMarketData` exactly as they are. Add `liquidityTier`, `reasonCode`, `reason`, and expand the
`verdict` enum. Bump the contract to **0.3.0**.

**Rationale**: `noMarketData` is now derivable from `reasonCode === 'NO_MARKET_DATA'`, but removing
it would be a gratuitous break of the 001 contract for a field that costs one boolean. The
`verdict` enum expansion is the one genuinely breaking change; with no frontend built yet there is
no consumer to migrate, which is precisely why this is the right moment to make it.

**Alternatives considered**: introducing a `v2` endpoint alongside `/api/lookup`. Rejected as
pure ceremony — versioned endpoints with zero clients on the old one is dead code on arrival.
