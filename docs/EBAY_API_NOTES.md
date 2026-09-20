# eBay Data Access — Compliance & Strategy

*Researched 2026-07-07. Governs how this app talks to eBay. The founder's #1 operational fear is
getting his eBay/developer account or IP banned — everything here is designed around that.*

## Hard rules (non-negotiable)

1. **Never scrape eBay pages.** No fetching `ebay.com/sch/...` sold-listing pages, no headless
   browsers, no third-party scraper services hitting eBay on our behalf. Scraping violates eBay's
   ToS/API License Agreement and is the thing that gets IPs and accounts banned.
2. **Official Developer Program APIs only**, authenticated with OAuth application tokens.
3. **All eBay calls happen server-side** from our API — never from user devices with our keys.
4. **Develop against the eBay Sandbox environment** (separate sandbox keys, fake data) until the
   integration is stable; flip `EBAY_ENV=production` only for real usage. Sandbox mistakes can't
   hurt the production account.
5. **Respect rate limits with our own limiter + cache** (see below); back off on 429s. Check
   remaining quota via the Developer Analytics API (`getRateLimits`) rather than discovering limits
   by exhausting them.

## Production keyset & account-deletion compliance

*Recorded 2026-09-20, when production credentials were first wired up.*

A production keyset is **issued but disabled** until eBay's Marketplace Account Deletion /
Closure Notification workflow is resolved. Until it is, the OAuth token endpoint returns
`{"error":"invalid_client","error_description":"client authentication failed"}` — which looks
exactly like wrong credentials and is not. **Do not regenerate keys in response to that error**;
check the keyset's notification status first. Regenerating invalidates a working Cert ID and
wastes a round of re-pasting.

**Current position: exemption claimed.** Developer Portal → Application Keys → Event Notification
Delivery Method → *"Exempted from Marketplace Account Deletion"*. That declaration is honest today
because the app stores no eBay **user** data:

- app-level OAuth tokens only; no user account linking
- Postgres is provisioned but schema-less and empty
- the valuation cache is in-memory, keyed by product identifier, holding listing prices and titles
  — item data, not user data
- the rate limiter holds our own callers' IPs, which is not eBay user data

**When this MUST be revisited.** The exemption stops being true the moment we store eBay user data:

- **user eBay account linking via OAuth** (Phase 2 in `PROJECT_BRIEF.md`) — the clear trigger
- **one-tap listing / auto-draft creation**, which ride on that same user OAuth
- *Not* triggered by saved inventory of our users' own items (their data, not eBay's)

**Plan the switch before the feature ships, not after.** Reversing the exemption means standing up
a publicly reachable HTTPS endpoint that answers eBay's challenge-response validation, and the
keyset can sit disabled until that passes. Any spec introducing user OAuth must cover this in its
plan rather than discovering it at launch.

Staying exempt while storing eBay user data would be a ToS breach against the founder's account —
precisely the risk Principle I of the constitution exists to prevent.

## The sold-listings problem (this is the big one)

The product wants *sold* prices, and eBay restricts that data:

- **`findCompletedItems` (Finding API) is gone** — deprecated Oct 2020, the entire Finding API was
  decommissioned **Feb 5, 2025**. Any tutorial or library using it is dead.
- **Marketplace Insights API** is the official replacement: last-90-days sold data. **Update
  2026-09-20 — treat this as unobtainable, not merely hard.** The original read here was
  "Limited Release, solo developers routinely denied, apply anyway." It has since hardened:
  eBay's own API page states the release is *restricted and not open to new users at this time*,
  and developer-forum reports have eBay replying that access is limited to major partners. No
  recent approvals are documented anywhere we could find. Still free to ask via Developer
  Technical Support, so ask — but **do not plan around it arriving.**
- **Browse API** (generally available): **active listings only**, no sold data. Default app-level
  quota is **5,000 calls/day**, raisable for free via eBay's *Application Growth Check* once we
  have real usage.

### Valuation strategy given the above

Asking-price data is the **permanent basis**, not a bridge. What was written as "Phase 1" is the
product. Three compensations follow from that, two of them now shipped:

- **Active-listing valuation** (spec 001): median of the lowest N fixed-price listings for the
  matched product (by UPC/ISBN/EPID), labelled honestly in the payload.
- **Supply-side liquidity gate** (spec 002): without sold counts we cannot compute true
  sell-through, so competing-supply volume gates the verdict instead — a flooded market downgrades
  an otherwise-profitable item. Signal stays marked `SUPPLY_SIDE_ONLY`.
- **Realization rate** (spec 003): asking prices are biased high because sellers list
  aspirationally, and that bias produces false FLIPs. The median is corrected by a configurable
  rate (default 0.8) so the estimate approximates a sale price. **The default is a guess**; the
  point is that it stays retunable.
- **The calibration flywheel (not built).** The real fix for the guess is our own data: once
  saved inventory records what users actually sold items for, the realization rate can be measured
  against `rawAskingMedianCents` instead of assumed. That is proprietary sold data nobody else
  has, and it is fully compliant because it is ours. It only accrues once there are users.

**If Marketplace Insights is ever granted**, true sold prices supersede the realization rate
(drop it to 1.0 or remove it) and `liquidityScore(soldCount, activeListingCount)` — already
written and unused in `src/lib/verdict.ts` — replaces the supply-side heuristic behind the same
tiering and gating logic.

### Third-party "sold data" vendors — a founder decision, not a technical one

Searching this topic surfaces vendors (PriceCharting and similar) selling eBay-derived sold data,
and tools like Gameye are built on that layer. Findings from 2026-09-20:

- PriceCharting's methodology page states it collects sold-listing data from eBay plus its own
  marketplace, but **never states how** — licensed access, a partner relationship, or scraping.
  Given `findCompletedItems` died in Feb 2025 and Insights is closed, it is one of those three.
- Its API sells **computed current values, not sales**: the docs state plainly that historic
  prices and historic sales are not supported. So it would not fix liquidity, which is the gap
  that actually matters.
- Coverage is games, cards, comics and coins — **no books**, a large share of our media use case.

**Do not** bridge the gap with scraping or with gray-market resellers that scrape. Adopting such
a vendor would require an explicit constitution amendment (Principle I), not a quiet technical
decision. Worth noting the risk *profile* differs from what Principle I was drafted against — with
a third-party API, eBay never sees us, so the exposure is legal/continuity rather than ban risk —
which is exactly why it deserves a deliberate decision rather than a silent reinterpretation.

## Cost / quota discipline

- **Cache aggressively by product identifier.** Media items (UPC/ISBN/EAN → same product) are the
  core use case; a valuation cached for ~24h means the 50th person scanning the same DVD costs us
  zero API calls. This is also the answer to "resellers racking up my bill."
- Per-user lookup caps (free-tier limits) enforced in our API, well below anything that could
  threaten the 5,000/day app quota.
- Monitor quota headroom via Developer Analytics API; alert before we're close.

## Sources

- [eBay API Deprecation Status](https://developer.ebay.com/develop/get-started/api-deprecation-status)
- [Marketplace Insights API overview](https://developer.ebay.com/api-docs/buy/marketplace-insights/static/overview.html)
- [API Call Limits / Application Growth Check](https://developer.ebay.com/develop/get-started/api-call-limits)
- [Browse API overview](https://developer.ebay.com/api-docs/buy/browse/overview.html)
- eBay community threads confirming Marketplace Insights is approval-gated and Browse API excludes
  sold data ([example](https://community.ebay.com/t5/eBay-APIs-Talk-to-your-fellow/findCompletedItems-does-not-work/td-p/34819558))
- [Marketplace Account Deletion requirements](https://developer.ebay.com/marketplace-account-deletion)
  and [creating API keysets](https://developer.ebay.com/api-docs/static/gs_create-the-ebay-api-keysets.html)
- 2026-09-20 threads on Insights access being closed to new applicants
  ([one](https://community.ebay.com/forum/talk-to-your-fellow-developers-57970/topic/marketplace-insights-api-access-168586/),
  [two](https://community.ebay.com/forum/talk-to-your-fellow-developers-57970/topic/marketplace-insights-api-query-about-small-project-168257/))
- [PriceCharting methodology](https://www.pricecharting.com/page/methodology) and
  [API docs](https://www.pricecharting.com/api-documentation) — reviewed and not adopted; see above
