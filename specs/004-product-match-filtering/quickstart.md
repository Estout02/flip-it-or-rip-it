# Quickstart & Validation: Product Match Filtering

Contract: [contracts/lookup-api.yaml](./contracts/lookup-api.yaml) (v0.5.0); types:
[data-model.md](./data-model.md); rationale: [research.md](./research.md). Everything runs inside
Docker (constitution V).

## Prerequisites

- Docker + Docker Compose
- `.env` for sandbox work; `MATCH_*` thresholds may be left unset (defaults apply)
- Automated tests need **no** credentials (fake `EbayBrowseClient`)
- Section 4 needs **production** credentials and the production overlay

## 1. Automated tests — the authoritative proof

```bash
docker compose run --rm api npm test
docker compose run --rm api npm run typecheck
```

The fake client is what makes contaminated result sets expressible — fixtures should mirror the
live reference case: a dominant Video Games group, plus merchandise, magnets and mousepads in other
categories, plus unrelated games and a multi-game lot *inside* the dominant group.

| Scenario | Setup | Expected |
|---|---|---|
| US1-AS1 — accessories excluded | dominant product group + cheaper accessories in other categories | sample contains zero accessory listings; estimate reflects the dominant group |
| US1-AS2 — barcode unaffected | GTIN-sourced result set | identical to pre-feature behaviour; `matchFiltered: false` |
| US1-AS3 — one bad label | dominant group + a single miscategorized listing | match unchanged |
| US2-AS1 — match visible | any lookup | `matchedCategoryName`, `matchDominance`, `matchConfidence` present |
| US2-AS2 — no dominant product | listings spread evenly across categories | `matchConfidence: LOW` |
| US3-AS1 — no confident verdict | low-confidence match | `verdict: UNCERTAIN`, `reasonCode: LOW_MATCH_CONFIDENCE` |
| FR-010 — dominant but heterogeneous | one category, prices $6-800 | `matchConfidence: LOW` **despite** high dominance |
| R7 — GTIN falls back to title | GTIN search returns nothing, title fallback fires | result **is** filtered; `matchFiltered: true` |
| Precedence | low confidence *and* weak liquidity | `UNCERTAIN` wins over the liquidity gate |
| Precedence | empty sample | existing `NO_MARKET_DATA` RIP, unchanged |
| Small group | matched group of 3 | `dispersionRatio` is 1; confidence decided by dominance |
| Config | custom `MATCH_*` values | thresholds shift; invalid values fall back with a warning |
| Query shape | any search | request carries **no** `sort=price` |

## 2. Run the API

```bash
docker compose up --build
```

## 3. Response-shape check

```bash
curl -s -X POST localhost:3000/api/lookup -H 'content-type: application/json' \
  -d '{"title":"Chrono Trigger SNES"}' | jq
```

Against the empty sandbox this is legitimately `RIP` / `NO_MARKET_DATA` with a null match — correct,
not a failure. Shape only.

## 4. The real test — live production regression

This feature exists because of production behaviour the sandbox cannot reproduce, so it is the only
place it can be honestly validated. Uses real quota (~4 calls).

```bash
docker compose -f docker-compose.yml -f docker-compose.prod.yml up -d
for q in 'Chrono Trigger SNES' 'Nintendo Switch OLED console'; do
  curl -s -X POST localhost:3000/api/lookup -H 'content-type: application/json' \
    -d "{\"title\":\"$q\"}" | jq '{verdict, matchConfidence, matchedCategoryName, matchDominance, estimatedValueCents, matchedTitle}'
done
curl -s -X POST localhost:3000/api/lookup -H 'content-type: application/json' \
  -d '{"identifier":"9780345391803"}' | jq '{verdict, matchFiltered, estimatedValueCents, matchedTitle}'
```

Expected, and worth being precise about what success means here:

- **`matchedTitle` is a game/console, never a keychain, magnet, mousepad or carrying case.** This
  is the bug being fixed and the primary pass condition.
- **The ISBN lookup is unchanged** from its pre-feature result ($7.97 raw, RIP) with
  `matchFiltered: false` — FR-005/SC-003.

### Measured on 2026-09-20 (first run after implementation)

The pre-implementation prediction that *both* title queries would return `UNCERTAIN` was **wrong,
and wrong in a good direction**. Actual results:

| Query | Verdict | Confidence | Matched | Raw median |
|---|---|---|---|---|
| Chrono Trigger SNES | FLIP_RISKY | MEDIUM | Video Games, dominance 0.56 | $377.03 |
| Nintendo Switch OLED console | FLIP_RISKY | HIGH | Video Game Consoles, dominance 1.00 | $192.50 |
| ISBN 9780345391803 | RIP | HIGH (unfiltered) | — | $7.97 |

Dropping `sort=price` for title searches did more than remove accessories: relevance ordering
surfaces the *canonical* product rather than the cheapest lookalike, so the Japanese-import
contamination that dominated the price-sorted sample largely disappeared on its own. $192.50 for a
used Switch OLED is a defensible market read.

**Known residual risk, not a regression.** Chrono Trigger's $377 median skews toward complete-in-box
copies; a user holding a loose cart (~$60-100) would see a roughly 3-5× overvaluation at MEDIUM
confidence — which does **not** trigger `UNCERTAIN`. Variant separation remains out of scope, but
note the failure has inverted from *under*-valuation to *over*-valuation, which is the direction
that wastes a user's time. The four `MATCH_*` thresholds were calibrated against the old
price-sorted distribution, which no longer exists; they warrant re-tuning against real traffic
rather than against this single query.

## 5. Optional: smoke script

```bash
docker compose -f docker-compose.yml -f docker-compose.prod.yml run --rm api npx tsx scripts/sandbox-smoke.ts
```

Summary should print the matched category and confidence beside the existing figures.

## Definition of done

- [ ] Suites green in Docker; typecheck clean
- [ ] Every row in the §1 table has a test
- [ ] §4 run against production: no accessory ever valued; ISBN path unchanged
- [ ] Contract examples match real output
- [ ] `.env.example` documents the four `MATCH_*` thresholds and states they are judgment calls
- [ ] No new marketplace calls (SC-006) — cache-hit test still asserts zero external calls
