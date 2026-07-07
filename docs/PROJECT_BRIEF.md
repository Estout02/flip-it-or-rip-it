# Flip It or Rip It — Project Brief

*Synthesized from the founding voice transcript (2026-07-07). This is the coherent picture of what we're building; refine it as questions get answered.*

## One-liner

A mobile-first reselling assistant with an anti-consumerism angle: scan an item, get an instant
eBay-sold-listings valuation minus shipping and fees, and a verdict — **FLIP IT** (worth selling)
or **RIP IT** (donate / recycle / discard). It protects sellers from wasting time on low-value junk
and celebrates getting stuff out of your house.

## The pain point

As an eBay seller you accumulate junk that may not be worth your time. Checking an item today means
opening the eBay app, searching, filtering to sold listings, and mentally averaging the last ~20
sales — a minute or two per item. This app should give you the same answer in seconds, so you can
do 20 lookups in the time one manual check takes. **Speed is paramount** — ideally faster than the
eBay app itself.

## Core loop (MVP)

1. **Identify the item**
   - Easy path: barcode / QR scan — media (books, movies, video games) is the sweet spot.
   - Harder path: photo → vision LLM identifies the item → search eBay by name.
2. **Value it**: query eBay sold listings (eBay Developer API — founder has a dev account).
3. **Estimate shipping cost.**
4. **Compute profit**: sold price − eBay fees − shipping.
5. **Compare against the user's profit threshold** (founder's personal rule: never sell anything
   netting < $10).
6. **Verdict on screen**: over threshold → **FLIP IT**; under → **RIP IT** (preferably donate;
   recycling/trashing is OK — fewer low-value things in the world is fine).

### Liquidity score (part of the core value prop)

Raw price lies. A book "worth" $150 with one sale ever and hundreds of active listings has no
liquidity. Compute a sell-through signal (sold count vs. active listings, sale recency) and surface
it with the verdict — an awful liquidity score should push toward RIP even when price is high.

## Gamification (must not feel hokey)

The celebration is *decluttering*, not gambling:

- Points/rewards for items sold (spendable in-app — mechanics TBD).
- Cumulative stats: "you removed X pounds of stuff from your house", "you made $Y on things you
  didn't need."
- Retention nudge: when you sell an item, you're encouraged to list **two** items to replace it.
- Keep people using the app even after their initial declutter is done.

## Platform

- Transcript leans **iPhone-first (SwiftUI)** because the camera is central, but is explicitly open
  to Android ("maybe Android skews more reseller") and to a web app / hybrid for MVP.
- Regardless of frontend, the valuation engine (eBay lookup, shipping estimate, verdict, liquidity)
  lives in a **backend API** — that's what this repo dockerizes.

## Non-functional requirements

- **Fast**: lookups as close to instant as possible; leaner than the eBay app.
- **Cheap to run**: low overhead; item-ID model must be inexpensive; guard against resellers
  hammering the API with thousands of lookups (rate limits / tier caps).
- **Extensible**: MVP excludes listing automation, but architect so these bolt on later.

## Post-MVP roadmap (build hooks for, don't build yet)

- **One-tap listing**: after a FLIP verdict, take two photos → auto-list at market value.
- **Auto-draft creation** via eBay API if full listing isn't possible.
- **Cheaper shipping** angles (eBay discount, Pirate Ship — roughly comparable today; investigate
  API-only capabilities normal users don't get).
- **Saved inventory**: item records with name, ID, cost paid, date acquired, eBay value + valuation
  date, weight, status. Enables:
  - **Tax helper (paid)**: track cost basis → computed profit for taxes.
  - **Periodic revaluation + over-threshold notifications** (founder is lukewarm — conflicts with
    the "get rid of it" ethos; low priority).
- **AI selling-goals chat bot** (far stretch; probably never).

## Monetization ideas (economics still open)

- Free tier with lookup caps (numbers floated: 10 free lookups/month, ads after 5, or ~50/month) —
  primary goal is stopping heavy resellers from racking up the API/LLM bill.
- eBay commission/affiliate (eBay Partner Network?) on sales the app drives — mechanics unclear
  when the app is used for *valuation* rather than referral; needs research.
- Paid features: analytics dashboard, tax helper, saved-inventory revaluation.
- Social angle (vague; parking lot).

### Open research questions

- What do eBay API calls actually cost / what are the rate limits?
- Which vision model is cheap enough for photo item-ID at scale?
- How does eBay affiliate revenue attribution work for a valuation tool?

## Founder decisions (2026-07-07 Q&A)

1. **Platform**: a web app is acceptable — the deciding factor is **whatever is best for adoption**,
   not platform loyalty. The Docker setup exists to provide a *safe AI development/testing sandbox*,
   not as a product-architecture commitment.
2. **Sold data**: proceed with the compliant fallback strategy (`docs/EBAY_API_NOTES.md`); reassess
   once we know whether eBay grants Marketplace Insights access.
3. **Cost basis**: optional per-item user input. Default use case is decluttering (cost ≈ $0), but
   the app must support **real profit** for serious sellers — this also underpins the future paid
   tax-tracking feature.
4. **User eBay account linking (OAuth)**: **Phase 2.** MVP runs on app-level keys, lookups only.
5. **Photo → LLM item identification**: gated entirely on **economics** — it ships only if the
   per-lookup cost is viable; the founder will not run it at a loss. Barcode-first MVP.

## Data model sketch (items)

`id, name, identifiers (UPC/ISBN/EAN), photo, cost_paid, date_acquired, ebay_value,
value_as_of_date, shipping_estimate, weight, liquidity_score, verdict, status
(flipped/ripped/kept), sale_price, sale_date`
