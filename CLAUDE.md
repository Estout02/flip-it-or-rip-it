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
a 50/day per-client cap, and a global daily eBay-call budget.

Free-text lookups are **product-match filtered** (spec `specs/004-product-match-filtering/`).
Searching a title returns the item mixed with things *about* it — stickers, magnets, mousepads,
cases — and valuing the ten cheapest reliably valued the junk. Listings are now grouped by leaf
category, only the dominant group is valued, and the estimate is drawn from that whole group rather
than the cheapest ten. **Barcode lookups bypass filtering entirely** (eBay already constrains them
to one product) and keep `sort=price`; title searches drop the price sort so relevance ordering
survives. Every response carries `matchConfidence`, `matchedCategoryName`, `matchDominance` and
`matchFiltered`. Confidence is the worse of two measures — category dominance and price dispersion
*within* the matched group — and LOW confidence yields a fourth verdict state, **`UNCERTAIN`**,
which means "we could not identify your item", not "it is worthless". **Variant and region
separation is NOT solved**: a Japanese import and a US cartridge share a category, so an ambiguous
query honestly returns UNCERTAIN rather than a confident wrong number.

Valuation applies a **realization rate** (spec `specs/003-realization-rate/`): sellers list
aspirationally, so the asking-price median is biased high and produced false FLIPs. The reported
`estimatedValueCents` is now `round(median × VALUATION_REALIZATION_RATE)` — expected *sale* price,
not asking price — with fees computed from it, `pricingBasis: ADJUSTED_ASKING_PRICE`, and both
`rawAskingMedianCents` and `realizationRate` on the response so the figure is reconstructable.
**The 0.8 default is a founder judgment call, not a measured figure**; the feature's real
deliverable is that it stays retunable once user-reported sale outcomes exist to calibrate it.

The verdict is **liquidity-gated** (spec `specs/002-liquidity-score/`) and therefore **three-way**:
`FLIP` / `FLIP_RISKY` / `RIP`. Every result carries a `liquidityTier` (STRONG / MODERATE / WEAK /
UNPROVEN) derived from active-listing count, plus a `reasonCode` and plain-language `reason`. A
weak-tier (flooded-market) item that clears the profit threshold only thinly is downgraded to RIP;
one with a comfortable margin (≥ 2× threshold by default) becomes FLIP_RISKY — worth listing, but
expect a slow sale. The gate is downgrade-only, adds zero eBay calls, and lives entirely in the
verdict step. Zero competing listings reads as UNPROVEN and never gates in either direction. Tests use a fake `EbayBrowseClient`;
the only code that touches the real sandbox is the opt-in smoke script:
`docker compose run --rm api npx tsx scripts/sandbox-smoke.ts`. New env vars (see `.env.example`):
`EBAY_MARKETPLACE_ID`, `EBAY_FEE_RATE`, `SHIPPING_FLAT_CENTS`, `VALUATION_CACHE_TTL_HOURS`,
`LOOKUP_DAILY_CAP`, `EBAY_DAILY_CALL_BUDGET`, `TRUST_PROXY`, plus the liquidity knobs
`LIQUIDITY_STRONG_MAX_LISTINGS`, `LIQUIDITY_MODERATE_MAX_LISTINGS`,
`LIQUIDITY_RISKY_MARGIN_MULTIPLIER`, `VALUATION_REALIZATION_RATE`, and the match thresholds
`MATCH_MIN_DOMINANCE_HIGH`, `MATCH_MIN_DOMINANCE_MEDIUM`, `MATCH_MAX_DISPERSION_HIGH`,
`MATCH_MAX_DISPERSION_MEDIUM`.

The **web client** (spec `specs/006-web-client/`) is the product's face: a mobile-first,
installable web app in its own package, `web/` (Preact + TypeScript + Vite, hand-written CSS, no
web fonts or icon libraries), served same-origin by the API in production. One screen: scan or type
→ verdict, reason and figures → next item. The camera scanner (native `BarcodeDetector`, else the
`barcode-detector` ZXing-WASM ponyfill with the `.wasm` self-hosted — never a CDN) is lazy-loaded on
the first Scan tap and never costs the typing path. Settings (minimum profit) and the last 50
results live only in the device's `localStorage`. It must meet **WCAG 2.2 AA** (constitution VIII):
contrast-verified tokens in `web/src/styles/tokens.css`, semantic HTML, managed focus, live-region
announcements, and axe checks on every screen state in both the unit suite and the Playwright e2e
matrix. The initial download is capped at **100 KB gzip** by `web/scripts/check-size.mjs`, which
`npm test` runs after a build. All UI copy comes verbatim from
`specs/006-web-client/contracts/ui-states.md`. Native apps may follow later on the same API.

Spec `specs/005-backend-hardening/` closes gaps found after 004: the per-client daily cap now
tracks the connecting socket address unless `TRUST_PROXY` is explicitly set (a hop count or a
comma list of trusted proxy IPs/CIDRs) — previously `trustProxy: true` trusted every hop, letting
`X-Forwarded-For` reset anyone's cap at will. Liquidity for title searches now reads
`competingSupplyCount` (the raw active-listing total scaled by match dominance, floored at the
matched listings seen) rather than the raw total, which otherwise counted filtered-out
merchandise as competition; the response carries both that figure and the raw
`rawActiveListingCount`. Barcode lookups with a title fallback get a per-title cached answer (key
`gtin:<digits>|title:<normalized title>`) instead of the fallback being hidden behind the
barcode's own cache entry for the whole TTL. Identical concurrent lookups for the same cache key
now coalesce into one in-flight computation, so a burst of requests for one item costs one
eBay call, not one per request. Request bodies are strict — an unknown field (e.g. a misspelled
`costBasis`) is rejected with 400 naming the field, rather than silently ignored — and every
numeric server setting (`LOOKUP_DAILY_CAP`, `EBAY_FEE_RATE`, `PORT`, etc.) is range-validated with
a `console.warn` + fallback on an invalid value. The per-client rate-limiter map is cleared once
per UTC day rather than growing forever.

## Stack

- **API**: Node 24 + TypeScript + Fastify (`src/server.ts`), chosen for speed — lookup latency is
  the product's #1 requirement.
- **DB**: Postgres 17 (compose service `db`); no schema yet — saved-item inventory comes post-MVP.
- **Web client**: `web/` — Preact + TypeScript + Vite, its own `package.json` (its deps never
  enter the API image). `vite-plugin-pwa` for the offline shell and install; no runtime deps
  beyond `preact` and the lazily imported `barcode-detector`.
- **Tests**: Vitest (API; web units + axe in jsdom); Playwright + `@axe-core/playwright` (web e2e).
- **Sandbox**: everything runs in Docker. The containers exist specifically as a *safe environment
  for AI-driven development and testing* — run code, tests, and experiments inside them, not on the
  host.

## Commands

All development and testing happens in Docker:

```bash
docker compose up --build        # API :3000, web client (Vite dev) :5173, Postgres :5432
docker compose run --rm api npm test        # run tests in the sandbox
docker compose run --rm api npm run typecheck
docker compose run --rm web npm test        # web: vitest (jsdom + axe) + build + 100 KB budget
docker compose run --rm web npm run typecheck
docker compose --profile e2e run --rm e2e   # web: Playwright e2e + accessibility matrix (API mocked)
docker compose run --rm web npm run build   # → web/dist, served by the API in production
docker compose down              # stop; add -v to drop the Postgres volume
```

The `web` service mounts `./web` with an anonymous `node_modules` volume, so after changing web
dependencies run `docker compose build web`. The root `.dockerignore` excludes `web/node_modules`
and `web/dist` from the API image context.

Everything above runs against the eBay **sandbox** — `docker compose` reads `.env`, which stays on
`EBAY_ENV=sandbox` deliberately, so nothing run without thinking can reach production. Production
requires naming the overlay explicitly on each invocation:

```bash
docker compose -f docker-compose.yml -f docker-compose.prod.yml up        # reads .env.production
```

The overlay uses `env_file: !override`, so `.env` is replaced rather than merged — there is no
state where production env meets a sandbox credential. This is deliberately not an env-var switch
(`ENV_FILE=...`): an exported shell variable would silently point every later command at
production, and the whole point is that the choice stays visible at the call site.

`.env.production` is gitignored and holds the production keyset. Note that
`scripts/sandbox-smoke.ts` honors whatever environment it is given — run under the overlay it
makes **real production calls** despite its name; it prints the active environment on its first
line, so check that line before trusting a run.

Source is volume-mounted with `tsx watch`, so edits hot-reload inside the container. Local
`npm install` is only needed for editor IntelliSense.

Quick smoke test:

```bash
curl localhost:3000/health
curl -X POST localhost:3000/api/lookup -H 'content-type: application/json' \
  -d '{"title":"Chrono Trigger SNES","costBasisCents":0}'
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
