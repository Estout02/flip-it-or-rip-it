# Research: Web Client (006)

## R1: Platform: responsive installable web app

**Decision**: A single responsive web app, installable (PWA manifest plus service worker), served
from the same origin as the API.

**Rationale**: The founder's decision is "whatever is best for adoption". A web app is one link,
with no store review and no install friction, and it covers phones and desktops with one codebase.
It also serves the explicitly requested desktop site. Same origin means no CORS configuration and
no exposed API origin (constitution I: eBay calls stay server-side regardless).

**Alternatives**: native iOS (SwiftUI). This is the best camera experience, but it has no desktop
presence, store review delays the first user, and it doubles the work when Android follows.
Deferred, since the API stays reusable.

## R2: Framework: Preact + TypeScript + Vite

**Decision**: Preact 10 (hooks only; no router, no state library) with TypeScript, built with Vite.
Styling is hand-written modern CSS (custom properties, nesting, logical properties, `clamp()`
fluid type, `:focus-visible`, media queries for color scheme, reduced motion and forced colors).
There is no CSS framework and no web font: the system font stack (`system-ui`) with
`font-variant-numeric: tabular-nums` for money.

**Rationale**: SC-002 caps the initial download at ≤ 100 KB compressed. Preact is about 4 KB
gzipped with a React-compatible API and mature testing support (`@testing-library/preact`). The UI
is one screen with a handful of components, which doesn't justify a router or a store. System
fonts cost 0 bytes and render instantly.

**Alternatives**:
- *React 19*: about 45 KB gzipped for the runtime alone, nearly half the budget, with no
  capability we need.
- *Svelte 5*: similarly small. Preact was chosen for the larger testing and accessibility tooling
  ecosystem and the React-familiar idiom.
- *No framework (web components)*: smallest, but more hand-rolled state and focus management,
  which is where accessibility bugs live.

## R3: Barcode scanning

**Decision**: A progressive, three-level approach, all loaded **only when the user taps Scan**
(dynamic `import()`):

1. `navigator.mediaDevices.getUserMedia` with the rear camera (`facingMode: 'environment'`).
2. Detection via native `BarcodeDetector` when it exists and supports the needed formats
   (Chromium on Android).
3. Otherwise the `barcode-detector` ponyfill (`import { BarcodeDetector } from
   'barcode-detector/ponyfill'`), which runs ZXing-C++ compiled to WebAssembly. **The `.wasm` is
   self-hosted**: it is bundled as a Vite asset, and `prepareZXingModule({ overrides: { locateFile }
   })` points at it, so no third-party CDN is contacted (FR-010, privacy) and the CSP can stay
   `'self'`.

Formats: `ean_13`, `ean_8`, `upc_a`, `upc_e` (ISBN-13 is EAN-13). The detection loop uses
`requestVideoFrameCallback` where available, otherwise `requestAnimationFrame`, throttled to about
8 fps to save battery. A code is accepted after it is read **twice consecutively** with the same
value, which prevents mis-reads. The camera stops on accept, cancel, Escape, `popstate` (back
gesture) or `visibilitychange` → hidden (FR-009).

If `mediaDevices` is missing, permission is denied, or no camera is found, the Scan UI shows a
plain explanation and returns focus to the text input (US2-3).

**Rationale**: As of September 2026, Safari (and therefore every iOS browser) still doesn't
implement `BarcodeDetector`, so a WASM decoder is required for the iPhone-first audience. Lazy
loading keeps the decoder out of the typing path and out of the 100 KB budget.

**Alternatives**: `@zxing/browser` (the JS port) is larger, slower and unmaintained relative to
ZXing-C++ WASM. `html5-qrcode` bundles its own UI, which fights our accessibility requirements.

## R4: Serving: same origin

**Decision**:
- **Dev**: a new compose service `web` runs the Vite dev server on `:5173`, with `server.proxy`
  sending `/api` and `/health` to `http://api:3000`.
- **Production**: the API serves the built client from `web/dist` via `@fastify/static`,
  registered **only when that directory exists** (`WEB_DIST_DIR`, default `web/dist`). Static
  routes carry `Cache-Control: public, max-age=31536000, immutable` for hashed assets and
  `no-cache` for `index.html`, `sw.js` and `manifest.webmanifest`, plus a strict CSP (R8).

**Rationale**: Same origin means no CORS. `@fastify/static` adds routes, not hooks, so the
`/api/lookup` hot path is untouched (constitution II).

## R5: API additions

**Decision**: One new, cheap, cacheable endpoint: `GET /api/meta` →
`{ defaultProfitThresholdCents, lookupDailyCap, marketplaceId }`, with
`Cache-Control: public, max-age=300`. It does no eBay calls and isn't rate limited.

**Rationale**: US3-3 needs the service default threshold displayed, and the limit message is
clearer with the cap number. Hard-coding either in the client would drift from the server's
configuration.

## R6: State, requests and races

**Decision**: One `useLookup` hook owning a small state machine:
`idle → loading → success | error`. Each submit aborts the previous `AbortController` and bumps a
request sequence number. A response whose sequence number isn't current is discarded (FR-007).
The submit button is `aria-disabled` while loading (not `disabled`, so it stays focusable and
announces its busy state). A scanned value is ignored while a lookup is in flight.

Error mapping from the API contract:

| Condition | Class | Message essence | Action |
|---|---|---|---|
| 400 | validation | the service's `message`, shown inline at the input | fix input |
| 429 | limit | "Today's lookups on this network are used up. They reset at {local time of next 00:00 UTC}." | browse Recent |
| 503 | unavailable | "eBay isn't answering right now. Try again in a moment." | Retry |
| `TypeError` from fetch / `navigator.onLine === false` | offline | "You're offline. Lookups need a connection." | Retry |
| anything else | unexpected | "Something went wrong on our side." | Retry |

## R7: Money in the client (constitution VI)

**Decision**: Cents stay integers end to end. Dollar input is parsed with a regex
(`^\d{1,6}(\.\d{1,2})?$`), splitting on the decimal point and composing integers, with no
`parseFloat × 100`. Display uses `Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD'
})` on `cents / 100` at the display edge only. Negative profit reads "−$3.20" plus the words "loses
$3.20" (edge case: not color alone).

## R8: Security headers for the served client

**Decision**: The CSP on the HTML is
`default-src 'self'; script-src 'self' 'wasm-unsafe-eval'; style-src 'self'; img-src 'self' data:
blob:; connect-src 'self'; worker-src 'self'; manifest-src 'self'; media-src 'self' blob:;
object-src 'none'; base-uri 'none'; frame-ancestors 'none'`. Also `Referrer-Policy: no-referrer`
and `Permissions-Policy: camera=(self)`. `'wasm-unsafe-eval'` is the narrow allowance WebAssembly
compilation needs. Vite production builds emit no inline scripts. Set via `@fastify/static`
`setHeaders` for `.html` files only.

## R9: Offline and installability

**Decision**: `vite-plugin-pwa` in `generateSW` mode. It precaches the hashed app shell (HTML, JS,
CSS, icons) and caches **no** `/api/*` requests (a stale valuation must never masquerade as live).
The scanner chunk and the WASM are runtime-cached `CacheFirst` after their first use, so scanning
works offline-to-UI (the lookup itself still needs the network). `registerType: 'autoUpdate'`.
Icons are generated from one SVG source with `@vite-pwa/assets-generator` (192, 512, maskable,
apple-touch).

## R10: Device storage

**Decision**: `localStorage` with versioned keys: `flip-or-rip:settings:v1`
(`{ profitThresholdCents: number | null }`) and `flip-or-rip:history:v1` (an array of up to 50
entries, newest first). Every read and write is wrapped in try/catch. On failure the app runs
memory-only and shows a single polite notice (edge case). Nothing is sent anywhere (FR-013).

## R11: Visual design direction

**Decision**: "Calm utility". The verdict is the hero, everything else is quiet and legible, and
there is no decoration that costs bytes.

- **Verdict palette** (text-on-tint pairs, all ≥ 5.8:1 in light and ≥ 8:1 in dark, verified by
  script, see data-model "Design tokens"):
  - **FLIP**: green, with an upward "tag" icon.
  - **FLIP_RISKY**: amber, with an hourglass icon.
  - **RIP**: **violet, deliberately not red**. Ripping is the anti-consumerism *win* (declutter,
    donate), so it must not read as failure. Heart-in-hand icon.
  - **UNCERTAIN**: neutral gray with a dashed border and a question icon, visually "not a verdict".
- **Type**: a fluid scale from `clamp()`; the verdict label is about 2.25–3 rem and heavy; money
  uses tabular numerals.
- **Mobile**: one column. On camera-capable devices, the single Scan button (in DOM order inside
  the form, right after Check) is positioned in a fixed bottom bar within thumb reach below 1024 px.
  It is one element, so focus order stays input → Check → Scan. The page gets a matching
  `scroll-padding-bottom` and bottom padding so the bar never obscures focused content (WCAG
  2.4.11).
- **Desktop ≥ 1024 px**: a three-column grid: lookup and settings summary (≈ 22 rem), result
  (fluid), Recent (≈ 20 rem, independently scrollable).
- **Motion**: a 150 ms fade/translate on new results, removed entirely under
  `prefers-reduced-motion: reduce`.
- **Forced colors**: verdict bands get `border: 2px solid CanvasText`, and icons use `currentColor`,
  so the text label and icon carry the meaning.

## R12: Testing strategy

**Decision**: Three layers, all in Docker.

1. **Unit/component** (Vitest + jsdom + `@testing-library/preact` + `axe-core`): pure helpers
   (classify input, money parse and format, storage, error mapping), each component in every state,
   and an axe scan of each rendered state. `docker compose run --rm web npm test`.
2. **End-to-end + accessibility** (Playwright + `@axe-core/playwright`, in the official Playwright
   image as a compose service under profile `e2e`). The suite builds the client and serves it with
   `vite preview`, and **mocks `/api/*` via `page.route`**, so no eBay calls happen at all. It
   covers every screen state from SC-003 at 320, 390 and 1280 px widths in both color schemes, plus
   forced-colors emulation, keyboard-only flows, and a check for no horizontal overflow.
3. **Budget**: `web/scripts/check-size.mjs` reads the Vite manifest and fails if the entry chunk
   plus its static imports plus CSS exceed 100 KB gzip. It runs as part of `npm test`.

Lighthouse (SC-007) is a manual quickstart step. It is not automated here, because it needs Chrome
plus network throttling, and the e2e budget check already covers the regressions that matter.
