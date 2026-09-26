# Quickstart: validating 005 Backend Hardening

Everything runs in Docker against the fake client or the eBay **sandbox**.

## 1. Automated suite

```bash
docker compose run --rm api npm test
docker compose run --rm api npm run typecheck
```

The suite must include, per story (see `tasks.md` for exact test names):

| Story | What proves it |
|---|---|
| US1 | Fixture: 50 returned listings, 20% matched, `total` 500 → `competingSupplyCount` 100, tier MODERATE. The same fixture with raw supply would be WEAK |
| US2 | 51 injected requests from one `remoteAddress`, each with a distinct `x-forwarded-for` → the 51st returns 429 |
| US3 | Unknown barcode alone, then barcode+title → the second makes exactly 1 call (a title search) and `matchFiltered: true` |
| US4 | 10 concurrent cold lookups → the fake client counts 1 call; all 10 return 200 |
| US5 | `LOOKUP_DAILY_CAP=abc` → warning plus cap 50; body `{"title":"x","costBasis":0}` → 400 naming `costBasis` |

## 2. Manual API checks (sandbox)

```bash
docker compose up --build
```

Strict body. Expect 400 with `Unknown field "costBasis"`:

```bash
curl -s -X POST localhost:3000/api/lookup -H 'content-type: application/json' \
  -d '{"title":"Chrono Trigger SNES","costBasis":0}' | jq
```

New supply fields are present:

```bash
curl -s -X POST localhost:3000/api/lookup -H 'content-type: application/json' \
  -d '{"title":"Chrono Trigger SNES","costBasisCents":0}' \
  | jq '{verdict, liquidityTier, rawActiveListingCount, competingSupplyCount, matchDominance}'
```

Expect `competingSupplyCount ≤ rawActiveListingCount`, and roughly `raw × matchDominance`.

Header spoofing no longer resets the cap. With `LOOKUP_DAILY_CAP=2` in `.env`:

```bash
for i in 1 2 3; do
  curl -s -o /dev/null -w '%{http_code}\n' -X POST localhost:3000/api/lookup \
    -H 'content-type: application/json' -H "x-forwarded-for: 203.0.113.$i" \
    -d '{"title":"test item"}'
done
# → 200 200 429 (or 503 for the sandbox's sparse data. What matters is that the 3rd is 429)
```

Setting validation. Start with a bad value and look for the warning:

```bash
docker compose run --rm -e LOOKUP_DAILY_CAP=abc -e TRUST_PROXY=true api \
  npx tsx -e "import('./src/server.ts').then(m => console.log(m.loadConfig().lookupDailyCap, m.loadConfig().trustProxy))"
# → warnings for LOOKUP_DAILY_CAP and TRUST_PROXY, then: 50 false
```
