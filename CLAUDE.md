# Flip It or Rip It

Reselling assistant: scan an item → eBay sold-listings valuation − fees − shipping → verdict
**FLIP IT** (sell it) or **RIP IT** (donate/recycle). Full product picture, roadmap, and open
questions live in `docs/PROJECT_BRIEF.md` — read it before making product decisions.

## Workflow: spec-driven development (Spec Kit)

Features are built with [GitHub Spec Kit](https://github.com/github/spec-kit) — do not implement
features ad hoc. The flow: `/speckit-constitution` → `/speckit-specify` → `/speckit-plan` →
`/speckit-tasks` → `/speckit-implement` (optionally `/speckit-clarify` before plan,
`/speckit-analyze` before implement). Templates and the project constitution live in `.specify/`;
specs land in `specs/`. Founder decisions recorded in `docs/PROJECT_BRIEF.md` feed the specs.

## Current state

The core valuation pipeline is real (spec `specs/001-valuation-pipeline/`): identifier resolution
(UPC/ISBN/EAN incl. ISBN-10→13), eBay Browse API valuation (sandbox, OAuth app token, median of the
10 lowest asking prices flagged `ASKING_PRICE`), flat shipping estimate, and the verdict math in
`src/lib/verdict.ts` — orchestrated by `src/lib/pipeline.ts` behind a 24h in-memory valuation cache,
a 50/day per-client cap, and a global daily eBay-call budget. Tests use a fake `EbayBrowseClient`;
the only code that touches the real sandbox is the opt-in smoke script:
`docker compose run --rm api npx tsx scripts/sandbox-smoke.ts`. New env vars (see `.env.example`):
`EBAY_MARKETPLACE_ID`, `EBAY_FEE_RATE`, `SHIPPING_FLAT_CENTS`, `VALUATION_CACHE_TTL_HOURS`,
`LOOKUP_DAILY_CAP`, `EBAY_DAILY_CALL_BUDGET`. The phone frontend (likely iOS-first) comes later and
will consume this API.

## Stack

- **API**: Node 24 + TypeScript + Fastify (`src/server.ts`), chosen for speed — lookup latency is
  the product's #1 requirement.
- **DB**: Postgres 17 (compose service `db`); no schema yet — saved-item inventory comes post-MVP.
- **Tests**: Vitest.
- **Sandbox**: everything runs in Docker. The containers exist specifically as a *safe environment
  for AI-driven development and testing* — run code, tests, and experiments inside them, not on the
  host.

## Commands

All development and testing happens in Docker:

```bash
docker compose up --build        # API on http://localhost:3000, Postgres on 5432
docker compose run --rm api npm test        # run tests in the sandbox
docker compose run --rm api npm run typecheck
docker compose down              # stop; add -v to drop the Postgres volume
```

Source is volume-mounted with `tsx watch`, so edits hot-reload inside the container. Local
`npm install` is only needed for editor IntelliSense.

Quick smoke test:

```bash
curl localhost:3000/health
curl -X POST localhost:3000/api/lookup -H 'content-type: application/json' \
  -d '{"title":"Chrono Trigger SNES","costBasis":0}'
```

## Configuration

Copy `.env.example` to `.env` (gitignored). eBay credentials come from the founder's eBay developer
account. `PROFIT_THRESHOLD_DEFAULT` is the flip/rip cutoff in USD (default 10).

## eBay compliance (read `docs/EBAY_API_NOTES.md` before touching the eBay integration)

The founder's eBay account must never be put at risk. **Never scrape eBay pages or use scraper
services — official Developer Program APIs only**, called server-side with OAuth app tokens,
against the **sandbox** environment (`EBAY_ENV=sandbox`) during development. Sold-listings data
requires the approval-gated Marketplace Insights API; until granted, valuations come from Browse
API active listings (5,000 calls/day app quota — cache by product identifier and rate-limit
per user).

## Conventions & constraints

- **Latency first**: the eBay lookup path must stay lean — no heavy middleware, no blocking calls
  in the lookup hot path. Target: verdict faster than a manual eBay-app check.
- **Cost second**: every external call (eBay API, vision LLM) costs money; design with per-user
  caps in mind from the start.
- **Extensible verdict pipeline**: identification → valuation → shipping → verdict are separate
  steps so post-MVP features (auto-listing, drafts) can hook in after the verdict.
- Money is handled in integer **cents** everywhere; convert to dollars only at the display edge.
- Keep the API stateless for MVP; Postgres is provisioned but unused until saved inventory lands.
