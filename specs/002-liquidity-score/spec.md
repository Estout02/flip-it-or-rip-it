# Feature Specification: Liquidity-Gated Verdict

**Feature Branch**: `002-liquidity-score`

**Created**: 2026-09-19

**Status**: Draft

**Input**: User description: "lets build out the liquidity score feature"

## Background

Spec 001 already computes a supply-side-only liquidity score (`min(1, 10 / activeListingCount)`,
0 when there are no active listings) and returns it in every lookup response alongside the
verdict, labeled `liquidityBasis: SUPPLY_SIDE_ONLY`. Today that score is **informational only** —
it has no effect on whether the verdict is FLIP or RIP, which is decided purely by
`profit >= threshold`.

`docs/PROJECT_BRIEF.md` calls this out explicitly as an MVP requirement, not a nice-to-have:

> Raw price lies. A book "worth" $150 with one sale ever and hundreds of active listings has no
> liquidity. ... An awful liquidity score should push toward RIP even when price is high.

This feature closes that gap: the liquidity score actually gates the verdict, and the reason is
surfaced to the user in plain language.

## Resolved Design Decisions

These were clarified with the founder before planning and drive the requirements below:

1. **Zero active listings** (a valid price sample exists, but nobody else is currently listing the
   item) is its own category — **"unproven"** — distinct from both strong and weak liquidity. It
   does **not** gate the verdict either way; it only changes the label, so the reseller knows to
   use judgment rather than trusting a clean liquid/illiquid call.
2. **Liquidity tiers are count-based bands**, not a rescaled version of the existing 0-1 score:
   strong / moderate / weak, defined by configurable active-listing-count cutoffs.
3. **The verdict gets a third state, `FLIP_RISKY`**, for items that are profitable but land in the
   weak-liquidity tier — and which state a weak-liquidity item lands in depends on **how much**
   margin it has, not just whether it clears the threshold:
   - Comfortably above threshold (genuinely valuable) → `FLIP_RISKY` — worth listing and waiting
     out a slower sale.
   - Only marginally above threshold (a few dollars over) → `RIP` — not worth the hassle of a slow
     sale for a thin margin.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Oversaturated item is caught before listing (Priority: P1)

A reseller scans a collectible that's asking $150 on eBay, but hundreds of other sellers are also
listing it right now. Manually, this looks like a great flip. If the margin over their threshold is
thin, the app tells them RIP — the wait isn't worth it. If the margin is large even after fees and
shipping, the app instead tells them FLIP_RISKY — genuinely worth listing, just expect it to take
longer to sell than a scarce item would.

**Why this priority**: This is the specific failure mode the founder named as core to the product's
value — without it, the app gives confidently wrong advice on exactly the items where a manual
"looks profitable" glance is most misleading, and treats a $12-over-threshold oversaturated item
the same as a $200-over-threshold one.

**Independent Test**: Feed the verdict step a weak-liquidity active listing count at two profit
levels — one just over threshold, one comfortably over — and confirm the first resolves RIP and the
second resolves FLIP_RISKY.

**Acceptance Scenarios**:

1. **Given** an item in the weak liquidity tier with profit only marginally above the user's
   threshold, **When** the verdict is computed, **Then** the verdict is RIP.
2. **Given** an item in the weak liquidity tier with profit comfortably above the user's threshold,
   **When** the verdict is computed, **Then** the verdict is FLIP_RISKY.
3. **Given** an item in the strong or moderate liquidity tier with profit above the threshold,
   **When** the verdict is computed, **Then** the verdict is FLIP (unchanged from today).

---

### User Story 2 - User understands *why* it's RIP or FLIP_RISKY (Priority: P2)

A reseller sees a RIP or FLIP_RISKY verdict on an item that, price-wise, looked promising. They want
to know at a glance whether that's a value problem, a margin-too-thin problem, or a slow-sale
problem — those call for different reactions.

**Why this priority**: A bare non-FLIP result with no explanation erodes trust and looks like a bug
the first few times a user sees a high price paired with RIP or an unfamiliar FLIP_RISKY label. This
is what makes the P1 behavior legible rather than confusing.

**Independent Test**: Trigger each of the three liquidity-driven outcomes (RIP-for-thin-margin,
FLIP_RISKY, unaffected FLIP) and confirm each response includes a distinct plain-language reason.

**Acceptance Scenarios**:

1. **Given** a verdict downgraded from FLIP to RIP because of weak liquidity and thin margin,
   **When** the response is returned, **Then** it includes a reason distinguishing this from a
   plain profit-below-threshold RIP.
2. **Given** a FLIP_RISKY verdict, **When** the response is returned, **Then** it includes a reason
   noting the item is valuable but may take longer to sell due to competing supply.
3. **Given** a plain FLIP or a profit-driven RIP (liquidity was strong/moderate, or profit never
   cleared the threshold), **When** the response is returned, **Then** no liquidity-override reason
   is present.

---

### User Story 3 - Degraded signal stays honest (Priority: P3)

Until eBay grants Marketplace Insights access, the liquidity score is supply-side-only — it doesn't
know how often the item actually sells, only how many other people are also trying to sell it right
now. The founder wants that limitation to stay visible in the product, not get papered over once the
score starts affecting verdicts.

**Why this priority**: Constitution Principle I requires valuation honesty; letting the gate imply
more certainty than the underlying data supports would violate that even though it's not an eBay
compliance issue per se. Lower priority than P1/P2 because it's a labeling/trust concern, not a
core decision-quality one.

**Independent Test**: Inspect any response where liquidity affected the verdict and confirm the
`liquidityBasis` field still reads `SUPPLY_SIDE_ONLY` and the reason text does not claim knowledge
of actual sales.

**Acceptance Scenarios**:

1. **Given** any lookup response, **When** liquidity data is present, **Then** the response states
   the basis for the liquidity score (supply-side-only today) alongside the score and tier label.
2. **Given** an item with zero active listings and a valid price sample, **When** the verdict is
   computed, **Then** the liquidity tier label reads "unproven" (not "strong") and the verdict is
   decided purely by profit vs. threshold, unaffected by the liquidity gate.

---

### Edge Cases

- **Zero active listings, valid price sample**: labeled "unproven," never gates the verdict either
  way (Resolved Decision 1). Verdict follows profit vs. threshold only.
- **No market data at all** (`sampleSize == 0`): verdict is already RIP for this reason today (no
  evidence of value); the liquidity gate MUST NOT be the stated reason in this case — the existing
  "no market data" reason takes precedence over any liquidity reasoning.
- **Active listing count sits exactly at a tier boundary**: MUST resolve to the more-liquid side of
  the boundary (e.g., exactly at the strong/moderate cutoff counts as strong).
- **Weak liquidity with profit exactly at the risky-margin cutoff**: MUST resolve to FLIP_RISKY
  (the more-favorable side), consistent with the threshold boundary convention already used for
  FLIP/RIP (profit == threshold → FLIP, per spec 001 SC-005).
- **Moderate liquidity tier**: does not trigger the margin split — only the weak tier does. An
  item in the moderate tier with profit above threshold is a plain FLIP regardless of margin size.
- **Small price sample (1-2 listings) with low active count**: the liquidity tier reads strong even
  though confidence in the price itself is low; this is a separate concern from liquidity (already
  partially covered by `sampleSize`) and is out of scope for this feature.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: The verdict step MUST classify every result into one of four liquidity tiers based on
  active listing count alone: **strong**, **moderate**, **weak**, or **unproven** (zero active
  listings). When there is additionally no price sample, the no-market-data outcome outranks the
  tier, so the tier is still reported but never decides the verdict.
- **FR-002**: When liquidity is weak and profit clears the threshold only marginally, the verdict
  MUST be RIP instead of FLIP.
- **FR-003**: When liquidity is weak and profit clears the threshold comfortably (per a configurable
  margin cutoff), the verdict MUST be FLIP_RISKY instead of a plain FLIP.
- **FR-004**: Strong, moderate, and unproven tiers MUST NOT alter the verdict — it remains decided
  by profit vs. threshold alone, exactly as today.
- **FR-005**: The liquidity gate MUST be downgrade-only — it MUST NOT turn an unprofitable item
  (profit below threshold) into FLIP or FLIP_RISKY.
- **FR-006**: The tier boundaries (strong/moderate/weak active-listing-count cutoffs) and the
  risky-margin cutoff (how much above threshold counts as "comfortable") MUST be configurable via
  environment variables, following the existing `.env.example` pattern (e.g., alongside
  `PROFIT_THRESHOLD_DEFAULT`), not hardcoded literals.
- **FR-007**: Every lookup response MUST include: the numeric liquidity score (0-1, unchanged), the
  `liquidityBasis` flag (`SUPPLY_SIDE_ONLY` until Marketplace Insights access changes it), the
  liquidity tier label (strong/moderate/weak/unproven), and the verdict (`FLIP` / `FLIP_RISKY` /
  `RIP`).
- **FR-008**: When the liquidity gate changes the outcome from what profit alone would have
  produced (RIP-for-thin-margin or FLIP_RISKY), the response MUST include a plain-language reason
  distinct from the plain profit-below-threshold RIP reason.
- **FR-009**: The liquidity gate MUST NOT introduce any new eBay API calls — it operates only on
  data the valuation step already returns (`activeListingCount`, `sampleSize`, sample prices).
- **FR-010**: The liquidity gate logic MUST live entirely in the verdict step; identification,
  valuation, and shipping steps MUST remain unchanged, per the pipeline's step-boundary constraint.

### Key Entities

- **Liquidity Assessment**: the existing numeric score (0-1) and basis flag, plus a new tier label
  (strong / moderate / weak / unproven) derived from active listing count.
- **Verdict** *(extended)*: now a three-way result (`FLIP` / `FLIP_RISKY` / `RIP`) instead of
  binary, carrying an optional liquidity-override reason alongside the existing profit-driven
  reasoning.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: Items with thin margin over threshold and weak liquidity verdict as RIP in 100% of
  such cases (no false FLIPs driven purely by an inflated asking price with no realistic
  near-term sell-through).
- **SC-002**: Items with comfortable margin over threshold and weak liquidity verdict as
  FLIP_RISKY, never a plain unqualified FLIP, in 100% of such cases.
- **SC-003**: Every response where liquidity changed the outcome (RIP-for-thin-margin or
  FLIP_RISKY) includes a reason a non-technical user can read and immediately understand, distinct
  from the profit-only RIP reason.
- **SC-004**: Liquidity tier cutoffs and the risky-margin cutoff can be recalibrated by changing
  configuration values, with no source code change required.
- **SC-005**: The feature adds zero additional eBay API calls per lookup.
- **SC-006**: The full existing test suite continues to pass, and new tests cover every edge case
  listed above (all four tiers, both sides of the risky-margin split, tier and margin boundary
  values, no-market-data precedence).

## Assumptions

- Marketplace Insights (true sold-listings) access is still not granted; this feature works
  entirely from data already produced by the existing valuation step. The already-stubbed
  sell-through formula (`liquidityScore(soldCount, activeListingCount)` in `verdict.ts`) remains
  unused until that access lands, at which point it can replace the supply-side score behind the
  same tiering/gating logic without a spec change.
- Default tier cutoffs (tunable, not fixed by this spec): strong = active listing count ≤ 10
  (matches the existing `LIQUIDITY_STRONG_SUPPLY_MAX`), moderate = 11-50, weak = 51+.
- Default risky-margin cutoff (tunable): profit ≥ 2x the user's threshold counts as "comfortable"
  (→ FLIP_RISKY when weak); profit ≥ threshold but < 2x counts as "thin" (→ RIP when weak). The
  founder can retune this multiplier via configuration once real usage data exists.
- This feature changes how the liquidity score is *used* (gates the verdict) and *presented* (tier
  label, three-way verdict), not how the underlying 0-1 score is *computed* — the
  `supplySideLiquidity` formula itself is unchanged.
- No frontend exists yet (per current project state); this spec covers API behavior and response
  shape only. A future frontend will need to design around a three-way verdict instead of binary.
