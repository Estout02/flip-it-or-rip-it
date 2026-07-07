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

## The sold-listings problem (this is the big one)

The product wants *sold* prices, and eBay restricts that data:

- **`findCompletedItems` (Finding API) is gone** — deprecated Oct 2020, the entire Finding API was
  decommissioned **Feb 5, 2025**. Any tutorial or library using it is dead.
- **Marketplace Insights API** is the official replacement: last-90-days sold data. But it is
  **Limited Release** — requires applying to eBay with a business case, and solo/non-partner
  developers are routinely denied. We should apply anyway (via Developer Technical Support /
  the API's Getting Access process) — it's free to ask and it's the ideal data source.
- **Browse API** (generally available): **active listings only**, no sold data. Default app-level
  quota is **5,000 calls/day**, raisable for free via eBay's *Application Growth Check* once we
  have real usage.

### Valuation strategy given the above

- **Phase 1 (no Marketplace Insights):** value items from Browse API *active* listings — e.g.
  median of the lowest N Buy-It-Now prices for the matched product (by UPC/ISBN/EPID). Label the
  result as "asking price"–based in the UI. Liquidity signal degrades to supply-side only
  (active listing count); note that in the verdict payload.
- **Phase 2 (if Marketplace Insights granted):** true sold-price median + real sell-through
  liquidity score (sold count vs. active count).
- **Do not** bridge the gap with scraping or gray-market "sold data" resellers that scrape.

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
