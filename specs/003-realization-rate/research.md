# Research: Realization Rate Correction

Phase 0 design decisions. No `NEEDS CLARIFICATION` items remained in Technical Context; the two
product-level unknowns were resolved with the founder during `/speckit-specify` (spec.md "Resolved
Design Decisions"). What follows are the implementation choices those answers force.

---

## R1: One value, produced in one place — remove the dead `Valuation.estimatedValueCents`

**Decision**: Delete `estimatedValueCents` from the `Valuation` interface. `computeVerdict` becomes
the sole producer of both the raw median and the corrected value.

**Rationale**: Today the median is computed **twice** from the same input — once in
`valuation.ts:50` into `Valuation.estimatedValueCents`, and again in `verdict.ts:205` inside
`computeVerdict`. Only the second reaches the response: `pipeline.ts` passes
`valuation.samplePricesCents` to the verdict step and never reads the cached field. Tracing the
code confirms zero non-test consumers.

That redundancy is harmless only while both computations agree. Applying the realization rate to
one site and not the other would produce a cached "value" disagreeing with the value the user is
shown — precisely the failure FR-002 prohibits. Deleting the unused field makes FR-002
*structurally* true rather than a rule someone must remember: there is one place a value is
produced, so there is nothing to keep in sync.

**Alternatives considered**:

- *Apply the rate in both places*: two sources of truth for one number, guaranteed to drift the
  first time someone edits one site.
- *Keep the field, rename it `rawAskingMedianCents`, and expose it from the cached valuation*: the
  raw median does need to reach the response (FR-009), but it can come from the verdict step that
  already computes it. Keeping the field would preserve dead code behind a better name.
- *Invert ownership — have `computeVerdict` accept a precomputed `estimatedValueCents` instead of
  `samplePricesCents`*: arguably the purest separation, but it rewrites every existing verdict test
  signature and makes SC-003 ("rate 1.0 reproduces pre-feature verdicts across the existing test
  suite") much harder to demonstrate literally. Rejected as disproportionate to a one-line
  arithmetic change.

---

## R2: Correction applied to the median, not to individual prices

**Decision**: `correctedCents = Math.round(estimateValueCents(prices) × rate)`.

**Rationale**: Matches the spec assumption and keeps the existing median-of-lowest-N logic intact.
Scaling each sample price before taking the median produces an identical result for a linear
scaling anyway (the median of scaled values equals the scaled median), so per-price application
would add rounding noise for no behavioral difference.

**Alternatives considered**: applying the rate per-price before the median — mathematically
equivalent pre-rounding, strictly worse after rounding, and it would obscure the raw median that
FR-009 requires.

---

## R3: Rounding and value floor

**Decision**: `Math.round`, consistent with `feesCents` and `riskyMarginCents`. No explicit
negative clamp.

**Rationale**: Constitution VI requires integer cents. A clamp would be dead code: the median is
non-negative by construction (valuation filters to prices > 0) and the rate is validated to
`0 < rate <= 1`, so the product cannot be negative. Guarding against an impossible state would
violate the "no validation for scenarios that can't happen" convention.

---

## R4: Rate validation range is `0 < rate <= 1`

**Decision**: Accept rates greater than 0 and at most 1; anything else falls back to the default
with a logged warning, following the `LIQUIDITY_*` precedent from spec 002.

**Rationale**: A rate of 0 would zero every valuation and make every item a RIP. A rate above 1
would assert that items sell for *more* than their asking price — incoherent for the fixed-price
listings the Browse query filters to (`buyingOptions:{FIXED_PRICE}`), where the asking price is the
transaction ceiling. Bounding at 1 also keeps the correction unambiguously a *haircut*, which is
what the label `ADJUSTED_ASKING_PRICE` promises a reader.

**Alternatives considered**: allowing rates above 1 for a future auction-inclusive world. Rejected
as speculative — auctions are not queried today, and the bound is one character to change if that
ever ships.

---

## R5: `PricingBasis` becomes `ADJUSTED_ASKING_PRICE`, constant at every rate

**Decision**: Replace the `'ASKING_PRICE'` union member with `'ADJUSTED_ASKING_PRICE'`. The label
does not vary with the configured rate.

**Rationale**: Founder decision 1. A constant label is easier to reason about than one that
flickers with config, and at a rate of 1.0 the value has still passed through the adjusting
pipeline — the identity case is an adjustment of one, not the absence of adjustment. This is the
one place the plan knowingly diverges from "rate 1.0 reproduces current behavior exactly", which
spec FR-005 now scopes explicitly to values and verdicts rather than the label.

**Alternatives considered**: keeping `ASKING_PRICE` with a separate rate field (rejected by the
founder as too easy to misread), and a dynamic label (rejected as harder to reason about).

---

## R6: Response field naming

**Decision**: `rawAskingMedianCents` (integer cents) and `realizationRate` (ratio).
`estimatedValueCents` keeps its name and becomes the corrected figure.

**Rationale**: Keeping `estimatedValueCents` as the corrected value means every existing consumer
of "the number" automatically gets the corrected one — the safe default if a field is ever missed.
`rawAskingMedianCents` is verbose deliberately: a short name like `medianCents` invites a frontend
to display it as *the* value, which is exactly the false-FLIP bias this feature exists to remove.

---

## R7: Keep the arithmetic in `verdict.ts`

**Decision**: `applyRealizationRate` is a small exported pure function beside `estimateValueCents`.
No new module.

**Rationale**: The two functions are always called in sequence; splitting them across files would
mean importing one into the other's module for every call. `verdict.ts` already owns valuation
arithmetic, and both functions stay independently unit-testable as exports.

---

## R8: Config changes and the cache cannot go stale

**Decision**: No cache invalidation logic. The rate is read from config at verdict time.

**Rationale**: Worth stating because it looks like a risk and is not. The rate is global config,
not per-request, so unlike the liquidity gate it *could* have been baked into a cached value.
It isn't — and even if it were, changing an environment variable requires a process restart, and
`TtlCache` is in-memory, so the cache dies with the process. There is no path by which a cached
entry outlives the configuration that produced it.

---

## R9: Test strategy — pin existing tests at rate 1.0

**Decision**: Existing verdict and server tests pass an explicit `realizationRate: 1`; new tests
cover the default 0.8, the boundaries, and config handling.

**Rationale**: This is the literal shape of SC-003 — "setting the rate to 1.0 reproduces
pre-feature verdicts identically across the existing test suite." Pinning preserves those tests as
a regression check on the *underlying* profit math, cleanly separated from tests of the correction
itself. Recomputing every existing expected number for 0.8 instead would churn the suite and
destroy that separation, and a wrong arithmetic edit would be indistinguishable from an intended
one.

**Risk this creates**: the production default (0.8) would be under-exercised at the integration
level if only unit tests cover it. Mitigated by explicitly adding end-to-end cases at the default
rate rather than relying on the pinned ones.

**Alternatives considered**: updating all existing expectations to 0.8 (churn, loses the SC-003
demonstration), or defaulting the test fixtures to 0.8 and accepting the rewrite (same problem).
