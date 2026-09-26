# Quickstart: validating 006 Web Client

Everything runs in Docker. Nothing in this guide reaches eBay except the optional §4.

## 1. Unit, component and budget

```bash
docker compose run --rm web npm test          # vitest (jsdom + axe) + size budget
docker compose run --rm web npm run typecheck
docker compose run --rm api npm test          # API: /api/meta + static serving tests
```

Expect all green, and the budget script printing `initial: NN.N KB gzip (limit 100 KB)`.

## 2. End-to-end and accessibility matrix (API mocked)

```bash
docker compose --profile e2e run --rm e2e
```

This runs Playwright against a production build (`vite preview`) with `/api/*` intercepted. It
covers every state in `contracts/ui-states.md` at 320, 390 and 1280 px, in light and dark, plus
forced colors, with 0 axe violations, no horizontal overflow, correct focus targets, and targets of
at least 44 px. The HTML report is written to `web/playwright-report/`.

## 3. Dev loop

```bash
docker compose up --build        # api :3000, web :5173 (proxying /api → api)
open http://localhost:5173
```

Manual walkthrough (5 minutes):

1. Type `9780345391803` and press Enter. A verdict appears, focus is on the verdict heading, and
   the basis note is visible.
2. Tab through the whole page. The focus ring is always visible and never hidden under the bottom
   bar (use a narrow window).
3. Open Settings, set $25, Save, and reload. The setting persists.
4. Open "What I paid", enter 8, and check again. Profit drops by $8.00.
5. Reload. Recent lists both lookups. Click one: no network request fires (check DevTools →
   Network), and the "Saved result" note shows.
6. With DevTools offline, submit. The offline message and Try again appear, and Recent still works.
7. macOS VoiceOver (⌘F5) or NVDA: submit a lookup and confirm the verdict and reason are read.
8. Emulate `prefers-reduced-motion: reduce` and forced colors (DevTools → Rendering). There is no
   animation, and verdicts stay distinguishable.

## 4. Real device, scanner (sandbox API)

The camera needs a secure context. Use `https` via a tunnel of your choice to `:5173`, or
`chrome://inspect` port forwarding on Android.

- Android Chrome: native `BarcodeDetector`. Scan a book's ISBN.
- iPhone Safari: the WASM path. In DevTools (Safari → Develop), confirm the `.wasm` loads from
  your own origin and that nothing loads from a CDN.
- Deny camera permission, then tap Scan. The explanation appears, and "Type it instead" focuses the
  input.

## 5. Production build served by the API

```bash
docker compose run --rm web npm run build     # → web/dist
docker compose up api
curl -sI localhost:3000/ | grep -i -E 'content-security-policy|cache-control'
curl -s localhost:3000/api/meta
```

Then run Lighthouse (Chrome DevTools → Lighthouse → Mobile) against `http://localhost:3000/`:
performance ≥ 90 and accessibility 100 (SC-007).
