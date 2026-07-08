# Quickstart & Validation: Core Valuation Pipeline

How to prove the feature works end-to-end. Contract details: [contracts/lookup-api.yaml](./contracts/lookup-api.yaml);
types: [data-model.md](./data-model.md). Everything runs inside Docker (constitution V).

## Prerequisites

- Docker + Docker Compose
- `.env` copied from `.env.example` with `EBAY_ENV=sandbox`
- For live-sandbox checks only: `EBAY_CLIENT_ID`/`EBAY_CLIENT_SECRET` from the founder's
  eBay developer account (sandbox keyset). Automated tests do NOT need credentials.

## 1. Automated tests (no credentials required)

```bash
docker compose run --rm api npm test          # unit + integration (fake eBay client)
docker compose run --rm api npm run typecheck
```

Expected: all suites green, covering the spec's acceptance scenarios — identifier lookup
(US1), title lookup + validation (US2), cost basis/threshold personalization (US3), plus
edge cases: no-market-data RIP, malformed identifier 400, cap-exhaustion 429, cooldown/
budget 503, and the cache-hit-makes-zero-external-calls assertion.

## 2. Run the API

```bash
docker compose up --build     # API on http://localhost:3000
```

## 3. Manual validation scenarios

### US1 — barcode lookup (sandbox listings permitting)

```bash
curl -s -X POST localhost:3000/api/lookup -H 'content-type: application/json' \
  -d '{"identifier":"9780345391803"}' | jq
```

Expected: 200 with the full `VerdictResult` shape — `pricingBasis: "ASKING_PRICE"`,
`liquidityBasis: "SUPPLY_SIDE_ONLY"`, integer-cents money fields, `matchedTitle` present
(or `noMarketData: true` with verdict RIP if the sandbox has no matching listings — that is
correct behavior, not a failure).

### US2 — title lookup & validation

```bash
curl -s -X POST localhost:3000/api/lookup -H 'content-type: application/json' \
  -d '{"title":"Chrono Trigger SNES"}' | jq            # 200, same shape as US1

curl -s -X POST localhost:3000/api/lookup -H 'content-type: application/json' \
  -d '{}' | jq                                          # 400 {"error":"validation",...}

curl -s -X POST localhost:3000/api/lookup -H 'content-type: application/json' \
  -d '{"identifier":"not-a-barcode!"}' | jq             # 400, no external call made
```

### US3 — cost basis & threshold change the verdict

```bash
# Same item, increasing cost basis: profitCents drops by exactly the basis; verdict can flip to RIP
curl -s -X POST localhost:3000/api/lookup -H 'content-type: application/json' \
  -d '{"title":"Chrono Trigger SNES","costBasisCents":1500}' | jq '{verdict, profitCents}'

# Low threshold rescues a small profit
curl -s -X POST localhost:3000/api/lookup -H 'content-type: application/json' \
  -d '{"title":"Chrono Trigger SNES","profitThresholdCents":200}' | jq '{verdict, profitCents}'
```

### Cache behavior (SC-002)

```bash
time curl -s -X POST localhost:3000/api/lookup -H 'content-type: application/json' \
  -d '{"title":"chrono trigger snes"}' | jq '.cached'   # false on first call
time curl -s -X POST localhost:3000/api/lookup -H 'content-type: application/json' \
  -d '{"title":"CHRONO  TRIGGER snes"}' | jq '.cached'  # true — normalized-title hit, <500ms
```

Note the second call uses different casing/whitespace — a hit proves normalization works.

### Rate limit (FR-012)

```bash
for i in $(seq 1 51); do
  curl -s -o /dev/null -w "%{http_code}\n" -X POST localhost:3000/api/lookup \
    -H 'content-type: application/json' -d '{"title":"rate limit probe"}'
done | sort | uniq -c        # expect 50× 200 and 1× 429
```

(Cache makes this cheap: probe 1 spends one eBay call; probes 2–50 are cache hits.)

## 4. Live sandbox smoke test (credentials required, run manually)

```bash
docker compose run --rm api npx tsx scripts/sandbox-smoke.ts
```

Expected output: token minted OK → Browse search executed OK → a formatted VerdictResult.
This is the only step that touches eBay; it validates auth + wiring, not price accuracy
(sandbox data is fake).

## Success criteria spot-checks

| Criterion | How to verify |
|-----------|---------------|
| SC-001 uncached < 3s | `time` on a first-call curl above |
| SC-002 cached < 500ms, zero calls | cache-behavior scenario + integration test asserting fake client saw 1 call |
| SC-003 flags always present | integration tests assert `pricingBasis`/`liquidityBasis` on every 200 |
| SC-005 deterministic verdict math | existing + extended `verdict.test.ts` fixtures |
| SC-006 invalid → 0 external calls | integration tests assert fake client uncalled on 400s |
