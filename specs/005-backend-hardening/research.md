# Research: Backend Hardening (005)

All decisions below were made against the code at `f258ed1` (main after spec 004) and Fastify
5.12.5 as installed in the container.

## R1 — Competing-supply figure for title searches (US1)

**Decision**: The valuation step computes `competingSupplyCount`:

- `sourcedFrom === 'gtin'` → `totalActive` (unchanged behaviour).
- `sourcedFrom === 'title'` → `max(matchedCount, round(totalActive × dominanceShare))`, where
  `matchedCount` is the number of listings in the matched group.

`activeListingCount` on `Valuation` keeps its meaning (raw marketplace total). The pipeline passes
`competingSupplyCount` into `computeVerdict` as its `activeListingCount` input, so the verdict step's
interface does not change. The response gains `rawActiveListingCount` and `competingSupplyCount`.

**Rationale**: The dominance share is already measured and is the only zero-cost signal of what
fraction of the result set is the item. The `max(matchedCount, …)` floor handles two edge cases in
one rule: rounding to 0 when the matched group is tiny, and eBay reporting a `total` smaller than
the sample it returned. Computing it in the valuation step keeps Principle VII intact: "which
listings are this item" is valuation's job; the verdict only reads a number.

**Alternatives considered**:
- *Pass dominance into the verdict and scale there*: leaks valuation internals into the verdict step.
- *A second eBay call filtered to the matched category for an exact count*: exact, but doubles
  per-lookup cost for title searches; rejected under Principle III (same reasoning as 004 R3).
- *Use `matchedCount` alone*: caps supply at ≤ 50, which makes every title search look STRONG/MODERATE
  and silently disables the flooded-market gate for titles.

## R2 — Cache keys for barcode lookups with a title fallback (US3)

**Decision**: Two keys for barcode lookups.

- `gtin:<digits>` — the barcode search result. Stored when the barcode search runs, **including the
  empty result** (sample 0, `sourcedFrom: 'gtin'`).
- `gtin:<digits>|title:<normalized title>` — the title-fallback result, only when the barcode was
  empty and a title was provided.

`identify` adds `fallbackCacheKey` to `ItemQuery` when both a barcode and a title are present.
The resolution in the pipeline:

1. Barcode entry cached and **non-empty** → use it (title irrelevant, FR-008).
2. Barcode entry cached **empty** and no title → return it.
3. Barcode entry cached **empty** and title → fallback entry if cached; else run the valuation with
   `skipBarcodeSearch: true` (title search only — FR-009), store under `fallbackCacheKey`.
4. Barcode entry not cached → full valuation. If it came from the barcode, store under `gtin:`.
   If it came from the fallback, store an empty barcode valuation under `gtin:` **and** the result
   under `fallbackCacheKey`.

"Empty" is defined as `sourcedFrom === 'gtin' && sampleSize === 0`. A barcode whose listings are all
unpriced counts as empty. That is the right call, since there is nothing to value either way.

`computeValuation` gains an optional `{ skipBarcodeSearch?: boolean }` option and `valuation.ts`
exports `emptyBarcodeValuation()`, so the empty barcode entry has the same shape wherever it is
created.

**Rationale**: Keeps the "barcode-matched answers are shared" economy of spec 001 while making the
fallback reachable and per-title. Step 4 avoids re-querying the barcode on the next B+T2 lookup.

**Alternatives considered**:
- *Always key by barcode+title*: fragments the cache for the common case (barcode hits), costing
  quota for no correctness gain.
- *Never cache empty barcode results*: spec 001 chose to cache them to save quota; reversing that
  costs a call on every repeat scan of an unknown barcode.

## R3 — Proxy trust (US2)

**Decision**: New setting `TRUST_PROXY`, parsed into Fastify's `trustProxy` option:

| Value | Meaning |
|---|---|
| unset / empty / `false` | `false`: `request.ip` is the socket address (default) |
| positive integer `n` | trust `n` hops |
| comma list of IPs/CIDRs | trust only those addresses (Fastify/proxy-addr syntax) |
| `true` or anything else | **rejected**. Warn and fall back to `false` |

Each list entry is validated with `node:net` `isIP` (after splitting an optional `/prefix` and
checking the prefix range).

**Rationale**: Fastify's `trustProxy: true` trusts every hop, so `request.ip` becomes the leftmost
(client-controlled) `X-Forwarded-For` entry. That is the bypass. With `false`, forwarding headers
are ignored entirely. Rejecting the literal `true` means nobody can reintroduce the bug by
configuration.

**Alternatives considered**: keep `true` and key the limiter by `request.socket.remoteAddress`,
which would break real deployments behind a proxy (every user shares the proxy's address and cap).

## R4 — Numeric setting validation (US5)

**Decision**: A single helper in `server.ts`,
`numericSetting(env, name, fallback, isValid, { integer?: boolean })`, used for every scalar knob,
following the existing pattern: warn with the setting name and raw value, and return the default.
Ranges per FR-010. `cacheTtlMs` is derived from the validated hours. `defaultProfitThresholdCents`
is rounded after validation.

**Rationale**: One code path, the same warning shape as the existing `loadLiquidityConfig`, and
each range is testable as a single `it.each` row.

## R5 — In-flight coalescing (US4)

**Decision**: The pipeline owns a `Map<string, Promise<Valuation>>` of in-flight valuations, keyed
by the cache key the result will be stored under (the `fallbackCacheKey` for the barcode-empty +
title path, otherwise the primary key). On a cache miss: if the key is in flight, await it;
otherwise start it, register it, and in `finally` delete it. The cache write happens inside the
shared promise, so it happens once. Waiters get `cached: false`, because the answer is fresh.

The map is paired with the cache it fills: a module-private `WeakMap<TtlCache<Valuation>,
Map<string, Promise<Valuation>>>` in `pipeline.ts`, so no `PipelineDeps`/`AppDeps` shape changes
and every test that builds its own cache is automatically isolated.

**Rationale**: The per-caller cap is charged in the `onRequest` hook before the pipeline runs, so
each caller is still charged once (FR-013). The eBay budget is charged inside `guardedClient`,
which only the single shared computation reaches (FR-011). A rejected promise propagates to every
awaiter, and `finally` removes it, so failures are never remembered (FR-012).

**Alternatives considered**: storing a promise in the TTL cache itself. That would mix pending and
settled states in a store other code reads, and a rejection would need eviction logic there.

## R6 — Bounding per-caller counters (US5)

**Decision**: `RateLimiter` keeps `currentDay`. In `tryConsumeLookup`, when `utcDayStart(now)`
differs from `currentDay`, call `perClient.clear()` and set `currentDay`. After that, every counter
in the map belongs to today, so the per-entry `windowStart` check becomes redundant (kept for
safety).

**Rationale**: `Map.clear()` runs once per UTC day, which is amortised O(1) per lookup. That
satisfies Principle II without a timer. Memory is bounded by the number of distinct callers seen
today (SC-007).

**Alternatives considered**: an interval sweep (adds a timer and lifecycle for no gain); an LRU
(bounds size but can evict an active abuser, resetting their cap).

## R7 — Rejecting unknown request fields (US5)

**Finding**: Fastify's default AJV options include **`removeAdditional: true`** (verified in
`node_modules/@fastify/ajv-compiler/lib/default-ajv-options.js`). With that default, adding
`additionalProperties: false` to the schema would silently *strip* unknown fields and still
answer. That is exactly the bug.

**Decision**:
- Set `additionalProperties: false` on the lookup body schema.
- Construct Fastify with `ajv: { customOptions: { removeAdditional: false } }`.
- In the error handler, when a validation entry has `keyword === 'additionalProperties'`, render
  `Unknown field "<params.additionalProperty>". Allowed: identifier, title, costBasisCents,
  profitThresholdCents.` so the message names the field (FR-015).
- Fix the CLAUDE.md smoke test (`costBasis` → `costBasisCents`).

`coerceTypes: 'array'` stays as is (out of scope; noted for a future strictness pass).

## R8 — Response shape

**Decision**: Contract version 0.6.0. Additive: `rawActiveListingCount`, `competingSupplyCount`.
The request body now rejects unknown fields (a breaking change, but there are no consumers yet).
Reason text for the WEAK tier already interpolates the count passed to the verdict, which is now
`competingSupplyCount`. That is correct: the reason should cite the item's competitors.
