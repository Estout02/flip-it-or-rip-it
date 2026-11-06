<!--
Sync Impact Report
==================
STATUS: PROPOSED — prepared 2026-11-06 on a feature branch for founder review. Not ratified
until Eric approves; until then v1.1.0 (on `main`) governs. Nothing downstream may rely on
v2.0.0 being in force.

Version change: 1.1.0 → 2.0.0
Rationale: MAJOR — Principle I is redefined (it currently bans every non-eBay price source and
says nothing about licence terms; it becomes "data compliance" with an explicit licence rule and
an approved-sources list), and the "Stateless MVP" constraint is removed. Both are backward
incompatible with how the current specs were written. Requested through the 2026-11-02
review-and-plan (`docs/REVIEW-AND-PLAN.md` on branch `plan/phone-app`, §3.3 and §6 open item 2)
and confirmed by the founder on 2026-11-06: phone app on Expo, resellers as the paying customer,
declutterers as the free funnel, tiers Free / Side Hustle / Pro, no founding-member discount.

Modified principles:
- I.   eBay Compliance Is Non-Negotiable → Data Compliance Is Non-Negotiable. Keeps every
       eBay rule. Adds: licences are read, not assumed; eBay Content may not drive price or
       sell-through signals shown to anyone but the founder until written consent is on file;
       approved-source list (consented eBay, other marketplaces' official APIs, founder-approved
       licensed providers, user-owned data); scraper-backed vendors stay banned.
- II.  Latency First — adds the native app and a pointer to its spec for budgets.
- III. Cost Discipline — adds tier caps keyed to install/account (not IP) and the store
       commission to the "can it run profitably" test.
- V.   Sandbox-First Testing — names the narrow exception for on-device and EAS-build steps.
- VII. Extensible Verdict Pipeline — names the two seams the roadmap needs (price source in
       valuation; fees as a pure, injected computation between valuation and verdict).
- VIII. Accessible by Default — extends to the native app (platform accessibility APIs, screen
       reader walkthrough on device).
Added principles:
- IX. Deterministic, Source-Backed Rules (fee schedules, rates, thresholds are dated data with a
      cited source; no invented current rates; integer-cent rounding is specified).
- X.  Honest Claims (estimates are not appraisals; tax and donation features are not tax advice).
Modified sections:
- Additional Constraints → Stack: adds the Expo app (`mobile/`, from spec 012).
- Additional Constraints → "Stateless MVP" replaced by "State enters only through a spec".
- Additional Constraints → "Valuation honesty" generalised to every price source.
- Additional Constraints → new "Product direction" and "Data provenance register" bullets.
- Development Workflow → review checklist gains (I licence check, IX, X).
Removed sections: none (the stateless-MVP bullet is replaced, not dropped).

Templates checked:
- ✅ .specify/templates/plan-template.md — Constitution Check is filled per feature; no edit.
- ✅ .specify/templates/spec-template.md — no principle references; no edit.
- ✅ .specify/templates/tasks-template.md — no principle references; no edit.
- ⚠ CLAUDE.md, AGENTS.md — still describe the v1.1.0 world (AGENTS.md "Current state" is dated
  2026-07-07). Refresh when v2.0.0 is approved; not done here (out of this phase).
- ⚠ docs/EBAY_API_NOTES.md — states "Asking-price data is the permanent basis". A dated pointer
  to this amendment was added; the section itself is rewritten under spec 010 (price source).
- ⚠ .claude/agents/sk-*.md and .claude/skills/speckit-orchestrate — no principle numbers are
  hard-coded; not re-audited beyond a grep.

Deferred TODOs:
- TODO(eBay consent): written consent request is a founder action; status unknown. The
  amendment assumes it has NOT been granted.
- TODO(legal): counsel read on pooling user-reported sale prices and on a user's own eBay
  history (roadmap B3/B4) before either is relied on. Referenced by Principle I.
- TODO(tax): a tax professional reads donation / tax-export copy before launch (Principle X).
-->

# Flip It or Rip It Constitution

## Core Principles

### I. Data Compliance Is Non-Negotiable

A ban on the founder's eBay account, developer keys, or IP — or the loss of any other data
provider's licence — kills the project. Therefore:

- **Never scrape eBay or any marketplace** — no fetching marketplace pages, no headless
  browsers, no third-party scraper services or gray-market "sold data" resellers that scrape
  on our behalf.
- All eBay data comes from **official eBay Developer Program APIs only**, authenticated with
  OAuth application tokens.
- All eBay calls happen **server-side from our API** — never from user devices carrying our
  keys.
- Development runs against the **eBay Sandbox** (`EBAY_ENV=sandbox`); production keys are used
  only once the integration is stable and only for real usage.
- Rate limits are respected proactively: our own limiter + cache in front of every eBay call,
  back off on 429s, and quota headroom checked via the Developer Analytics API
  (`getRateLimits`) rather than discovered by exhaustion.
- **Licences are read, not assumed.** Every plan that uses a provider's data MUST cite the
  licence clause that permits that use. Absence of an objection is not permission.
- **eBay's licence restricts price modelling.** The eBay API License Agreement forbids using
  eBay Content, alone or combined with other information, to suggest or model prices for items
  listed on eBay, and requires eBay's written permission to derive average selling prices or
  completion / success (sell-through) rates. Until that written consent is recorded in the data
  provenance register, eBay Content MUST NOT drive any price estimate, value band, or
  liquidity / sell-through signal shown to anyone other than the founder using the app
  personally. Identification and display of listings (with a link to eBay) remain permitted.
  Consent is never assumed; its absence is the default state.
- **Approved value sources** — a source may feed valuation only once it is in the register with
  its licence basis and provenance: (a) eBay Content covered by recorded written consent;
  (b) other marketplaces' official APIs, within their terms; (c) licensed data providers the
  founder has approved, including how *they* source their data; (d) data users supply or own
  about their own items and sales. Pooling users' data across users (b/d crowd comps) needs a
  legal read recorded first.
- Scraper-backed vendors and gray-market data stay banned regardless of price or accuracy.

No feature, deadline, or data gap justifies violating this principle. A data gap is bridged by
an approved source, a clearly labelled "we can't value this one", or no feature — never by
scraping or by quietly reading a licence generously.

### II. Latency First

The product's core promise is a verdict faster than a manual eBay-app sold-listings check.
The scan-to-verdict path MUST feel instant.

- No heavy middleware, no blocking calls, and no synchronous non-essential work in the
  lookup hot path.
- Every addition to the lookup path (auth, logging, persistence, analytics, fee or price-source
  lookups) MUST justify its latency cost; anything deferrable runs after the verdict is returned.
- Performance regressions on the lookup path are release blockers, not backlog items.
- Latency includes the client: the web client's initial load stays within its spec's budget
  (≤ 100 KB compressed for spec 006), heavy capabilities (e.g. the barcode decoder) load only
  when the user invokes them, and the native app's scan-to-verdict budgets are set in its own
  spec (012) and enforced the same way.

### III. Cost Discipline

Every external call — eBay API, vision LLM, shipping lookup, licensed data provider — costs
money or quota. Features that cannot be run profitably do not ship.

- Valuations MUST be cached by product identifier (UPC/ISBN/EAN/EPID) for ~24 hours (or the
  shorter freshness limit a provider's licence imposes); a repeated scan of the same product
  costs zero external calls.
- Per-user lookup caps are enforced in our API from day one, sized to keep aggregate usage well
  under the 5,000/day eBay app quota. Once installs or accounts exist (specs 013, 016, 017) caps
  and tier limits key on the install or account, not the IP address.
- Photo → vision-LLM item identification is explicitly **economics-gated**: it ships only if
  per-lookup cost is viable. Barcode-first is the MVP path.
- New features that add external calls MUST state their per-lookup cost and cap strategy in the
  spec/plan before implementation; features sold in an app store state the store commission
  in that arithmetic.
- Paid third-party services are added only by a spec that states the monthly cost and the
  founder's approval; nothing is subscribed to speculatively.

### IV. Spec-Driven Development

Features are built through the Spec Kit flow: `/speckit-specify` → `/speckit-plan` →
`/speckit-tasks` → `/speckit-implement` (with `/speckit-clarify` and `/speckit-analyze` as
needed). No ad-hoc feature work.

- Specs land in `specs/`; founder decisions recorded in `docs/PROJECT_BRIEF.md` feed them.
- Bug fixes and trivial maintenance may proceed directly, but anything that adds or changes
  product behavior goes through the flow.
- Founder approval points (before implementation, before a PR) are never skipped or inferred.

### V. Sandbox-First Testing

All code, tests, and experiments run inside the Docker containers (`docker compose`), not on the
host. The containers exist specifically as a safe environment for AI-driven development and
testing.

- Tests: `docker compose run --rm api npm test`; typecheck likewise inside the container.
- Local `npm install` on the host is permitted only for editor IntelliSense.
- **Exception, stated per spec:** steps that cannot run in a container (simulator or physical
  device checks, EAS builds, store submission) are listed explicitly in that spec's test plan as
  manual or external steps. JavaScript tests and typechecks for the native app still run in
  Docker.

### VI. Money Is Integer Cents

All monetary values — prices, fees, shipping, thresholds, profit — are handled as integer
**cents** everywhere in code, storage, and API payloads. Conversion to dollars happens only at
the display edge. No floats for money, ever. Percentage rates are applied in integer arithmetic
with a specified rounding rule (Principle IX).

### VII. Extensible Verdict Pipeline

The pipeline stays four separate, composable steps: **identification → valuation → shipping →
verdict**. Post-MVP features (one-tap listing, auto-drafts, saved inventory, sales and donation
logs, tax export, revaluation notifications) MUST be able to hook in after the verdict without
reworking the pipeline.

- No step may reach into another's internals; each communicates through explicit
  inputs/outputs.
- Shortcuts that fuse steps for convenience are constitution violations even if faster to write.
- Two seams are sanctioned because the roadmap needs them: valuation obtains prices through a
  price-source interface that reports provenance (spec 010), and marketplace fees are a pure,
  deterministic computation that valuation's output feeds and the verdict step consumes as an
  explicit typed input (spec 009). Neither seam lets the verdict step import another step's
  internals.

### VIII. Accessible by Default (WCAG 2.2 AA)

A reseller who can't see a color, use a mouse, or read small text must get the same verdict, as
fast. Every user-facing surface — web client and native app — MUST conform to **WCAG 2.2 Level
AA**, applied through the platform's accessibility APIs on native.

- Meaning is never carried by color alone — verdicts combine text, icon, and color.
- Everything is keyboard-operable (or switch/screen-reader-operable on native) with a visible,
  unobscured focus indicator; touch targets are at least 44×44 CSS px (44×44 pt on iOS, 48×48 dp
  on Android).
- Status changes (results, errors) are announced to assistive technology.
- Color tokens are contrast-verified (4.5:1 text, 3:1 UI) in every supported color scheme, and
  layouts reflow at 320 px / 400% zoom (web) or the largest supported text size (native).
- Automated accessibility checks run on every screen state (axe on web; the native equivalent
  named in spec 012); a new state without an accessibility test is incomplete. Automated checks
  do not replace a keyboard and screen-reader walkthrough before release — VoiceOver and TalkBack
  on a real device for the native app.

### IX. Deterministic, Source-Backed Rules

Fee schedules, rates, brackets, shipping tables, and thresholds that decide a verdict or a
logged amount are **data with provenance**, not constants buried in code.

- Every such rule records its source URL, the date it was verified, and the schedule's effective
  scope (marketplace, region, seller type). No current rate is invented or "approximately
  remembered"; a rule without a source is a placeholder that fails review.
- The computation is deterministic: same inputs and same rule data produce the same cents,
  with the rounding rule stated in the spec and covered by tests.
- Assumptions the user did not supply (e.g. the seller pays shipping, sales tax excluded,
  standard seller-performance level) are listed, returned in the response, and surfaced to the
  user — never silent.
- Rule data older than its stated review interval is flagged, not trusted indefinitely.

### X. Honest Claims

The product says what it knows and what it does not.

- Every price or value shown is labelled an estimate, with its basis and provenance (this
  replaces "asking-price-based, supply-side-only" flags as the general rule; those flags remain
  while those bases are in use). A value band is not an appraisal.
- "We could not identify your item" is never rendered as "it is worthless".
- Donation, tax-export, and deduction features are record-keeping aids, not tax advice; their
  copy states that plainly and is reviewed by a tax professional before launch.

## Additional Constraints

- **Stack**: Node 24 + TypeScript + Fastify API (`src/server.ts`); Postgres 17 provisioned;
  Vitest for tests. Web client in `web/` (Preact + TypeScript + Vite, its own package), served
  same-origin by the API in production; Playwright for end-to-end and accessibility tests. The
  phone app is an **Expo** (React Native + TypeScript) app in `mobile/` with its own package,
  introduced by spec 012; it consumes the same API and shares typed contracts, not UI code.
- **State enters only through a spec**: the API holds no per-user server state beyond caching
  and rate-limit counters until a spec introduces it (device identity and persistent limits —
  013; accounts — 016; subscriptions — 017). Postgres is the store when it does.
- **Secrets**: eBay credentials live in `.env` (gitignored, from `.env.example`); never
  committed, never shipped to clients — including the native app bundle.
- **Valuation honesty**: whatever the price source, the result carries its pricing basis and
  provenance (Principle X). While valuations derive from Browse API active listings they MUST be
  labelled asking-price-based and the liquidity signal marked supply-side only (see
  `docs/EBAY_API_NOTES.md`) — and Principle I limits who may see them.
- **Product direction** (binding on specs 012–017): resellers are the paying customer;
  declutterers are the free funnel. Tiers are Free, Side Hustle, and Pro; their prices and caps
  are set in spec 017. There are no founding-member or launch discounts. Paid-intent tests are
  run at the real price.
- **Data provenance register**: `docs/DATA_SOURCES.md` (created by spec 010; until then, the
  section of each spec's research that cites the source) lists every price source, fee rule set,
  and licence basis with dates and consent status.

## Development Workflow

- Read `docs/PROJECT_BRIEF.md` before product decisions and `docs/EBAY_API_NOTES.md` before
  touching the eBay integration.
- The Spec Kit flow (Principle IV) is the unit of feature delivery; each feature's plan MUST
  pass the Constitution Check gate against this document before Phase 0 research.
- Reviews verify, at minimum: no scraping or client-side eBay calls and every data use traced
  to a licence clause (I), no new blocking work in the lookup path (II), caching/caps for any
  new external call (III), work traces to a spec and approvals were not skipped (IV), tests run
  in Docker or the exception is listed (V), money in cents (VI), pipeline step boundaries intact
  (VII), accessibility checks for every new UI state (VIII), rules carry source and date and
  assumptions are surfaced (IX), claims are labelled and tax copy is not advice (X).

## Governance

This constitution supersedes all other practices in this repository. Where CLAUDE.md,
templates, or specs conflict with it, the constitution wins and the conflicting artifact is
amended.

- **Amendments**: proposed as a PR editing this file, including a Sync Impact Report, version
  bump, and updates to any dependent templates/docs. The founder approves amendments.
- **Versioning**: semantic — MAJOR for removing/redefining a principle, MINOR for adding a
  principle or materially expanding guidance, PATCH for clarifications and wording.
- **Compliance review**: every `/speckit-plan` Constitution Check gates on this document;
  violations require an entry in the plan's Complexity Tracking table with a justification or
  the design is revised. Principle I admits no justified violations.

**Version**: 2.0.0 (PROPOSED, pending founder approval; ratified version on `main` is 1.1.0) | **Ratified**: 2026-07-07 | **Last Amended**: 2026-11-06 (proposed)
