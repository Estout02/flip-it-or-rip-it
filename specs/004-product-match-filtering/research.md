# Research: Product Match Filtering

Phase 0 decisions. No `NEEDS CLARIFICATION` remained in Technical Context — the two product-level
questions were resolved with the founder during `/speckit-specify`, and two further design avenues
were killed by live probing before planning began (spec.md, "What was tested and rejected").

---

## R1: Dominant **leaf category** decides the match

**Decision**: Group the returned listings by `leafCategoryIds[0]`, take the group holding the
largest share, and value only that group.

**Rationale**: Every item summary carries `leafCategoryIds` and `categories` — verified against
live production data. In the reference failure the eight cheapest listings were Video Game
Merchandise, Refrigerator Magnets, Decals & Stickers, Mouse Pads and one miscategorized keychain,
while the bulk of the 728 matches sat in Video Games. Dominance is therefore a strong separator of
"the thing" from "things about the thing", and a plurality vote is inherently tolerant of the
individual mislabelled listing that live data showed exists (FR-003, SC-007).

Leaf rather than top-level category: the top-level *Video Games & Consoles* (658 matches) still
contains Merchandise (50) and Manuals (34) beneath it, so grouping at the top would retain the
contamination this feature exists to remove.

**Alternatives considered**:

- *Catalog EPIDs*: covered only 10 of 50 live listings and resolved to the complete-in-box variant
  (median $799 against a loose cart's ~$60) — sparse and variant-locked.
- *Hardcoded junk-category denylist*: the set of accessory categories is unbounded, and live data
  already contained one accessory filed under a coin category. Unmaintainable.

---

## R2: Drop `sort=price` — it causes both failures

**Decision**: Remove `sort=price` from **title** (`q=`) searches and use eBay's default relevance
ordering. **GTIN searches keep `sort=price`.**

**Rationale**: This is the single highest-value change, because price-ascending ordering causes two
distinct failures at once.

1. **It poisons the sample.** Taking the ten cheapest guarantees accessories, which is the bug.
2. **It would poison the vote.** `limit=50` under price-ascending returns the *fifty cheapest*
   matches, which for a contaminated query skew heavily toward merchandise. A dominance vote over
   that set could elect the wrong category. Relevance ordering returns a far more representative
   fifty — the live probe's top results under relevance were genuine cartridges ($285, $63) where
   the price-sorted top was stickers and magnets.

Since FR-008 moves the estimate to a central band, nothing depends on price ordering any more —
**for title searches**. GTIN searches are a different case: they bypass filtering entirely and keep
taking the cheapest listings, so removing their sort would change which fifty listings they see and
therefore their median, breaking FR-005 and SC-003 on the one path that already works. The sort is
removed only where it causes harm. The existing defensive client-side sort in `valuation.ts`
continues to handle ordering where needed.

**Alternatives considered**: keeping `sort=price` and raising `limit` to see more of the
distribution — costs more payload, still skews the vote, and eBay caps the page size anyway.

---

## R3: No second call for category refinements

**Decision**: Never call `fieldgroups=CATEGORY_REFINEMENTS`.

**Rationale**: It looks like the natural way to discover the right category, and it is a trap. The
live probe showed it returns the category distribution **and zero items**, so using it means one
call to learn the category and a second to fetch listings — doubling per-lookup marketplace cost
against a 5,000/day quota, in direct tension with constitution III. Per-listing categories make it
unnecessary. Recorded explicitly so this is not "optimised" back in later.

---

## R4: Central band = median of the matched group

**Decision**: Estimate from the median of *all* matched listings, replacing "median of the ten
lowest".

**Rationale**: The median is already the central-band statistic and is inherently outlier-robust,
so it absorbs the multi-game lots at the top and junk-condition carts at the bottom that live data
showed survive category filtering. It also reuses `estimateValueCents` unchanged — only its *input*
changes, from ten cheapest to all matched. Sample size improves from ≤10 to ≤50, which makes the
median more stable.

**Alternatives considered**: trimmed mean or interquartile median. Both are more aggressive against
outliers but add a tunable trimming threshold, and there is no outcome data to tune it against.
Premature; revisit if real usage shows the median is being dragged.

---

## R5: Two independent confidence signals

**Decision**: Report `matchConfidence` as `HIGH` / `MEDIUM` / `LOW`, derived from two separate
measures:

- **Dominance** — the matched group's share of returned listings.
- **Dispersion** — the price spread *within* the matched group, as an interquartile ratio
  (p75 / p25).

**Rationale**: FR-010 exists because the reference case has a *dominant category and is still
unusable*: category-filtered Chrono Trigger listings span $6-25 for Japanese imports while US carts
sit at $240+, and unrelated games and multi-game lots survive filtering. Dominance alone would call
that a confident match. Dispersion catches exactly the "several different products in one group"
condition that dominance cannot see.

An interquartile ratio is preferred over standard deviation or min/max: it is scale-free (so one
threshold works for $5 books and $500 consoles) and robust to the single extreme listing.

**Alternatives considered**: title-similarity clustering. The signal genuinely lives in titles, but
extracting it means tokenising free text and per-category keyword work — brittle, unbounded, and
explicitly out of scope per the spec.

---

## R6: `UNCERTAIN` becomes a fourth verdict state

**Decision**: When `matchConfidence` is `LOW`, the verdict is `UNCERTAIN`, carrying a reason code
and the usual figures for transparency.

**Rationale**: FR-007 and US3 require the response not to present an estimate with unwarranted
authority. The alternatives are worse:

- *Keep FLIP/FLIP_RISKY/RIP and rely on a separate confidence field*: a consumer reading `verdict`
  alone — which is the entire point of the product — gets a confident answer we do not believe.
- *Return `RIP` when uncertain*: states "not worth selling" when the truth is "we could not
  identify your item". That is a lie, and the RIP branch is exactly where a mis-identified valuable
  item would land.

A fourth state has real cost for a future frontend, but it is an honest cost, and no consumer
exists yet. `UNCERTAIN` is evaluated **before** the liquidity gate: a verdict we cannot trust the
inputs to should not then be reasoned about as though we could.

---

## R7: Bypass keys on the search that ran, not the query kind

**Decision**: Filtering is skipped only when the valuation was produced by a **GTIN** search.
`ItemQuery.kind` alone is insufficient.

**Rationale**: A latent trap. `computeValuation` falls back to a title search when a barcode
returns nothing (`valuation.ts`, the FR-003 fallback from spec 001). Keying the bypass on
`query.kind === 'gtin'` would hand a *title* result set the barcode's trust and skip filtering on
the one path that most needs it — a barcode for an obscure item, which is precisely when the
fallback fires. The valuation step must record which search actually produced the listings and
decide from that.

---

## R8: Category data is transported, not interpreted, by the client

**Decision**: `ListingSummary` gains the leaf category id and name; `browse.ts` extracts them; all
interpretation happens in `valuation.ts`.

**Rationale**: Constitution VII. The eBay client's job is to turn wire format into our types; the
decision about which listings represent the item is a valuation concern and is made in exactly one
place. This also keeps the fake client used in tests trivially able to express contaminated result
sets.

---

## R9: Cache and config

**Decision**: The matched group, confidence and supporting figures are computed at valuation time
and cached with the `Valuation`. Thresholds come from config via the established env pattern.

**Rationale**: Unlike the liquidity gate (per-request threshold) and like the realization rate,
nothing here depends on per-request input — grouping is a property of the result set alone, so it
is safe to cache. Threshold changes require a restart, which discards the in-memory cache, so no
cached entry can outlive the configuration that produced it.
