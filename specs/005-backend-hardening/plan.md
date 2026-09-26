# Implementation Plan: Backend Hardening

**Branch**: `005-backend-hardening` | **Date**: 2026-09-26 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/005-backend-hardening/spec.md`

## Summary

Seven fixes from the 2026-09-26 review, landed before a frontend consumes the API. Three of them
change answers or cost:

1. **Liquidity reads the item's supply.** On title searches, the valuation step scales eBay's raw
   total by the matched group's dominance share, with a floor of the matched listings actually
   seen. The verdict consumes that figure unchanged. The response exposes both numbers (R1).
2. **Barcode fallback gets its own cache key.** `gtin:B` holds the barcode answer, including an
   empty one. `gtin:B|title:t` holds a title fallback. A known-empty barcode is never re-searched
   (R2).
3. **Proxy trust is explicit.** `trustProxy: true` is replaced by a validated `TRUST_PROXY`
   setting that defaults to off, and the literal `true` is refused (R3).

Plus four robustness fixes: validated numeric settings (R4), in-flight coalescing (R5), a daily
clear of per-caller counters (R6), and strict request bodies. Strict bodies need
`removeAdditional: false`, because Fastify's default *strips* unknown fields instead of rejecting
them (R7).

## Technical Context

**Language/Version**: TypeScript on Node 24 (ESM, `.js` import specifiers)

**Primary Dependencies**: Fastify 5.12 (no new dependencies; `node:net` for IP validation)

**Storage**: N/A. The in-memory `TtlCache<Valuation>` gains one key shape; no schema changes.

**Testing**: Vitest in Docker (`docker compose run --rm api npm test`), with the fake
`EbayBrowseClient` and Fastify `inject` (whose `remoteAddress` option drives the proxy tests)

**Target Platform**: Linux container (compose service `api`)

**Project Type**: Single backend web service

**Performance Goals**: No cache-hit latency change (SC-006). Every addition is O(1), or amortised
O(1) for the daily clear.

**Constraints**: Zero new marketplace calls (III); money in integer cents (VI); step boundaries
intact (VII): supply scaling lives in valuation, and the verdict interface is unchanged

**Scale/Scope**: 6 source files (`identify.ts`, `valuation.ts`, `pipeline.ts`, `rate-limit.ts`,
`server.ts`, plus `.env.example`), their tests, the contract, and the CLAUDE.md docs fix

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| Principle | Assessment | Status |
|-----------|-----------|--------|
| **I. eBay Compliance** | No new calls. Proactive rate-limit respect is *strengthened*: the global budget can no longer be drained through header spoofing. | ✅ PASS |
| **II. Latency First** | The hot path gains one `Map.get` for in-flight lookup and one day comparison in the limiter. The daily `Map.clear()` is amortised O(1). Cache hits are untouched. | ✅ PASS |
| **III. Cost Discipline** | Strictly reduces calls: coalescing removes duplicate burst calls, a known-empty barcode is not re-searched, and the cap bypass is closed. The exact-count alternative in R1 was rejected because it costs a call. | ✅ PASS |
| **IV. Spec-Driven** | Traces to spec 005, and every change maps to an FR. | ✅ PASS |
| **V. Sandbox-First Testing** | All tests use the fake client in Docker. | ✅ PASS |
| **VI. Money Is Integer Cents** | Threshold validation still converts dollars to cents exactly once. Supply counts are integer listings, not money. | ✅ PASS |
| **VII. Extensible Verdict Pipeline** | Supply scaling happens in **valuation** (which owns "which listings are this item"). The verdict keeps its `activeListingCount` input. Cache-key selection and coalescing live in the pipeline orchestrator, which already owns the cache. | ✅ PASS |

**Post-Phase 1 re-check**: ✅ All gates pass. The design adds no step coupling. `computeValuation`
gains an options argument that is still expressed in valuation terms (`skipBarcodeSearch`), not
cache terms.

## Design

### US1: Supply (valuation.ts, pipeline.ts)

- `Valuation.competingSupplyCount: number`, computed per R1 inside `computeValuation`.
- The pipeline passes `activeListingCount: valuation.competingSupplyCount` to `computeVerdict` and
  adds `rawActiveListingCount: valuation.activeListingCount` and `competingSupplyCount` to
  `VerdictResult`.
- **Cache compatibility**: entries are in memory and a deploy restarts the process, so no
  migration is needed. Defensively, the pipeline reads `valuation.competingSupplyCount ??
  valuation.activeListingCount`.

### US2: Proxy trust (server.ts)

- `AppConfig.trustProxy: false | number | string`, from `parseTrustProxy(env.TRUST_PROXY)` (R3).
- `Fastify({ trustProxy: config.trustProxy, ... })`.

### US3: Cache keys (identify.ts, valuation.ts, pipeline.ts)

- `ItemQuery.fallbackCacheKey?: string`, set only when both a barcode and a title are present:
  `gtin:<digits>|title:<normalized>`.
- `computeValuation(query, client, matchConfig, { skipBarcodeSearch })`; `emptyBarcodeValuation()`
  exported.
- The pipeline's `resolveValuation(query, deps)` implements the four-case ladder in R2 and returns
  `{ valuation, cached }`.

### US4: Coalescing (pipeline.ts)

- `inflightFor(cache)`, backed by the WeakMap (R5). `resolveValuation` wraps each compute in
  `coalesce(key, () => compute-and-store)`.
- The cooldown check stays **before** coalescing, so a cooldown refuses immediately instead of
  joining a doomed flight.

### US5: Config, memory, strict bodies (server.ts, rate-limit.ts)

- `numericSetting` helper (R4) for `lookupDailyCap`, `ebayDailyCallBudget`, `feeRate`,
  `shippingFlatCents`, `cacheTtlMs` (from hours), `defaultProfitThresholdCents` (from dollars) and
  `port`.
- `RateLimiter` day-rollover clear (R6), plus a `trackedClientCount` getter for SC-007 tests.
- `lookupBodySchema.additionalProperties = false`,
  `ajv.customOptions.removeAdditional = false`, and an error message that names the field (R7).

### Docs and config

- `.env.example`: `TRUST_PROXY` with a comment explaining the spoofing risk.
- `CLAUDE.md`: fix the smoke test field, list `TRUST_PROXY` among the env vars, and add a
  one-paragraph "Current state" note on 005.
- Contract `contracts/lookup-api.yaml` 0.6.0.

## Project Structure

### Documentation (this feature)

```text
specs/005-backend-hardening/
├── plan.md              # This file
├── research.md          # R1–R8 decisions
├── data-model.md        # Valuation/ItemQuery/AppConfig/VerdictResult deltas
├── quickstart.md        # Validation scenarios
├── contracts/
│   └── lookup-api.yaml  # 0.6.0
└── tasks.md             # /speckit-tasks output
```

### Source Code (repository root)

```text
src/
├── server.ts            # TRUST_PROXY, numericSetting, strict body, error message
├── server.test.ts
└── lib/
    ├── identify.ts      # fallbackCacheKey
    ├── identify.test.ts
    ├── valuation.ts     # competingSupplyCount, skipBarcodeSearch, emptyBarcodeValuation
    ├── valuation.test.ts
    ├── pipeline.ts      # resolveValuation ladder, coalescing, response fields
    ├── pipeline.test.ts # NEW: cache-key ladder + coalescing (fake client with call counter)
    ├── rate-limit.ts    # day-rollover clear
    └── rate-limit.test.ts
```

**Structure Decision**: Existing single-service layout. The only new file is `pipeline.test.ts`:
pipeline behaviour is currently tested only through `server.test.ts`, and the cache ladder plus
coalescing are easiest to pin at the pipeline level.

## Complexity Tracking

No violations.
