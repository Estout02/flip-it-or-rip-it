# Checkpoint 1 — constitution v2.0.0 + spec 009 (fee model)

**Stop.** No implementation, no PR, no merge, no deploy until Eric answers below.

Branch: `cursor/constitution-v2-fee-model-spec-c607`
(Spec Kit would have named the git branch `009-fee-model`; the cloud-agent branch prefix won.
The spec directory is `specs/009-fee-model/`.)

## What to approve

### 1. Constitution v2.0.0 (PROPOSED)

Commit `65be0ff`. v1.1.0 stays in force on `main` until you say otherwise.

Headline changes:

- Principle I becomes **data compliance**: licences are read; eBay Content may not drive a price or
  sell-through signal shown to anyone but you until written consent is on file; approved sources
  listed; scrapers still banned.
- New IX (dated, source-backed rules) and X (honest claims).
- Stack names the Expo app (`mobile/`, spec 012). Product direction: resellers pay, declutterers
  are the free funnel; Free / Side Hustle / Pro; no founding-member discount.
- "Stateless MVP" replaced by "state enters only through a spec".

Not in this amendment: Jev, paid data subscriptions, eBay consent (still your action), tax-copy
legal review.

### 2. Spec 009 — fee calculation (planning only)

Replace the silent flat 13.25% with a deterministic US schedule: category final-value fee +
per-order fee, integer cents, integer basis points, assumptions returned on the response.

Rates are transcribed from the Underpriced MIT table v1.1.1 (publisher check 2026-11-01).
**ebay.com was not fetched.** Status ships as `THIRD_PARTY_UNVERIFIED`.

**Live lookups do not use those cents until you mark the schedule `FOUNDER_VERIFIED` after
checking eBay's selling-fees page.** Until then production still charges `EBAY_FEE_RATE` and
says `SCHEDULE_NOT_FOUNDER_VERIFIED`. Tests may apply the math with an explicit flag.

ISBN (978/979) ⇒ Books. Other items use "most categories" (13.6%) until a category map is
populated from eBay's Taxonomy API (not in this build).

## Working defaults — confirm or change

1. Unknown fee category → most categories (13.6%), flagged `FEE_CATEGORY_ASSUMED`.
2. Buyer-paid shipping and sales tax default to 0 (`SELLER_PAYS_SHIPPING`, `SALES_TAX_EXCLUDED`).
3. Non-`EBAY_US` → flat `EBAY_FEE_RATE`, flagged `LEGACY_FLAT_RATE_NO_SCHEDULE`.
4. Stale after 45 days from `verifiedAt`.
5. Unverified third-party rates do **not** change live verdicts (FR-017). Override only if you
   explicitly want the new cents in production before you check eBay's page.

## Still open (not 009)

- eBay written consent / spec 010 (price source and bands).
- Category-map script (B1).
- Sales/donation log, Expo shell, and later specs. Not started.
- `docs/REVIEW-AND-PLAN.md` still lives only on `plan/phone-app`.

## What "Build it" would mean

23 tasks, 6 work packages, Docker tests, no new dependencies, no eBay calls, no UI. First
production behaviour change is a `feeBreakdown` on the response and a startup warning; fee
amounts stay as they are until you verify the table.

## Ask

- **Approve constitution v2.0.0** (or send revisions).
- **Approve spec 009 as planned** / **revise first** / **stop**.
- Confirm or change the five defaults.
- Optionally: after approval, verify the table against
  `https://www.ebay.com/help/selling/fees-credits-invoices/selling-fees?id=4822` (your browser;
  we will not fetch eBay pages) and tell us whether to flip `FOUNDER_VERIFIED` in the same
  implementation or in a follow-up.
