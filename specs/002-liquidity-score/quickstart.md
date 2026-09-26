# Quickstart & Validation: Liquidity-Gated Verdict

How to prove the feature works end-to-end. Contract details:
[contracts/lookup-api.yaml](./contracts/lookup-api.yaml); types:
[data-model.md](./data-model.md); design rationale: [research.md](./research.md).
Everything runs inside Docker (constitution V).

## Prerequisites

- Docker + Docker Compose
- `.env` copied from `.env.example` with `EBAY_ENV=sandbox`
- The three new knobs may be left unset — defaults (10 / 50 / 2) apply
- Automated tests need **no** eBay credentials (fake `EbayBrowseClient`)

## 1. Automated tests — the authoritative proof

```bash
docker compose run --rm api npm test
docker compose run --rm api npm run typecheck
```

This is where the feature is actually validated, because the gate's behavior depends on
`activeListingCount` values the eBay **sandbox cannot reliably produce** (its catalog is
synthetic and mostly empty — a real-world title search there typically returns zero listings).
The fake client lets us pin exact supply counts and margins.

Expected coverage, mapping to spec acceptance scenarios:

| Scenario | Setup | Expected |
|----------|-------|----------|
| US1-AS1 — thin margin, flooded market | `activeListingCount` > moderateMax, profit just over threshold | `RIP` / `WEAK_LIQUIDITY_THIN_MARGIN` |
| US1-AS2 — valuable, flooded market | `activeListingCount` > moderateMax, profit ≥ 2× threshold | `FLIP_RISKY` / `WEAK_LIQUIDITY_HIGH_VALUE` |
| US1-AS3 — healthy supply | `activeListingCount` ≤ moderateMax, profit ≥ threshold | `FLIP` / `PROFITABLE` |
| US2-AS1/2/3 — reasons | each branch above | distinct `reason` text, `reasonCode` matches branch |
| US3-AS1 — honesty | any result | `liquidityBasis: SUPPLY_SIDE_ONLY`, reason text claims no sales knowledge |
| US3-AS2 — unproven | `activeListingCount === 0`, non-empty sample | `liquidityTier: UNPROVEN`, verdict decided by profit alone |
| Edge — no market data wins | `sampleSize === 0` | `RIP` / `NO_MARKET_DATA` (never a liquidity reason) |
| Edge — tier boundaries | count at exactly strongMax, then moderateMax | resolves to the more-liquid tier |
| Edge — margin boundary | profit exactly `riskyMarginCents` | `FLIP_RISKY` (favorable side) |
| Edge — downgrade-only | weak tier, profit < threshold | `RIP` / `BELOW_THRESHOLD`, never promoted |
| Config | custom env values | tiers/margin shift accordingly; invalid values fall back to defaults with a warning |

## 2. Run the API

```bash
docker compose up --build     # API on http://localhost:3000
```

## 3. Manual response-shape check

Sandbox data is thin, so treat this as a **shape** check, not a gate check:

```bash
curl -s -X POST localhost:3000/api/lookup -H 'content-type: application/json' \
  -d '{"title":"Chrono Trigger SNES","costBasisCents":0}' | jq
```

Expected: 200 carrying the new fields — `liquidityTier`, `reasonCode`, `reason` — alongside the
unchanged 001 fields. With an empty sandbox result this is legitimately
`verdict: "RIP"`, `reasonCode: "NO_MARKET_DATA"`, `liquidityTier: "UNPROVEN"` — correct behavior,
not a failure.

## 4. Exercising the gate locally without eBay

To see a real `FLIP_RISKY`, drive the tiers down so ordinary sandbox/live counts qualify as weak,
rather than waiting for a flooded-market item:

```bash
# in .env, then: docker compose up --build
LIQUIDITY_STRONG_MAX_LISTINGS=1
LIQUIDITY_MODERATE_MAX_LISTINGS=2
LIQUIDITY_RISKY_MARGIN_MULTIPLIER=2
```

Any query returning ≥ 3 active listings now lands in `WEAK`, and the margin split decides between
`RIP` and `FLIP_RISKY`. Restore the defaults afterwards.

## 5. Optional: live sandbox smoke

```bash
docker compose run --rm api npx tsx scripts/sandbox-smoke.ts
```

Requires sandbox credentials. Confirms the new fields survive a real Browse API round trip. The
script's printed summary should include the tier and reason lines.

## Definition of done

- [ ] All suites green in Docker; typecheck clean
- [ ] Every row in the table above is covered by a test
- [ ] Contract examples in `contracts/lookup-api.yaml` match actual responses
- [ ] `.env.example` documents all three new knobs
- [ ] No new eBay calls introduced (SC-005) — cache-hit test still asserts zero external calls
