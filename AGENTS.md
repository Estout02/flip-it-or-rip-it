# AGENTS.md — Flip It or Rip It

Context for any AI agent working in this repository. Read this fully before making changes.
(`CLAUDE.md` carries the same core instructions for Claude Code; this file is the
agent-agnostic superset with current project state.)

## What this project is

A reselling assistant with an anti-consumerism angle: scan an item → eBay valuation − fees −
shipping → verdict **FLIP IT** (worth selling) or **RIP IT** (donate/recycle). The dockerized
backend API in this repo is the product core; a phone frontend (adoption-driven platform
choice, likely iOS-first) comes later and will consume this API.

- Product vision, roadmap, founder decisions: `docs/PROJECT_BRIEF.md`
- eBay data strategy and compliance rules: `docs/EBAY_API_NOTES.md`
- Governing principles (binding): `.specify/memory/constitution.md`

## ⚠️ Hard rules (violations can kill the project)

1. **NEVER scrape eBay.** No fetching eBay pages, no headless browsers, no third-party
   scraper services, no gray-market "sold data" resellers. Official eBay Developer Program
   APIs only, called **server-side** with OAuth application tokens. A ban on the founder's
   eBay account/keys/IP ends the project. This admits no exceptions for any reason.
2. **Sandbox first**: all eBay development runs against `EBAY_ENV=sandbox`. Production keys
   only when the integration is stable and only for real usage.
3. **Money is integer cents everywhere** — code, storage, API payloads (fields suffixed
   `Cents`). Dollars only at the display edge (future frontend). No floats for money.
4. **Latency first**: the lookup hot path (scan → verdict) must stay lean. No heavy
   middleware, no blocking calls, nothing synchronous that can be deferred past the verdict.
5. **Cost discipline**: every external call (eBay, vision LLM) costs money/quota. Cache
   valuations ~24h by product identifier, enforce per-client caps (50 lookups/day), stay
   under 50% of the 5,000/day eBay app quota. Features that can't run profitably don't ship.
6. **All code, tests, and experiments run inside Docker** (`docker compose`), not on the
   host. The containers exist as the safe sandbox for AI-driven development. Host
   `npm install` is only for editor IntelliSense.
7. **Pipeline stays four separable steps**: identification → valuation → shipping estimate →
   verdict, communicating only through explicit typed inputs/outputs. Post-MVP features hook
   in after the verdict. Don't fuse steps for convenience.

The constitution (`.specify/memory/constitution.md`, v1.0.0) is the authority when anything
conflicts; it supersedes this file, CLAUDE.md, and specs.

## Workflow: spec-driven development (GitHub Spec Kit)

**No ad-hoc feature work.** Features flow through:
`/speckit-specify` → (`/speckit-clarify`) → `/speckit-plan` → `/speckit-tasks` →
(`/speckit-analyze`) → `/speckit-implement`

- Templates + constitution: `.specify/`; specs land in `specs/<NNN-name>/`
- The active feature directory is recorded in `.specify/feature.json`
- Every plan must pass the Constitution Check gate before design
- Bug fixes and trivial maintenance may proceed directly; anything changing product
  behavior goes through the flow

## Current state (2026-07-07)

- **Scaffold + planning done, implementation not started.** `src/server.ts` has a stubbed
  `POST /api/lookup`; `src/lib/verdict.ts` holds real, tested verdict math (median pricing,
  integer cents, liquidity score).
- **Feature `specs/001-valuation-pipeline/` is fully specced and ready for
  `/speckit-implement`**: replaces the stub with real eBay sandbox integration.
  26 tasks (T001–T026) in `tasks.md`, organized by user story:
  - Phase 1–2: config + foundations (eBay OAuth/Browse client, TTL cache, rate limiter,
    verdict extensions, `buildApp(deps)` factory)
  - Phase 3 (US1, MVP): barcode UPC/ISBN/EAN lookup → verdict
  - Phase 4 (US2): free-text title lookup + gtin→title fallback
  - Phase 5 (US3): per-request `costBasisCents` / `profitThresholdCents` personalization
  - Phase 6: sandbox smoke script, quota headroom observability (`getRateLimits`), docs,
    full verification
  - Tests are written FIRST per story (fake `EbayBrowseClient` injected; live credentials
    never needed for tests)
- **Key design decisions** (full rationale in `specs/001-valuation-pipeline/research.md`):
  no new runtime dependencies (native `fetch`); valuation = median of the 10 lowest-priced
  active listings, always flagged `pricingBasis: "ASKING_PRICE"` (no sold-data access yet —
  Marketplace Insights API is approval-gated; Browse API is the compliant fallback);
  liquidity = supply-side heuristic `min(1, 10/activeListingCount)` flagged
  `SUPPLY_SIDE_ONLY`; in-memory 24h cache of the *valuation* (not the verdict) keyed
  `gtin:<digits>` / `title:<normalized>`; dual rate limiting (50/day/client by IP + global
  2,500/day eBay budget, 30s cooldown on 429/5xx); "no market data" is a legitimate 200 RIP,
  distinct from a 503 temporary failure.
- API contract: `specs/001-valuation-pipeline/contracts/lookup-api.yaml` (OpenAPI 3.1)
- Validation guide: `specs/001-valuation-pipeline/quickstart.md`

## Stack

- **API**: Node 24 + TypeScript 5.7 (ESM) + Fastify 5, `src/server.ts`, run via `tsx`
- **DB**: Postgres 17 (compose service `db`) — provisioned but **unused** until saved
  inventory lands post-MVP; keep the API stateless (in-memory cache/counters only)
- **Tests**: Vitest, colocated `*.test.ts` next to source
- **Runtime**: Docker Compose; source volume-mounted with `tsx watch` (hot reload)

## Commands (always via Docker)

```bash
docker compose up --build                       # API on :3000, Postgres on :5432
docker compose run --rm api npm test            # run tests
docker compose run --rm api npm run typecheck   # typecheck
docker compose down                             # stop (-v to drop the Postgres volume)

# smoke test
curl localhost:3000/health
curl -X POST localhost:3000/api/lookup -H 'content-type: application/json' \
  -d '{"title":"Chrono Trigger SNES"}'
```

## Configuration

Copy `.env.example` → `.env` (gitignored; never commit credentials). eBay credentials come
from the founder's eBay developer account (sandbox keyset during development).

Current vars: `EBAY_CLIENT_ID`, `EBAY_CLIENT_SECRET`, `EBAY_ENV=sandbox`,
`ANTHROPIC_API_KEY` (future photo-ID), `PROFIT_THRESHOLD_DEFAULT=10` (USD; converted to
cents once at startup), `PORT`.

Feature 001 adds (T001): `EBAY_MARKETPLACE_ID=EBAY_US`, `EBAY_FEE_RATE=0.1325`,
`SHIPPING_FLAT_CENTS=500`, `VALUATION_CACHE_TTL_HOURS=24`, `LOOKUP_DAILY_CAP=50`,
`EBAY_DAILY_CALL_BUDGET=2500`.

## Conventions

- Integer cents for all money; `Cents`-suffixed field names
- Steps of the verdict pipeline never import each other's internals
- External clients are injectable interfaces (`EbayBrowseClient` in `src/lib/ebay/types.ts`)
  so tests run against fakes — tests must never require live eBay credentials
- Malformed input is rejected before any external call is made
- Label valuation honesty explicitly: asking-price-based pricing and supply-side-only
  liquidity flags stay in every response until real sold data exists
- Commit after each task or logical group; test suite must pass in Docker before commits

## Out of scope (do not build without a new spec)

User accounts/auth, eBay user OAuth (phase 2), photo/vision-LLM identification
(economics-gated — ships only if per-lookup cost is viable), auto-listing/drafts, saved
inventory (unlocks Postgres), gamification, tax tracking.
