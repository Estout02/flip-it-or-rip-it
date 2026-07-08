# Feature Specification: Core Valuation Pipeline

**Feature Branch**: `001-valuation-pipeline`

**Created**: 2026-07-07

**Status**: Draft

**Input**: User description: "Core valuation pipeline (MVP spine): a user submits an item
identifier (UPC/ISBN/EAN from a barcode scan, or a free-text title) plus optional cost basis
(default $0, decluttering use case) and optional per-request profit threshold (default $10).
The system resolves the identifier, queries eBay for pricing (sandbox; active-listing prices
as the compliant fallback — no Marketplace Insights sold-data access yet), estimates shipping,
computes profit = value − eBay fees (~13.25%) − shipping − cost basis, and returns a FLIP or
RIP verdict with estimated value, fees, shipping estimate, profit, liquidity score (degraded
to supply-side-only signal without sold data), sample size, and a flag noting the valuation
is asking-price-based. Replaces the stubbed lookup with real eBay sandbox integration and
identifier resolution, keeping identify → value → ship-estimate → verdict as separate steps."

## Clarifications

### Session 2026-07-07

- Q: What per-client daily lookup cap should FR-012 enforce? → A: 50 lookups per client per day
- Q: Are title-only lookups cached, and under what key? → A: Yes — cached by normalized title (lowercased, trimmed, whitespace-collapsed), same ~24h window as identifier-keyed entries
- Q: What flat shipping estimate does MVP use? → A: $5.00 flat (typical Media Mail + packaging for the media sweet spot), configurable
- Q: How many listings feed the valuation estimate? → A: Median of the 10 lowest-priced matching listings (fewer if fewer exist, reported via sample size)

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Scan a barcode, get a verdict (Priority: P1)

A reseller decluttering their house scans the barcode on a DVD, book, or video game. The app
submits the UPC/ISBN/EAN and, within seconds, shows a verdict — **FLIP IT** (worth selling) or
**RIP IT** (donate/recycle) — along with the estimated value, expected fees, shipping estimate,
projected profit, a liquidity signal, and how many listings the estimate is based on.

**Why this priority**: This is the product. Barcode-scannable media is the declared sweet spot,
and the scan-to-verdict loop is the entire MVP value proposition. Nothing else matters if this
doesn't work.

**Independent Test**: Submit a known product identifier to the lookup endpoint and verify a
complete verdict payload comes back with real (sandbox) marketplace pricing — no stubbed
numbers — in under the latency target.

**Acceptance Scenarios**:

1. **Given** a valid UPC/ISBN/EAN that matches products with active marketplace listings,
   **When** the user submits it, **Then** the system returns a FLIP or RIP verdict with
   estimated value, fees, shipping estimate, profit, liquidity score, sample size, and an
   indicator that the valuation is based on asking prices (not sold prices).
2. **Given** an identifier whose computed profit meets or exceeds the profit threshold,
   **When** the lookup completes, **Then** the verdict is FLIP.
3. **Given** an identifier whose computed profit falls below the profit threshold,
   **When** the lookup completes, **Then** the verdict is RIP.
4. **Given** a valid identifier that matches no products or no active listings,
   **When** the user submits it, **Then** the system returns a RIP verdict with zero value, a
   sample size of zero, and a clear indication that no market data was found (no error, no
   crash — "no market" is a legitimate answer meaning don't waste time listing it).

---

### User Story 2 - Look up an item by name (Priority: P2)

An item has no barcode (or the barcode won't scan), so the user types a short title like
"Chrono Trigger SNES". The system searches the marketplace by title and returns the same
verdict payload as a barcode lookup.

**Why this priority**: Covers the large class of items without scannable codes. Same pipeline,
different entry point — valuable but secondary to the barcode sweet spot.

**Independent Test**: Submit a free-text title with no identifier and verify a complete verdict
payload derived from marketplace search results for that title.

**Acceptance Scenarios**:

1. **Given** a free-text title that matches active listings, **When** the user submits it,
   **Then** the system returns the full verdict payload, identical in shape to a barcode lookup.
2. **Given** a request containing neither an identifier nor a title, **When** it is submitted,
   **Then** the system rejects it with a clear validation message and makes no external calls.
3. **Given** both an identifier and a title in one request, **When** the lookup runs, **Then**
   the identifier takes precedence (it is the more precise match) and the title is used as a
   fallback if the identifier resolves to nothing.

---

### User Story 3 - Real profit for serious sellers (Priority: P3)

A user who bought inventory (e.g., a $5 thrift-store find) enters their cost basis and their
own profit threshold. The verdict reflects *their* economics: profit is computed net of what
they paid, and the FLIP/RIP cutoff honors their per-request threshold instead of the default.

**Why this priority**: The default decluttering case (cost $0, $10 threshold) works without any
of this. Cost basis and custom thresholds serve the serious-seller segment and underpin the
future paid tax-tracking feature, but they're refinements of an already-working verdict.

**Independent Test**: Run the same item through the pipeline with different cost bases and
thresholds and verify the profit figure and verdict flip accordingly.

**Acceptance Scenarios**:

1. **Given** an item worth $20 net of fees and shipping, **When** the user submits it with a
   $15 cost basis, **Then** profit reflects the $15 deduction and the verdict is RIP under the
   default $10 threshold.
2. **Given** the same item with no cost basis provided, **When** the lookup runs, **Then** cost
   basis defaults to $0 and the verdict is FLIP.
3. **Given** a per-request profit threshold of $2, **When** an item nets $5 profit, **Then**
   the verdict is FLIP even though it would be RIP under the $10 default.

---

### Edge Cases

- **Identifier matches multiple distinct products**: the system uses the best product match
  (most relevant per the marketplace's product catalog) and includes the matched product's
  title in the response so the user can spot a mismatch.
- **Marketplace unavailable or rate-limiting us (429/5xx)**: the system backs off, does not
  retry in a tight loop, and returns a clear "try again shortly" error to the user — never a
  silent wrong verdict.
- **Malformed identifier** (wrong length/characters for UPC/ISBN/EAN): rejected with a
  validation message before any external call is made.
- **Nonsensical or extremely vague title** ("stuff", single letter): the lookup proceeds, but
  a tiny or wildly dispersed sample yields a low-confidence result — sample size and liquidity
  signal make this visible to the user.
- **Negative cost basis or negative threshold**: rejected as validation errors.
- **Very high active supply, low price**: liquidity signal (supply-side-only) is low, response
  flags the weak signal; verdict math already pushes toward RIP.
- **Repeated scans of the same product** (e.g., the 50th person scanning the same DVD today):
  served from the cached valuation — instant answer, zero additional external calls.
- **Daily external-call quota approaching exhaustion**: the system tracks consumption, serves
  what it can from cache, and degrades with a clear "temporarily unavailable" error rather
  than blowing through the quota.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: System MUST accept a lookup request containing an item identifier (UPC, ISBN, or
  EAN) and/or a free-text title, plus an optional cost basis (default: $0) and an optional
  profit threshold (default: the configured application default, $10).
- **FR-002**: System MUST reject requests that contain neither an identifier nor a title, and
  requests with negative cost basis or negative threshold, with descriptive validation errors
  and without making any external calls.
- **FR-003**: System MUST resolve a product identifier to a product identity (canonical title,
  matched product reference) and fall back to title-based search when identifier resolution
  yields nothing.
- **FR-004**: System MUST obtain current marketplace pricing for the matched product from the
  official eBay developer interfaces only, called server-side, against the sandbox environment
  during development — never by scraping and never from user devices (constitution, Principle I).
- **FR-005**: Until sold-listings access is granted, System MUST derive estimated value from
  *active* listings (asking prices) as the median of the 10 lowest-priced matching listings
  (or all of them when fewer than 10 exist, with the actual count reported as the sample size)
  and MUST label every such valuation as asking-price-based in the response.
- **FR-006**: System MUST estimate shipping cost for the item and include it in the profit
  computation and the response. MVP uses a configurable flat estimate of $5.00 (typical Media
  Mail + packaging for the media sweet spot); the estimate must be a distinct pipeline step so
  it can be upgraded (e.g., weight- or category-based) without touching other steps.
- **FR-007**: System MUST compute projected profit as: estimated value − marketplace fees
  (default rate ~13.25% of value) − shipping estimate − cost basis.
- **FR-008**: System MUST return verdict FLIP when profit meets or exceeds the applicable
  threshold and market data exists; otherwise RIP. Zero market data always yields RIP with an
  explicit no-market-data indication.
- **FR-009**: Every verdict response MUST include: the verdict, estimated value, fees, shipping
  estimate, profit, liquidity score, sample size (number of listings behind the estimate), the
  asking-price-based flag, and the matched product title.
- **FR-010**: Liquidity score MUST degrade gracefully without sold data: a supply-side-only
  signal (based on active listing volume) explicitly marked as supply-side-only in the response,
  so the client can render it honestly.
- **FR-011**: System MUST cache valuations for approximately 24 hours, keyed by product
  identifier for identifier lookups and by normalized title (lowercased, trimmed, whitespace
  collapsed) for title-only lookups; a cache hit MUST serve the verdict with zero external
  marketplace calls (constitution, Principle III).
- **FR-012**: System MUST enforce a per-client lookup cap of 50 lookups per client per day
  (keeping aggregate usage well under the marketplace's 5,000-calls/day application quota),
  rejecting over-cap requests with a clear limit-reached error, and MUST respond to marketplace
  rate-limit signals (429) by backing off rather than retrying immediately.
- **FR-013**: All monetary amounts MUST be expressed as integer cents in code and in request
  and response payloads (fields suffixed `Cents`); conversion to dollars happens only at the
  display edge, i.e., in a future frontend (constitution, Principle VI).
- **FR-014**: The pipeline MUST remain four separable steps — identification → valuation →
  shipping estimate → verdict — with explicit inputs and outputs per step, so post-MVP features
  can hook in after the verdict (constitution, Principle VII).
- **FR-015**: When the marketplace is unreachable or quota-exhausted and no cached valuation
  exists, System MUST return a clear temporary-failure error distinct from a "no market data"
  RIP verdict.

### Key Entities

- **Lookup Request**: what the user submits — identifier (UPC/ISBN/EAN) and/or title, optional
  cost basis, optional profit threshold.
- **Product Identity**: the resolved product — canonical title, the identifier that matched,
  and a reference to the marketplace's product record when one exists.
- **Valuation**: estimated value, sample size, pricing basis (asking-price vs. sold), the set
  of listing prices considered, and the time it was computed (drives the ~24h cache).
- **Verdict Result**: the full response payload — verdict, value, fees, shipping, profit,
  liquidity score + signal basis, sample size, pricing-basis flag, matched product title.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: A fresh (uncached) lookup returns a complete verdict in under 3 seconds; the
  overall scan-to-verdict experience beats a manual eBay-app sold-listings check (~1–2 minutes)
  by at least 10×.
- **SC-002**: A repeat lookup of the same product within 24 hours returns in under half a
  second and consumes zero external marketplace calls.
- **SC-003**: 100% of valuations produced without sold-listings access carry the
  asking-price-based flag and the supply-side-only liquidity marker.
- **SC-004**: Aggregate external marketplace calls stay below 50% of the 5,000/day application
  quota during normal MVP usage, verifiable from consumption tracking.
- **SC-005**: Given identical market data, the verdict is deterministic and correct against the
  profit formula in 100% of automated test cases, including threshold-boundary cases (profit
  exactly at threshold → FLIP).
- **SC-006**: Invalid requests (no identifier/title, negative amounts, malformed identifiers)
  are rejected with descriptive errors and generate zero external calls in 100% of cases.

## Assumptions

- **Fee model**: a single flat final-value fee rate (~13.25%, the typical media-category rate)
  is acceptable for MVP; per-category fee schedules are a later refinement. The rate stays
  configurable.
- **Shipping estimate**: MVP uses a configurable $5.00 flat estimate (media items ship cheap
  and predictably via Media Mail — the core use case). Weight- or category-based estimation is
  a later upgrade slot in the pipeline; item weight is not collected yet.
- **Per-client caps without accounts**: there are no user accounts in MVP, so the per-user
  lookup cap is enforced per client (e.g., by network origin). Real per-user caps arrive with
  accounts in a later phase.
- **Sandbox data quality**: the eBay sandbox contains sparse, fake listings, so end-to-end
  tests validate pipeline behavior and payload shape, not real-world price accuracy. Accuracy
  validation happens when the integration flips to production keys.
- **Marketplace scope**: US marketplace (ebay.com), USD only, for MVP.
- **Verdict math is settled**: the existing, tested verdict computation (median value, integer
  cents, liquidity score, threshold comparison) is the accepted definition of the profit/verdict
  step; this feature feeds it real inputs rather than redefining it.
- **Out of scope** (explicit): user accounts/authentication, per-user eBay account linking
  (OAuth, phase 2), photo/vision-LLM identification (economics-gated), auto-listing/drafts,
  saved inventory, gamification, sold-listings data (blocked on Marketplace Insights approval).
