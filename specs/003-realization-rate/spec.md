# Feature Specification: Realization Rate Correction

**Feature Branch**: `003-realization-rate`

**Created**: 2026-09-19

**Status**: Draft

**Input**: User description: "Apply a configurable realization rate (haircut) to the asking-price median so estimated value reflects expected sale price rather than asking price."

## Background

The valuation step estimates an item's worth as the median of the ten lowest active asking prices.
That median is then treated as the expected sale price — an implicit multiplier of **1.0**.

Sellers list aspirationally, so asking prices sit above realized sale prices. The current estimate
is therefore **systematically biased high**, and the bias runs in the most damaging direction: it
produces **false FLIPs**, sending someone to spend an hour photographing and listing an item that
will not actually sell for the quoted price. That is the error most likely to destroy trust in the
verdict.

Spec 001 framed asking-price valuation as a temporary bridge until eBay granted Marketplace
Insights access. As of 2026-09-19 that access is effectively unobtainable — eBay's own API page
states the Limited Release is closed to new users, and developer reports indicate access is
restricted to major partners. **Asking-price data is the permanent basis, not a bridge.** A known
permanent bias deserves explicit correction rather than an indefinite wait.

This feature introduces a tunable **realization rate**: the fraction of the asking-price median an
item is expected to actually sell for. It converts a knowingly optimistic number into a
deliberately centered one.

## Resolved Design Decisions

Clarified with the founder before planning:

1. **The valuation-basis label changes** from `ASKING_PRICE` to `ADJUSTED_ASKING_PRICE`. The label
   alone should tell a reader that an adjustment happened, rather than relying on them noticing a
   separate rate field. It reads `ADJUSTED_ASKING_PRICE` whenever the value passed through the
   correction step — including at a rate of 1.0, because the identity case is still the adjusting
   pipeline, and a label that flickers between two values based on config would be harder to
   reason about than a constant one.
2. **Both the raw median and the corrected value are exposed.** Recovering the raw figure by
   dividing the corrected one is lossy once rounding is applied, and the raw median is precisely
   what a future calibration process must compare user-reported sale prices against. Carrying both
   makes the flywheel straightforward instead of archaeological.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Aspirational asking prices stop producing false FLIPs (Priority: P1)

A reseller scans a paperback whose cheapest active listings ask around $18. After fees and
shipping, the raw math says the profit clears their $10 threshold, so today the app says FLIP. In
reality books like this change hands closer to $14, which puts the item under the threshold. With
the correction applied, the app says RIP and saves them the listing effort.

**Why this priority**: This is the entire point of the feature — removing a known, one-directional
bias from every verdict the product issues. Without it, the tool is confidently wrong in a
predictable direction on exactly the borderline items where the user most needs an answer.

**Independent Test**: Run a valuation whose raw median sits just far enough above the threshold to
FLIP, confirm the corrected value drops it below the threshold and the verdict becomes RIP, and
confirm an item well above the threshold still FLIPs.

**Acceptance Scenarios**:

1. **Given** an item whose profit clears the threshold only because of the uncorrected median,
   **When** the verdict is computed with the correction applied, **Then** the estimated value is
   lower, the profit is lower, and the verdict is RIP.
2. **Given** an item whose profit clears the threshold comfortably even after correction, **When**
   the verdict is computed, **Then** the verdict remains FLIP.
3. **Given** any valuation, **When** the estimated value is computed, **Then** the value used for
   the profit math and the value reported to the user are the same corrected number — they never
   disagree.

---

### User Story 2 - The number stays honest about what it is (Priority: P2)

The response has always declared its valuation basis so nobody mistakes an asking-price estimate
for real sold data. The reported value is now neither a raw asking price nor a sold price — it is
an adjusted projection — and the labeling has to say so rather than continuing to describe it as a
plain asking-price median.

**Why this priority**: Constitution Principle I requires valuation honesty. A silently adjusted
number is arguably *less* honest than an openly optimistic one, because the user can no longer tell
what they are looking at. Ranked below P1 because it is a labeling concern rather than a decision-
quality one.

**Independent Test**: Inspect any lookup response and confirm it identifies the value as
correction-adjusted and exposes the rate that was applied.

**Acceptance Scenarios**:

1. **Given** any lookup response, **When** a realization rate has been applied, **Then** the
   response identifies the value as an adjusted estimate rather than a raw asking-price median.
2. **Given** any lookup response, **When** it is inspected, **Then** the realization rate that
   produced the number is visible, so the figure can be reconstructed and audited.

---

### User Story 3 - The rate can be tuned and later calibrated (Priority: P3)

The founder picks the starting rate from judgment, not data. Once users begin reporting what items
actually sold for, that guess should be replaceable with a measured value — without a code change,
and ideally per-category rather than one global number.

**Why this priority**: The rate is a guess on day one, and a guess that cannot be corrected is a
liability. This is P3 because the calibration *data* does not exist yet — only the ability to
retune must exist now.

**Independent Test**: Change the configured rate, restart, and confirm verdicts shift accordingly
with no code modification.

**Acceptance Scenarios**:

1. **Given** a different configured realization rate, **When** the same item is valued, **Then**
   the estimated value and verdict reflect the new rate with no code change.
2. **Given** a configured rate outside the sensible range, **When** the service starts, **Then** it
   falls back to the documented default rather than producing nonsensical valuations.

---

### Edge Cases

- **No market data** (`sampleSize == 0`): the estimate is already 0; applying the rate leaves it 0
  and MUST NOT change the existing no-market-data outcome.
- **Rate of exactly 1.0**: a legitimate configuration meaning "no correction." Values and verdicts
  MUST match today's exactly, and the raw and corrected values MUST be equal. This is the escape
  hatch if the founder decides the correction is wrong.
- **Very small values**: rounding the corrected value MUST keep it a whole number of cents and MUST
  NOT produce a negative value.
- **Interaction with the liquidity gate**: a lower corrected value means lower profit, so some
  items previously landing on the favorable side of the gate's margin split will now land below it.
  This is intended, not a regression — but it means the gate's behavior shifts as a side effect and
  should be verified, not assumed.
- **Fees follow the corrected value**: marketplace fees are charged on the actual sale price, so
  they MUST be computed from the corrected value, not the raw median. Computing fees on the raw
  median would overstate costs on top of an already-reduced value, double-penalizing the item.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: The system MUST apply a configurable realization rate to the asking-price median to
  produce the estimated value, replacing today's implicit 1.0 multiplier.
- **FR-002**: The corrected value MUST be the single value driving every decision and display —
  profit math, threshold comparison, liquidity gate, and the figure reported to the user as the
  item's value. No uncorrected value may drive a verdict or be presented as the item's worth. The
  raw median is exposed alongside it for audit and future calibration only (FR-009), never as the
  headline figure.
- **FR-003**: Marketplace fees MUST be computed from the corrected value, not the raw median.
- **FR-004**: The realization rate MUST be configurable without a code change, following the
  existing environment-variable pattern, and MUST fall back to the documented default when the
  configured value is missing or outside the sensible range.
- **FR-005**: A rate of exactly 1.0 MUST reproduce current **values and verdicts** exactly, giving
  the founder a clean way to disable the correction. This applies to the numbers, not the basis
  label: the label still reads `ADJUSTED_ASKING_PRICE` at a rate of 1.0, per Resolved Decision 1.
- **FR-006**: The correction MUST NOT alter the no-market-data outcome: an empty price sample still
  yields a zero value and the existing no-market-data verdict and reason.
- **FR-007**: Every lookup response MUST report its valuation basis as `ADJUSTED_ASKING_PRICE`,
  replacing `ASKING_PRICE`, so the label itself discloses that a correction was applied.
- **FR-008**: Every lookup response MUST expose the realization rate that was applied, so any
  reported figure can be reconstructed and audited.
- **FR-009**: Every lookup response MUST expose the raw, uncorrected asking-price median alongside
  the corrected value, so future calibration can compare real sale outcomes against the unadjusted
  figure without lossy reconstruction. The corrected value remains the one the verdict is based on
  and the one intended for display.
- **FR-010**: The correction MUST NOT introduce any new external API calls; it operates purely on
  price data the valuation step already retrieved.

### Key Entities

- **Realization Rate**: the configured fraction of the asking-price median an item is expected to
  sell for. A dimensionless ratio, not a money value.
- **Valuation** *(extended)*: the estimated value, now correction-adjusted, carrying alongside it
  the raw asking-price median it was derived from, the rate that produced it, and a basis label of
  `ADJUSTED_ASKING_PRICE`.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: For any item, the reported estimated value equals the asking-price median multiplied
  by the configured rate, rounded to whole cents, in 100% of cases.
- **SC-002**: Items that previously cleared the profit threshold only by a margin smaller than the
  correction now verdict as RIP, removing the false-FLIP band attributable to the configured rate.
  (The correction shifts the FLIP boundary; false FLIPs vanish entirely only if the configured rate
  matches the true realization rate, which is why the rate must stay calibratable.)
- **SC-003**: Setting the rate to 1.0 reproduces pre-feature verdicts identically across the
  existing test suite.
- **SC-004**: The rate can be changed through configuration alone, with no source code change, and
  an out-of-range value degrades to the default rather than producing a nonsensical valuation.
- **SC-005**: Every response carries the raw median, the corrected value, and the rate that links
  them, so neither a user nor a future calibration process has to infer what adjustment was
  applied.
- **SC-006**: The feature adds zero additional external API calls per lookup.

## Assumptions

- **Default rate is 0.8** — a deliberate judgment call, not a measured figure, reflecting the
  typical gap between asking and realized prices. It is documented as a guess and expected to be
  replaced by measurement.
- **The rate is a single global value in this feature.** Per-category rates (books vs. games vs.
  electronics) are a plausible later refinement but are out of scope here, since no category-level
  outcome data exists to calibrate against and a per-category scheme without data would be
  false precision.
- **Calibration is out of scope.** This feature only ensures the rate is *retunable*. Actually
  measuring it requires user-reported sale outcomes, which depend on the post-MVP saved-inventory
  feature and a user base that does not exist yet.
- **Marketplace Insights remains unavailable.** If access is ever granted, true sold prices would
  supersede this correction entirely and the rate would drop to 1.0 or be removed.
- **The correction is applied to the sample median**, not to individual sample prices, keeping the
  existing median-of-lowest-N approach intact.
- No frontend exists yet; this spec covers API behavior and response shape only.
