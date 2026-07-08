# Implementation Plan: Core Valuation Pipeline

**Branch**: `001-valuation-pipeline` | **Date**: 2026-07-07 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/001-valuation-pipeline/spec.md`

## Summary

Replace the stubbed `POST /api/lookup` with the real pipeline: resolve a UPC/ISBN/EAN or
free-text title via the eBay Browse API (sandbox, OAuth client-credentials app token), value
the item as the median of the 10 lowest-priced active listings (flagged asking-price-based),
apply a configurable $5.00 flat shipping estimate, and feed the existing tested verdict math.
Wrap the eBay call in a 24h TTL cache (identifier / normalized-title keyed), a 50/day
per-client cap, and a global daily eBay-call budget. The four pipeline steps — identify →
value → ship-estimate → verdict — stay separate modules with explicit input/output types.

## Technical Context

**Language/Version**: TypeScript 5.7 on Node 24 (ESM, `tsx` runtime)

**Primary Dependencies**: Fastify 5 (existing). **No new runtime dependencies** — eBay HTTP
calls use Node's native `fetch` with `AbortSignal.timeout`; cache and rate limiter are small
in-memory modules (cost/latency discipline; avoids supply-chain surface).

**Storage**: None (stateless MVP per constitution). Cache and rate-limit counters are
in-memory with TTL; Postgres stays unused until saved inventory.

**Testing**: Vitest, colocated `*.test.ts` (existing convention), run via
`docker compose run --rm api npm test`. eBay client injected as an interface so pipeline
tests run against a fake; a separate opt-in smoke script exercises the real sandbox.

**Target Platform**: Linux container (Docker Compose), API consumed later by a phone frontend

**Project Type**: Single-project web service (extends existing `src/`)

**Performance Goals**: Uncached lookup < 3s end-to-end (SC-001); cached lookup < 500ms with
zero external calls (SC-002); hot path = cache check → ≤1 Browse API call → pure math

**Constraints**: eBay sandbox only (`EBAY_ENV=sandbox`); ≤1 Browse call per uncached lookup;
50 lookups/client/day; global daily eBay budget well under 5,000; integer cents in all
payloads; no blocking/heavy middleware on the lookup path

**Scale/Scope**: MVP, single instance, founder + testers; ~6 new modules, 1 endpoint reworked

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| # | Principle | Status | How the design complies |
|---|-----------|--------|------------------------|
| I | eBay compliance | ✅ PASS | Browse API only (official, GA), OAuth client-credentials app token, all calls server-side from `src/lib/ebay/`, `EBAY_ENV=sandbox` for all development, 429 → back off + cooldown (no tight retry), no scraping anywhere. Sold-data gap bridged per `docs/EBAY_API_NOTES.md` Phase 1 fallback. |
| II | Latency first | ✅ PASS | Hot path: in-memory cache lookup → single Browse `item_summary/search` call → pure-function math. No DB, no new middleware; rate-limit check is an O(1) in-memory counter in a Fastify `onRequest` hook scoped to the lookup route. OAuth token cached and refreshed proactively (never fetched inside a user request except the first-ever call). |
| III | Cost discipline | ✅ PASS | Cost statement: ≤1 eBay Browse call per uncached lookup, 0 LLM calls. 24h TTL cache keyed by identifier / normalized title (FR-011); 50/day per-client cap (FR-012); global daily eBay-call budget (default 2,500 = 50% of quota, SC-004) that fails closed with a temporary-failure error. |
| IV | Spec-driven | ✅ PASS | This plan derives from the clarified spec; tasks and implementation follow the Spec Kit flow. |
| V | Sandbox-first testing | ✅ PASS | All tests/typechecks run via `docker compose run --rm api …`; sandbox smoke script runs inside the container. |
| VI | Integer cents | ✅ PASS | All money fields integer cents end-to-end, including request/response payloads (`costBasisCents`, `profitCents`, …). Spec FR-013 was amended to align with the constitution (payloads in cents, dollars only at the future display edge). The existing stub's dollar inputs are corrected in this feature. |
| VII | Extensible pipeline | ✅ PASS | Four modules with explicit typed inputs/outputs: `identify.ts` → `valuation.ts` → `shipping.ts` → existing `verdict.ts`, orchestrated by `pipeline.ts`. No step imports another's internals; post-verdict hooks attach in the orchestrator. |

**Post-Phase-1 re-check**: ✅ PASS — design artifacts (data model, contract) introduce no new
violations; contract payloads are all `…Cents` integers; no additional external calls added.

## Project Structure

### Documentation (this feature)

```text
specs/001-valuation-pipeline/
├── plan.md              # This file (/speckit-plan command output)
├── research.md          # Phase 0 output (/speckit-plan command)
├── data-model.md        # Phase 1 output (/speckit-plan command)
├── quickstart.md        # Phase 1 output (/speckit-plan command)
├── contracts/
│   └── lookup-api.yaml  # Phase 1 output (/speckit-plan command)
└── tasks.md             # Phase 2 output (/speckit-tasks command - NOT created by /speckit-plan)
```

### Source Code (repository root)

```text
src/
├── server.ts                 # Fastify wiring: /api/lookup route, validation, rate-limit hook
├── server.test.ts            # Integration tests: fastify.inject + fake eBay client
└── lib/
    ├── verdict.ts            # EXISTING verdict math — extended for pricing basis +
    │                         #   supply-side-only liquidity (tests updated in place)
    ├── verdict.test.ts       # EXISTING — extended
    ├── identify.ts           # Step 1: raw input → validated ItemQuery (identifier kind, normalized title)
    ├── identify.test.ts
    ├── valuation.ts          # Step 2: ItemQuery → Valuation via EbayBrowseClient (median of 10 lowest)
    ├── valuation.test.ts
    ├── shipping.ts           # Step 3: flat $5.00 configurable estimate
    ├── shipping.test.ts
    ├── pipeline.ts           # Orchestrates steps 1–4 + cache; single entry: lookup(request) → VerdictResult
    │                         #   (covered by server.test.ts integration suite + per-step unit tests)
    ├── cache.ts              # Generic in-memory TTL cache (24h default)
    ├── cache.test.ts
    ├── rate-limit.ts         # Per-client daily counter (50/day) + global eBay-call budget
    ├── rate-limit.test.ts
    └── ebay/
        ├── auth.ts           # OAuth2 client-credentials token manager (cached, proactive refresh)
        ├── auth.test.ts
        ├── browse.ts         # Browse API client: searchByGtin / searchByTitle → ListingSummary[]
        ├── browse.test.ts
        └── types.ts          # EbayBrowseClient interface + wire types (enables fake in tests)

scripts/
└── sandbox-smoke.ts          # Opt-in: real sandbox end-to-end check (needs .env credentials)
```

**Structure Decision**: Single project, extending the existing `src/lib` layout with one
module per pipeline step plus an `ebay/` integration folder. Tests stay colocated
(`*.test.ts` next to source), matching the existing `verdict.test.ts` convention.

## Complexity Tracking

> No constitution violations — table intentionally empty.
