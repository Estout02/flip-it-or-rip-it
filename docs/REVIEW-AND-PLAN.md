# Flip It or Rip It — Review and Phone-App Plan

*Written 2026-11-02 at the founder's request: "review this project … take it to something that has
real potential … it needs to be a phone app … don't write any code yet, make a plan."*
*This is a planning doc. Nothing here changes code or the constitution. Sources are linked inline;
anything not verified is marked **(unverified)**.*

---

## 0. The short version

- **The engineering is good, maybe too good for where the product is.** Seven specs, ~400 tests,
  a careful constitution, an accessible PWA with a barcode scanner. The backend is honest about
  what it doesn't know. The problem isn't the code.
- **There is a blocker that outranks everything else.** eBay's API License Agreement forbids using
  eBay Content "either alone or in combination with third-party information, to suggest or model
  prices for items listed on eBay Site," and separately requires written permission for anything
  that derives "conversion, completion or success rates" (i.e. sell-through). The valuation and the
  liquidity score are both squarely in that territory. Scraping was never the only risk.
- **The market is not empty.** Underpriced (launched Nov 2025) is almost this exact product:
  photo/barcode → sold comps → fees and shipping out → "Flip or Pass" verdict, $9.99–$24.99/mo,
  iPhone + Android + web. eBay's own app now does AI photo listing with pricing guidance. ScoutIQ
  owns Amazon book scouting.
- **The real wedge is the one already in the brief and not yet built: the household declutter, not
  the reseller sourcing run.** Every competitor answers "should I *buy* this to resell?" Nobody is
  built for "I have 200 things in my garage — which 15 are worth my weekend, and where do the other
  185 go?" That's the anti-consumerism angle, and it changes what data you need (bands, not
  pennies), who pays (households, occasionally), and how you can be compliant.
- **Recommended data path:** ask eBay for written consent now, and in parallel make the verdict
  *source-agnostic* — "worth listing / not worth your time / donate" bands driven by a pluggable
  price source (licensed category sources first, the user's *own* eBay sales for themselves,
  eBay Browse only once consent is in hand). Details in §3.
- **Recommended app stack:** Expo (React Native + TypeScript), with the existing Fastify API as the
  backend. Capacitor around the existing PWA is the fallback if speed-to-TestFlight beats
  everything else. Details in §4.
- **Verdict on potential:** modest as a reseller tool (crowded, and the data is locked up);
  genuinely interesting as a declutter/donate app *if* the value bands can be sourced compliantly.
  It's worth a cheap, time-boxed validation (§5, Phase 0–1, ~6 weeks, <$200) before building the
  native app.

---

## 1. Repo review (state as of `main` @ c432dba, 2026-11-02)

### 1.1 What exists

| Area | State |
|---|---|
| Backend | Node 24 + TS + Fastify 5, `src/server.ts` (472 lines) and a four-step pipeline in `src/lib/` (identify → valuation → shipping → verdict). Only two runtime deps (`fastify`, `@fastify/static`). |
| eBay integration | OAuth client-credentials token manager, Browse API client, Developer Analytics quota check. Sandbox-first, production keyset via an explicit compose overlay. |
| Verdict model | `FLIP` / `FLIP_RISKY` / `RIP` / `UNCERTAIN` with reason codes. Median of the lowest N active listings × 0.8 realization rate − 13.25% fee − $5 flat shipping vs. a $10 threshold, gated by a supply-side liquidity heuristic and a match-confidence check. |
| Specs | 001 valuation pipeline, 002 liquidity gate, 003 realization rate, 004 product-match filtering, 005 backend hardening, 006 web client, 007 environment badge — all merged. **008 native-sheet UI and an eBay-timeout fix are pushed but unmerged since 2026-10-03.** |
| Web client | Preact + Vite PWA, ≤100 KB budget, WCAG 2.2 AA with axe tests, lazy-loaded barcode scanner (native `BarcodeDetector`, ZXing-WASM fallback), device-local history/settings, offline shell. |
| Tests | ~396 Vitest/Playwright cases (count of `it(`/`test(` blocks), fakes injected for eBay; e2e + a11y matrix in a Playwright container. Not executed in this review. |
| Ops | Docker Compose for dev (api, web, e2e profile, Postgres 17 unused). No CI config in the repo. |
| Process | Spec Kit with a multi-agent orchestrator (`.claude/agents`, run-logs). Constitution v1.1.0, eight principles. |

### 1.2 What's solid

- **Honesty is designed in.** `pricingBasis: "ASKING_PRICE"`, `SUPPLY_SIDE_ONLY`, the `UNCERTAIN`
  verdict for low match confidence, the sandbox badge. Most competitors present guesses as facts;
  this one doesn't. That's a brand asset for a decluttering app.
- **The pipeline seams are right.** Identification, valuation, shipping and verdict are separable,
  and the eBay client is an injected interface. That is exactly what's needed to swap the price
  source (§3) without a rewrite.
- **Money in integer cents, input rejected before any external call, single-flight on identical
  lookups, bounded memory, validated config** (spec 005). The abuse and cost thinking is mature.
- **Accessibility is real**, not a checkbox — axe on every state, forced-colors, 44 px targets.
- **Spec 004 (product-match filtering)** came from a real production run and fixed a real failure
  (accessories polluting the median). That's the right instinct: test against reality, then fix.

### 1.3 What's weak

1. **The valuation is built on the data eBay forbids you to model.** See §3. Every other weakness
   is secondary to this.
2. **The core number is a guess stacked on a guess.** Median of the lowest 10 *asking* prices ×
   a 0.8 haircut that the env file itself calls "a founder judgment call, NOT a measured figure."
   There's no calibration data yet, so nobody — including the app — knows how wrong it is.
3. **Fees are probably wrong for the core category.** The default `EBAY_FEE_RATE=0.1325` is called
   "typical media rate," but a third-party fee table checked 2026-11-01 lists eBay's final value
   fee at **15.3% for Books & Magazines, Movies & TV and Music (non-vinyl)**, 13.6% for most
   categories, plus a $0.30/$0.40 per-order fee
   ([Underpriced fee tables, MIT-licensed](https://www.underpriced.app/data/reseller-fees)).
   Verify on eBay's own selling-fees help page before changing anything — but on a $15 book the
   difference is ~$0.70, which matters at a $10 threshold.
4. **Shipping is a flat $5.** For media via USPS Media Mail that's roughly right; for anything else
   (a cast-iron pan, a lamp) it's not. Shipping is often the deciding cost for declutter items.
5. **Per-IP daily caps break on phones.** Mobile carriers put many users behind shared IPs
   (carrier-grade NAT). A phone app needs per-install or per-account identity, not per-IP.
6. **State is in-memory and single-instance.** Cache and rate-limit counters vanish on restart and
   don't scale past one process. Fine for a beta; not for a launch.
7. **There is no production image.** The `Dockerfile` runs `npm run dev` (`tsx watch`) and the prod
   overlay only swaps env files. No CI, no deploy target, no observability.
8. **Docs drift.** `AGENTS.md` "Current state (2026-07-07)" still says implementation hasn't
   started; spec headers still say `Status: Draft`; 008 and the timeout fix have sat unmerged for a
   month. For an AI-driven repo, stale agent context is a real cost.
9. **Process weight.** Seven specs and an eight-role orchestrator for a product with zero users.
   It produced quality, but the next phase is about learning fast; the process should flex for
   throwaway validation work (see §5).

### 1.4 Technical debt list (prioritised)

| # | Debt | Severity | When to pay |
|---|---|---|---|
| D1 | Price source is hard-wired to eBay Browse | Blocker | Phase 1 (introduce a `PriceSource` interface; docs-first spec) |
| D2 | Fee model: single flat rate, no per-order fee, wrong media rate | High | Phase 1 |
| D3 | Identity = IP; no accounts | High for mobile | Phase 2 |
| D4 | In-memory cache/limits | Medium | Phase 2 (Postgres is already provisioned; or Redis) |
| D5 | No prod build, no CI, no deploy | Medium | Phase 1 (cheap: GitHub Actions running tests in the existing containers) |
| D6 | Flat shipping | Medium | Phase 2 (weight/size class picker; carrier tables) |
| D7 | 008 + timeout fix unmerged | Low | Now — merge or close; don't let branches rot |
| D8 | Stale AGENTS.md / spec statuses | Low | Now |
| D9 | 24h valuation cache vs. eBay's display-freshness rule (listing info ≤6h old, other content ≤24h) | Low/legal | If Browse stays in the product, make cached displays respect it |

---

## 2. Product review

### 2.1 Who it's for — two different users

| | **Reseller (sourcing)** | **Household (declutter)** |
|---|---|---|
| Question | "Should I *buy* this to resell?" | "Is this worth selling, or should it go?" |
| Volume | Hundreds of scans a week | A burst of 50–300 once or twice a year |
| Needs | Exact comps, sell-through, speed, offline | A confident yes/no, a rough band, where to donate, a sense of progress |
| Willing to pay | Yes, monthly ($10–$44/mo is normal) | Rarely monthly; maybe once, or per "project" |
| Already served by | ScoutIQ, Underpriced, eBay Product Research, WorthPoint | **Nobody well** |

The brief targets both, but the anti-consumerism angle, the "remove X pounds from your house"
stats, and the RIP-means-donate verdict all point at the household. Eric is a reseller himself,
which is why the reseller framing crept in.

### 2.2 Competitors (checked 2026-11-02)

| Product | What it does | Price | Notes |
|---|---|---|---|
| **Underpriced** | Photo / barcode / screenshot → sold comps (eBay, Poshmark, Mercari) → fees + shipping → "Flip or Pass", listing drafts, inventory | Free 5 checks; $9.99/75, $14.99/200, $24.99/500 per month | Launched Nov 2025, iPhone/Android/web. Nearly identical core loop. How it gets eBay sold data isn't stated. [site](https://www.underpriced.app/), [pricing](https://www.underpriced.app/pricing), [facts](https://www.underpriced.app/llms.txt) |
| **eBay app** | Barcode scan fills listing details; AI "Magical Listing" from a photo; Q2 2026: "enhanced pricing guidance" inside Magical Listing; AI trading-card scanner (80M scans) | Free | The platform owner is building the same thing into the place people list. [eBay Innovation](https://innovation.ebayinc.com/stories/ebay-reduces-the-time-to-list-on-mobile-with-new-simplified-selling-tool-now-featuring-magical-listing-ai-technology/), [Q3 2026 results](https://www.ebayinc.com/stories/news/ebay-inc-reports-third-quarter-2026-results/), [Q2 2026 call](https://longbridge.com/en/news/295714556.md) |
| **ScoutIQ** | Barcode book/media scouting against **Amazon** data; offline 1.3 GB database | $14/mo live; $44/mo with database | Owns the serious book-scouting niche; Amazon-centric. [pricing](https://scoutiq.threecolts.support/en/articles/10240682-scoutiq-plans-pricing) |
| **WorthPoint** | ~1B historical sale records for antiques/collectibles | ~$27–$47/mo | Deep archive, collector-focused, expensive. [pricing](https://www.worthpoint.com/product/index), [2026 review](https://www.underpriced.app/blog/worthpoint-review-2026) |
| **Flipsy** | Trade-in price comparison for phones, tablets, consoles, watches | Free (buyers pay) | Narrow electronics buyback, not general resale. [FAQ](https://flipsy.com/faq) |
| **Flipit (getflip.it)** | Photo → AI identification → local price range across eBay/Vinted/FB etc. | Credits / subscription | Photo-first, local-market angle. [site](https://getflip.it/) |
| **Mercari** | AI-suggested starting price and floor price when you list; "Smart Pricing" auto-adjusts | Free (inside Mercari) | Price suggestion is a feature of the marketplace you list on. [Mercari Engineering](https://engineering.mercari.com/en/blog/entry/pricing-guidance-system/) |
| **Google Lens** | Photo → visual matches and shopping results | Free | Great at identification, says nothing about net-after-fees or whether it's worth your time. *(general knowledge, not re-checked)* |
| **eBay Product Research (Terapeak)** | Up to 3 years of eBay sold data for sellers | Free to eBay sellers | The free answer for serious eBay sellers; no API. ([per Underpriced's review](https://www.underpriced.app/blog/worthpoint-alternatives-2026)) |

And the community view on why this category is hard: a top r/Flipping reply (May 2026) points to
the same license clause and concludes "there are no good apps out there for checking comps"
because eBay doesn't want them
([thread](https://www.reddit.com/r/Flipping/comments/1tgr2ft/access_to_ebay_completed_sale_best_offer_prices/)).

### 2.3 The real wedge

Not "faster comps" — eBay and Underpriced will always be closer to the data. The wedge is
**decluttering triage with a conscience**:

1. **Triage, not appraisal.** The household doesn't need $14.37; it needs *"List it (likely
   $30–60)"*, *"Bundle it"*, *"Not worth your time — donate"*. A banded verdict is more useful for
   this user, more honest given the data, and (see §3) easier to make compliant.
2. **RIP is a first-class outcome.** Today RIP is a dead end. Make it the best part: where to
   donate nearby, a running donation log with estimated fair-market value for the tax receipt
   (sourced from published thrift valuation guides, *not* eBay), and the "you cleared 140 lb from
   your house" stat. No competitor treats "get rid of it" as success.
3. **Session mode.** "Garage session: 87 scanned, 9 to list, 3 to bundle, 75 to donate, est.
   $410." That's a shareable artefact and a natural paid unit (§4.6).
4. **FLIP hands off to eBay's own listing tools.** Instead of competing with Magical Listing,
   deep-link or draft into it. That *promotes eBay services*, which is the license's stated
   purpose — and the strongest argument in a consent request (§3).

For Eric personally, a reseller "sourcing mode" can stay as a power feature, but it shouldn't be the
headline.

---

## 3. The data blocker and the options

### 3.1 What the license actually says

From the eBay Developers Program API License Agreement (live page returned 403 to automated fetches;
quoted from the [Wayback copy of 2026-08-08](https://web.archive.org/web/20260808175208/https://developer.ebay.com/join/api-license-agreement)):

- **Restricted Activities:** you may not "Use eBay Content, either alone or in combination with
  third-party information, to suggest or model prices for items listed on eBay Site."
- **Prohibited Use and Derivation of Information:** written permission is required to use eBay
  Content in a way that enables derivation of, among others, "Average selling price … for any eBay
  category," and — *"notwithstanding Your Users' access to and use of their own information"* —
  "Aggregated seller or buyer data" and "Conversion, completion or success rates."
- **Restricted APIs** (pricing, sales volume, market trends — e.g. Marketplace Insights) may be used
  to build pricing tools "only upon receiving eBay's express prior written consent."
- "eBay Content" is "all of the information … retrieved from eBay" and "does not include
  information that you lawfully obtain independent of eBay."
- Displayed listing info must be ≤6 hours older than eBay's; other content ≤24 hours.

**Plain reading (not legal advice):** the current `median × 0.8 − fees` valuation and the
active-listing-count liquidity score both model price/sell-through from eBay Content. Running it
for real users without consent puts the founder's developer account at risk — the same risk
Principle I was written to prevent, arrived at by a different road.

### 3.2 Options

| Option | What it is | Compliance | Data quality | Cost | Verdict |
|---|---|---|---|---|---|
| **A. Ask eBay for written consent** | Email Developer Technical Support / partner team describing a declutter tool that *sends listings to eBay* | Fully clean if granted | Best (eBay data) | Free; weeks–never | **Do it now regardless.** Don't plan around a yes. |
| **B1. Other marketplaces' official APIs** | Discogs `marketplace/stats` (lowest price, # for sale) and authenticated price suggestions for music ([docs](https://www.discogs.com/developers)) | Per each API's terms (check each) | Good for vinyl/CDs only | Free | Use for music. |
| **B2. Licensed data providers** | PriceCharting API (games/cards, current values, no history; $49/mo Legendary, [docs](https://www.pricecharting.com/api-documentation)); Keepa for Amazon (€49/mo+, [docs](https://keepa.com/api-docs/plans-tokens.html)) | Their terms, plus *their* provenance — PriceCharting's eBay sourcing method is unstated (already flagged in `EBAY_API_NOTES.md`) | Good per category | $50–$100/mo | Constitution amendment needed; decide category by category. |
| **B3. User's own eBay sales via their OAuth** | Fulfillment/Finances APIs with the user's token (Finances `order_earnings` added 2026-03-16 gives fees and net per order; limited-access) | **Showing a user their own history to themselves: fine. Pooling users' sales into crowd comps: needs written permission** ("aggregated seller data," "notwithstanding Your Users' … own information") | Excellent but sparse, and only for people who already sell | Free | Great *personal calibration* feature (fixes the 0.8 guess per user). Not a crowd data source without consent. |
| **B4. User-reported outcomes** | After a FLIP, ask "what did it sell for?" — typed by the user, not pulled from eBay | Arguably *not* eBay Content ("lawfully obtain[ed] independent of eBay") — **needs a lawyer's read before relying on it** | Slow to accrue; skewed | Free | The long-term moat if it holds up. Start collecting from day one. |
| **B5. Eric's own sales** | Seed the calibration with Eric's 97+ sales this year | His own data, for his own use: fine | Tiny but real | Free | Use to calibrate the beta, not as a public data source. |
| **C. Reframe to value bands** | Show "Worth listing / Borderline / Donate" with wide bands instead of a price | **Does not by itself cure it** — a band is still a modelled price | Matches the declutter user better | Free | Do it for product reasons; don't count it as compliance. |
| **D. Keep Browse only for identification and display** | Use Browse to turn a barcode into a product title/category and to show "see listings on eBay" | Within Authorized Use / Public Display | n/a | Free | Keep this regardless. |

### 3.3 Recommendation: "Consent-gated eBay, source-agnostic verdict"

1. **This week:** send the consent request (draft points in Appendix A). Frame the app as a funnel
   *into* eBay listing (FLIP → eBay listing flow), declutter-focused, low volume, with honest
   labelling.
2. **Refactor on paper first (spec 009):** split "valuation" into a `PriceSource` interface returning
   a *band* plus a confidence and provenance (`DISCOGS`, `PRICECHARTING`, `USER_OWN_HISTORY`,
   `USER_REPORTED`, `EBAY_BROWSE_WITH_CONSENT`). The verdict consumes bands. The pipeline seams
   already allow this.
3. **Until consent arrives,** Browse is used only for identification and "view on eBay"
   display (option D). Values come from B1/B2 where available, the user's own history (B3, per user)
   and user-reported outcomes (B4, pending legal read). Categories with no compliant source get a
   transparent "we can't value this one — here's how to check yourself" path, not a guess.
4. **If consent is granted,** `EBAY_BROWSE_WITH_CONSENT` becomes the default source and the rest
   become calibration.
5. **If consent is refused and books have no compliant source,** that is a kill/pivot signal for the
   reseller angle (§5.4), and the product leans fully into declutter + donate.

This needs a constitution amendment (Principle I currently allows "official eBay APIs only" and
bans third-party sold-data vendors). Recommend v2.0.0: "compliant data only — official APIs used
within their license, licensed providers approved by the founder, and data users own."

---

## 4. Phone app plan

### 4.1 Stack comparison

| | **Expo / React Native (TS)** | **Native Swift (+ Kotlin later)** | **Flutter (Dart)** | **Capacitor around the existing PWA** |
|---|---|---|---|---|
| Code reuse | Shared TS types/contracts, money/verdict-copy logic; UI rewritten | None (iOS only; Android is a second app) | None; new language | **Most** — the 006/008 Preact UI ships almost as-is |
| Barcode scanning | `expo-camera` scans EAN-13/UPC-A natively ([docs](https://docs.expo.dev/versions/latest/sdk/camera)); VisionCamera for more control | Best (AVFoundation/Vision) | Good (ML Kit plugins) | Web ZXing today; native ML Kit via a plugin is possible |
| Feel / review risk | Native | Best | Near-native | Must avoid "repackaged website" rejection under Guideline 4.2 ([Apple guidelines](https://developer.apple.com/app-store/review/guidelines/)) |
| Solo-dev cost | One codebase, two stores; EAS free tier: 15 iOS + 15 Android builds/month ([Expo pricing](https://expo.dev/pricing)) | Two codebases eventually; needs a Mac for builds | One codebase; new language | One codebase; fastest to TestFlight |
| Accessibility | Good (RN a11y props; must re-test — the axe suite doesn't carry over) | Best | Good | Carries over the existing WCAG work |
| Payments | RevenueCat SDK (free to $2.5k/mo tracked revenue, then 1%) ([docs](https://www.revenuecat.com/docs/welcome/set-up-revenuecat/account-management)) | StoreKit directly | RevenueCat plugin | RevenueCat Capacitor plugin |

**Recommendation: Expo.** TypeScript end to end, native camera, one codebase for iOS and Android
(the brief notes Android may skew reseller), free build tier, and the market Eric is entering
(Underpriced, eBay app) sets a native-feel bar. Keep the PWA alive as the free web entry point and
the place the accessibility suite keeps running.

**Fallback: Capacitor** if the goal is "Eric scanning at thrift stores from TestFlight in two
weeks." It reuses 008 nearly wholesale; the risk is App Review and camera performance.

### 4.2 Camera and scanning

- **Barcode is primary.** On-device native scanning (free, instant, offline). Batch mode: keep the
  camera open, accumulate a session list, verdicts stream in (008's "native sheet" design already
  describes this).
- **Image search is secondary and economics-gated** (as the constitution says). Two cheap paths:
  1. **eBay Browse `searchByImage`** for identification only (returns matching listings → product
     title/category). Free under the app quota; verify production restrictions first.
  2. **A small vision model** for "what is this?" → a title. Gemini 3.1 Flash-Lite lists
     $0.25/M input tokens and $1.50/M output, ~258 tokens per image
     ([Google pricing](https://ai.google.dev/gemini-api/docs/pricing)) — roughly **$0.0005 or less
     per identification** with a short answer. At 1,000 photo scans/day that's well under $1/day.
     Cost is not the constraint; accuracy and the "is this the same item" match are.
- Show the identified product and let the user correct it before the verdict (spec 004's match
  confidence already supports this).

### 4.3 Offline

Thrift stores and basements have bad signal (ScoutIQ sells a 1.3 GB offline database for exactly
this reason). Plan: **queue offline, resolve online.** Scans are stored locally with a timestamp and
resolved when signal returns; cached verdicts for previously seen barcodes show instantly. A
downloadable offline database is out of scope (and would be eBay Content redistribution).

### 4.4 Accounts

- **v1 beta:** anonymous device ID (fixes the per-IP cap problem) + optional Sign in with Apple /
  Google to sync history.
- **Required by Apple if you add accounts:** in-app account deletion (Guideline 5.1.1(v),
  [Apple](https://developer.apple.com/help/app-review/guideline-reference/5-1-1-account-deletion/)),
  a privacy policy, and App Privacy labels.
- **eBay account linking** (B3) is opt-in, later, and per-user only.

### 4.5 App store requirements and fees

- Apple Developer Program **$99/year**; Google Play **$25 one-time**.
- Commission: Apple **15%** under the Small Business Program (<$1M/yr)
  ([Apple](https://developer.apple.com/app-store/small-business-program/)); Google Play **15%** on
  subscriptions ([summary](https://splitmetrics.com/blog/google-play-apple-app-store-fees/)).
- Digital features (subscriptions, scan packs) must use in-app purchase on iOS.
- Camera permission strings, privacy nutrition labels, a demo path for reviewers, and a clear
  statement that values are estimates.

### 4.6 Monetisation

Keep the founder's rule: features that can't run profitably don't ship. Costs per scan are tiny
(barcode ≈ $0; photo ID < $0.001; hosting ≈ $10–25/mo at beta scale), so pricing is about value,
not cost recovery.

| Tier | For | Price (proposal) |
|---|---|---|
| Free | Households | Unlimited barcode verdicts with fair-use cap (~50/day), 10 photo IDs/month, donation log |
| Declutter Pass | A one-off big clear-out | **$4.99 one-time for 30 days** of unlimited photo ID, sessions, export/share |
| Flipper | Ongoing sellers | **$4.99/mo or $39/yr**: sourcing mode, own-sales calibration (B3), inventory, tax export |

Underpriced anchors at $9.99/mo; undercutting with a declutter-first free tier is the point.
eBay Partner Network affiliate revenue on "view on eBay" taps is a possible small extra *(attribution
for a valuation tool unverified)*. After the 15% store cut and RevenueCat (free under $2.5k/mo),
a $39/yr subscriber nets ~$33.

---

## 5. Roadmap

### Phase 0 — Clean up and ask (weeks 0–1, ~$0)

- Send the eBay consent request (Appendix A). Ask DTS about Marketplace Insights in the same email.
- Merge or close `008-native-sheet-ui` and `fix/ebay-timeout-hang-guard`; refresh `AGENTS.md`.
- Fix the fee model on paper (spec 009 draft): per-category rate + per-order fee.
- Write spec 009 "PriceSource and value bands" (docs only) and the constitution v2.0.0 proposal.
- **Milestone:** consent request sent; repo state matches its docs.

### Phase 1 — Validate with Eric and 20 people (weeks 1–6, < $200)

- **Eric uses the existing PWA at thrift stores and at home** for 4 weeks, logging every verdict and
  what he actually did/sold for (B5). Personal use, his own judgment — not a public product.
- **20-person beta**, half resellers, half "normal" households with a garage/closet to clear. Use the
  PWA (or a Capacitor TestFlight build if the camera UX blocks). Recruit from Eric's network and one
  local Buy Nothing / decluttering group.
- Measure: verdicts per session, % of FLIPs actually listed, reported sale price vs. band, % of RIPs
  that went to donation, and "would you be upset if this went away?"
- Interview 10 beta users: do they want a price or a decision? Would they pay $4.99 once?
- **Milestone / go criteria:** ≥60% of household testers complete a session of ≥20 items;
  ≥40% "very disappointed" if it disappeared (Sean Ellis test); FLIP bands contain the real sale price
  ≥70% of the time for the items that sold; at least one compliant price source per top-3 category.

### Phase 2 — MVP app (weeks 7–14, ~$150 + Eric's time)

- Expo app: native barcode scanner, session mode, verdict bands, donate path + donation log,
  offline queue, device identity, optional sign-in, account deletion.
- Backend: `PriceSource` implementation (Discogs + whatever Phase 1 justified), per-category fees,
  persistent cache/limits in Postgres, prod Docker image, GitHub Actions CI, one small host.
- Photo ID behind a flag with a per-user monthly cap.
- TestFlight + Play internal testing with the beta group.
- **Milestone:** 50 weekly active testers; crash-free sessions ≥99%; p50 scan→verdict < 1.5 s on cached
  items, < 3 s uncached.

### Phase 3 — Launch (weeks 15–20)

- App Store + Play listing, privacy policy, support page, onboarding that explains "estimate, not
  appraisal."
- Declutter Pass + Flipper subscription via RevenueCat.
- One launch story for Eric's blog: "I scanned my whole garage. 9% was worth selling."
- **Milestone:** 1,000 installs in 60 days; ≥3% paid conversion of active users; D30 retention ≥15%
  for Flippers (households are expected to churn after the clear-out — measure sessions completed,
  not retention, for them).

### 5.1 Success metrics (north star: items decided per week)

- Items decided (FLIP/RIP acted on) per active user per week.
- Band accuracy: % of user-reported sales inside the shown band.
- Donation pounds/items logged (the anti-consumerism metric for the story).
- Paid conversion and refund rate.

### 5.2 Costs (first 6 months, rough)

| Item | Cost |
|---|---|
| Apple Developer | $99/yr |
| Google Play | $25 once |
| Hosting (API + Postgres, small) | $10–25/mo |
| Expo EAS | $0 (free tier) |
| RevenueCat | $0 under $2.5k/mo revenue |
| Vision model | < $5/mo at beta scale |
| Optional licensed data (PriceCharting, Keepa) | $50–100/mo, only if Phase 1 justifies it |
| Legal read of B3/B4 | One-off; budget $300–1,000 *(estimate)* |
| **Total without licensed data** | **≈ $250–400 for six months** |

### 5.3 Top risks

1. **eBay says no (or never answers)** and there's no compliant source for books — the founder's best
   category. *Mitigation:* declutter positioning needs bands, not comps; Discogs/PriceCharting cover
   music and games.
2. **eBay builds it.** Magical Listing already has pricing guidance; a "should I bother?" mode is a
   small step for them. *Mitigation:* own the RIP/donate side and the session story, which eBay has no
   incentive to build.
3. **Underpriced and similar apps are already there** with sold comps and a $9.99 tier.
   *Mitigation:* don't fight on comps; fight on declutter and on honesty.
4. **Households don't pay.** *Mitigation:* one-time pass, not a subscription; keep costs near zero.
5. **Solo-dev bandwidth and process weight.** *Mitigation:* Phase 1 is deliberately throwaway; run the
   Spec Kit flow for Phase 2 code only.
6. **Account/key risk from running the current valuation publicly.** *Mitigation:* nothing public
   until §3 is resolved.

### 5.4 Kill criteria (decide at the end of Phase 1)

- Fewer than 8 of 20 testers complete a 20-item session → kill or rethink the core loop.
- Band accuracy < 50% on items that actually sold → the data isn't good enough to ship.
- eBay refuses consent **and** no compliant source covers at least two of the top three categories
  testers scan → drop the valuation; consider a pure "declutter + donate tracker" or stop.
- Nobody of 20 would pay $4.99 once → keep it as Eric's personal tool, don't launch.

---

## 6. Decisions for Eric

1. **Who is it for first:** households decluttering (recommended) or resellers sourcing?
2. **Send the eBay consent request?** (Draft points below.) And accept that the current valuation
   stays private/personal until it's resolved?
3. **Constitution v2.0.0:** allow licensed, non-eBay data providers and user-owned data?
4. **Paid data:** willing to spend ~$50–100/mo on PriceCharting/Keepa if Phase 1 shows games/books
   need it?
5. **Stack:** Expo (recommended) or Capacitor-first for speed?
6. **Monetisation shape:** one-time Declutter Pass + small subscription, or subscription only?
7. **Legal read** on user-reported sale prices (B4) and own-account data (B3): worth ~$300–1,000?
8. **Housekeeping:** merge or close the 008 and timeout branches.

---

## Appendix A — Consent request: points to make (draft, not sent)

To eBay Developer Technical Support / Developer Program, from the founder's developer account:

- What it is: a mobile app that helps households decide which belongings are worth listing on eBay
  and donates the rest. FLIP verdicts hand off to eBay's own listing flow.
- What we'd use: Browse API (app token) for identification and active-listing context; requested
  permission to show a coarse value band ("worth listing / borderline / not worth it") derived from
  that data, labelled as an estimate based on current listings.
- What we won't do: scrape, store listings beyond display-freshness limits, redistribute data,
  aggregate seller data, or train models on eBay Content.
- Volume: under 2,500 calls/day for the foreseeable future; caching by product identifier.
- Ask: written consent under the Restricted Activities / pricing-tool clauses, and whether Marketplace
  Insights access is possible for this use case.

## Appendix B — Sources

- eBay API License Agreement (Wayback 2026-08-08): https://web.archive.org/web/20260808175208/https://developer.ebay.com/join/api-license-agreement
- eBay release notes (Buy / Sell): https://developer.ebay.com/develop/api/buy/release_notes · https://developer.ebay.com/develop/api/sell/release_notes
- Browse API spec (searchByImage, itemOriginDate, watchCount restrictions): https://developer.ebay.com/api-docs/master/buy/browse/openapi/3/buy_browse_v1_oas3.json
- Finances API spec (order_earnings access limits): https://developer.ebay.com/api-docs/master/sell/finances/openapi/3/sell_finances_v1_oas3.json
- eBay MCP server (read-only): https://github.com/eBay/npm-public-api-mcp
- Competitors and pricing: links inline in §2.2
- App stores: https://developer.apple.com/app-store/small-business-program/ · https://developer.apple.com/app-store/review/guidelines/ · https://developer.apple.com/help/app-review/guideline-reference/5-1-1-account-deletion/ · https://splitmetrics.com/blog/google-play-apple-app-store-fees/
- Tooling: https://expo.dev/pricing · https://docs.expo.dev/versions/latest/sdk/camera · https://www.revenuecat.com/docs/welcome/set-up-revenuecat/account-management
- Vision pricing: https://ai.google.dev/gemini-api/docs/pricing
- Data sources: https://www.discogs.com/developers · https://www.pricecharting.com/api-documentation · https://keepa.com/api-docs/plans-tokens.html
- Fee table (third-party, MIT): https://www.underpriced.app/data/reseller-fees
