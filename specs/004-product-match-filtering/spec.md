# Feature Specification: Product Match Filtering

**Feature Branch**: `004-product-match-filtering`

**Created**: 2026-09-20

**Input**: User description: "Title searches value the wrong product — filter listings down to the item the user actually meant before valuing them."

## Background

On 2026-09-20 the pipeline ran against the real eBay production API for the first time. A barcode
lookup behaved well: ISBN `9780345391803` matched *The Hitchhiker's Guide to the Galaxy*, median
$7.97, verdict RIP — correct item, plausible price, right answer.

Both free-text title lookups valued **the wrong product entirely**:

| Query | What was valued | Raw median | Reality |
|---|---|---|---|
| "Chrono Trigger SNES cartridge" | *SNES Cartridge Keychain / 3D Printed Fan Art* | $12.00 | Real cart: $50-100+ |
| "Nintendo Switch OLED console" | *Carrying Case Bag For Nintendo Switch* | $3.99 | Console: ~$300 |

This is structural, not bad luck. Valuation takes the median of the **ten lowest** asking prices.
A barcode constrains results to one product; a free-text query returns everything sharing keywords
— stickers, magnets, mousepads, manuals, empty boxes, carrying cases. Sorting by price ascending
and taking the cheapest ten therefore *guarantees* landing on accessories and never on the item.
Inspection of the live response confirmed all eight cheapest "Chrono Trigger SNES" listings were
merchandise: two Video Game Merchandise, two Refrigerator Magnets, one Decals & Stickers, two
Mouse Pads, and one miscategorized keychain.

Two consequences make this urgent:

- **It produces confident, wrong RIPs.** A user is told their $100 game is worth $12 and told to
  donate it. That is worse than no answer, and it is the opposite of the false-FLIP problem spec
  003 addressed.
- **It inverts spec 003's correction.** The realization rate assumes asking prices are biased
  *high*. Accessory contamination makes title estimates drastically *low*, so the 0.8 haircut
  compounds the error instead of correcting it.

Critically, the data needed to fix this is **already in the response we fetch**: every listing
carries its own category and condition. No additional marketplace calls are required.

### What was tested and rejected

Two richer approaches were probed against live data on 2026-09-20 and **do not work**. Recorded so
they are not re-attempted:

- **Price clustering to separate variants.** Category-filtered "Chrono Trigger SNES" returns a
  continuous $3-25 smear with no separable gaps. Within it: Japanese Super Famicom imports, several
  *entirely different games* matching on generic keywords (Sword World, Donkey Kong, Space Ace),
  multi-game lots, and junk-condition carts. US cartridges sit at $240+, outside the window
  entirely. There is no structure for clustering to grip.
- **Catalog product IDs (EPIDs).** Only 10 of 50 title results carried one, and the dominant EPID
  resolved to the *complete-in-box* variant — median $799 against a loose cart's ~$60. Precise, but
  precisely the wrong variant, turning a $12 under-valuation into an $800 over-valuation.

The signal that separates a US cart from a Japanese import lives in free-text listing titles.
Extracting it reliably means per-category keyword engineering, which is out of scope here.

## Resolved Design Decisions

Clarified with the founder before planning:

1. **Barcode lookups bypass the filter entirely.** They are already constrained to one product by
   the marketplace and verified correct against live data. Nothing that currently works is put at
   risk to serve the path that does not.
2. **The price sample is drawn from a typical/central band** of the matched listings rather than
   the lowest ones. Drawing from the lowest is what made accessory contamination fatal. **This
   improves the estimate but does not solve variant contamination** — a central band of the above
   data still yields the Japanese import price, not a US cart. Honest confidence signalling, not a
   better point estimate, is what makes that acceptable.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - A title search values the actual item (Priority: P1)

A reseller without a scannable barcode types "Chrono Trigger SNES". Today the app values a $12
keychain and says RIP. It should recognise that the overwhelming majority of matching listings are
video games, ignore the stickers and mousepads, and value the game.

**Why this priority**: The app currently gives confidently wrong advice on the entire non-barcode
path. A wrong number presented with the same authority as a right one is the fastest way to lose a
user's trust permanently.

**Independent Test**: Run a title lookup whose result set is dominated by one product category
mixed with cheap accessories, and confirm the valuation reflects the dominant product rather than
the accessories.

**Acceptance Scenarios**:

1. **Given** a title search returning a mix of genuine products and cheaper accessories, **When**
   the item is valued, **Then** the estimate reflects the dominant product and excludes the
   accessories.
2. **Given** a barcode lookup that already resolves to a single product, **When** the item is
   valued, **Then** the result is unchanged from today's correct behaviour.
3. **Given** a result set containing a single miscategorized listing, **When** the item is valued,
   **Then** that one outlier does not change which product is treated as the match.

---

### User Story 2 - The user can tell how confident the match is (Priority: P2)

Because the app is guessing which product a phrase refers to, it will sometimes guess wrong. The
user needs to see what was matched and how strong that match was, so a bad guess is visible rather
than silently priced.

**Why this priority**: Matching is inherently probabilistic for free text. Making the guess visible
is what separates a tool that is occasionally wrong from one that is untrustworthy. `matchedTitle`
already exists for this purpose and proved its worth — it is how the keychain problem was spotted.

**Independent Test**: Inspect responses for a clean single-product query and for a heterogeneous
query, and confirm the reported match confidence differs appropriately.

**Acceptance Scenarios**:

1. **Given** any valued lookup, **When** the response is returned, **Then** it reports what product
   the valuation is based on and how dominant that match was within the result set.
2. **Given** a result set with no dominant product, **When** the lookup is processed, **Then** the
   response makes the low confidence explicit rather than presenting a figure with unwarranted
   authority.

---

### User Story 3 - Contaminated valuations stop reaching the verdict (Priority: P3)

Even with filtering, some queries are too ambiguous to value honestly. The verdict pipeline should
not dress up a number it does not believe.

**Why this priority**: A safety net beneath US1 and US2. Lower priority because good filtering
should make this rare, but without it the failure mode is silent and confident.

**Independent Test**: Submit a deliberately ambiguous query and confirm the response does not
present a confident FLIP or RIP.

**Acceptance Scenarios**:

1. **Given** a lookup where no product match can be determined with confidence, **When** the
   verdict is computed, **Then** the response communicates that rather than issuing a confident
   verdict.

---

### Edge Cases

- **Barcode lookups**: bypass the filter entirely (Resolved Decision 1) — already constrained to
  one product by the marketplace and verified correct against live data.
- **Single miscategorized listing**: a keychain filed under a coin category appeared in live data.
  Choosing the match by dominance MUST tolerate individual mislabelled listings.
- **Legitimately cheap variants**: observed in live data — category-filtered results were almost
  entirely Japanese Super Famicom imports at $6-25, while US cartridges sit at $240+. Same
  category, materially different product. Filtering by category does not separate them, and this
  feature does not attempt to. The correct response is a low-confidence signal, not a number
  presented with false authority.
- **Unrelated items sharing generic keywords**: live data returned Sword World, Donkey Kong and
  Space Ace cartridges for a Chrono Trigger query, plus multi-game lots and bundles. These survive
  category filtering and are a direct contributor to result-set heterogeneity.
- **Genuinely ambiguous queries** (e.g. "Nintendo"): no dominant product exists; the honest answer
  is low confidence, not a number.
- **Small result sets**: with only a handful of listings, dominance is weak evidence; confidence
  should reflect that.
- **No market data**: the existing empty-sample behaviour MUST be unchanged.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: The system MUST determine which product a set of matching listings is predominantly
  about, and value only the listings belonging to that product group.
- **FR-002**: Listings outside the matched product group (accessories, merchandise, manuals,
  cases) MUST be excluded from the price sample.
- **FR-003**: The match determination MUST tolerate individual miscategorized listings — one
  mislabelled listing MUST NOT change the outcome.
- **FR-004**: The system MUST NOT make additional marketplace API calls to achieve this; it MUST
  operate on data already present in the existing search response (constitution III).
- **FR-005**: Barcode-based lookups MUST bypass product-match filtering entirely and produce
  results identical to today's, including the marketplace query used to obtain them. The path that
  already works is not put at risk to serve the path that does not.
- **FR-006**: Every response MUST report what product the valuation was based on and how dominant
  that match was within the result set.
- **FR-007**: When no product match can be determined with confidence, the response MUST make that
  explicit rather than presenting an estimate with unwarranted authority.
- **FR-008**: The price sample MUST be drawn from a typical/central band of the matched listings
  rather than from the lowest-priced ones, since drawing from the lowest is what made accessory
  contamination fatal.
- **FR-009**: The valuation honesty labelling established in prior specs MUST continue to hold —
  the response must not imply more certainty about the match than the evidence supports.
- **FR-010**: The system MUST assess how heterogeneous the matched listing set is — widely varying
  prices and dissimilar titles indicate the query has pulled in multiple distinct products — and
  MUST lower the reported match confidence accordingly, independent of whether a dominant category
  was found.

### Key Entities

- **Product Match**: the determination of which product a result set is about, the share of
  listings supporting it, and whether that share is strong enough to value confidently.
- **Valuation** *(extended)*: now derived only from listings belonging to the matched product,
  carrying the match and its confidence alongside the existing figures.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: For the live failure cases that motivated this feature ("Chrono Trigger SNES",
  "Nintendo Switch OLED console"), the valued listings are genuine instances of the product rather
  than merchandise, cases, magnets or stickers — verified against real marketplace data. Note this
  criterion is deliberately about *excluding accessories*, not about arriving at the price of any
  particular variant, which this feature does not attempt.
- **SC-002**: Accessory and merchandise listings contribute zero entries to the price sample when a
  dominant product group exists.
- **SC-003**: Barcode lookups produce byte-identical results to before this feature, including for
  items that already valued correctly — verified by the pre-existing barcode tests passing
  unchanged.
- **SC-004**: Every response allows a user to see which product was valued and how strong the match
  was, without inspecting marketplace data themselves.
- **SC-005**: Queries with no dominant product return an explicit low-confidence signal rather than
  a confident verdict.
- **SC-006**: The feature adds zero additional marketplace API calls per lookup.
- **SC-007**: A single miscategorized listing in a result set does not change which product is
  matched.
- **SC-008**: A result set spanning a wide price range with dissimilar titles — the live "Chrono
  Trigger SNES" set being the reference case — is reported as low confidence even though a dominant
  category exists.

## Assumptions

- **Region and variant separation is out of scope**, and this is now an evidence-backed decision
  rather than a deferral: price clustering and EPID matching were both probed against live data and
  both fail (see "What was tested and rejected"). The remaining signal lives in free-text titles
  and needs per-category keyword work. Documented so it is not mistaken for solved.
- **Title-based lookups may never be better than a rough estimate with an explicit confidence
  caveat.** That is an acceptable outcome: it makes barcode-first a product commitment rather than
  an implementation convenience, which is the direction `docs/PROJECT_BRIEF.md` already leans.
- **Condition is out of scope** for this feature, though the data is available and is a plausible
  later refinement alongside variant separation.
- **The existing search response already carries per-listing category information** (verified
  against live production data on 2026-09-20), so no additional marketplace calls are needed.
- **Spec 003's realization rate remains in place unchanged by this spec**, but FR-008's resolution
  may reveal that its downward correction is inappropriate once the sample is drawn from correctly
  matched listings. If so, that is a follow-up to 003, not a change made here.
- No frontend exists yet; this covers API behaviour and response shape only.
