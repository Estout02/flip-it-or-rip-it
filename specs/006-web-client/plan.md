# Implementation Plan: Web Client

**Branch**: `006-web-client` | **Date**: 2026-09-26 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/006-web-client/spec.md`

## Summary

A mobile-first, installable web app in a new `web/` package: Preact, TypeScript, Vite, and
hand-written CSS. It turns the lookup API into a one-screen loop: type or scan → verdict → next. The
design is "calm utility", with the verdict as the hero. RIP is violet rather than red (it's the
declutter win), and UNCERTAIN is a neutral "not a verdict". Accessibility is WCAG 2.2 AA by
construction, meaning contrast-verified tokens, semantic HTML and managed focus, and it is proved
by axe scans of every screen state in unit and Playwright suites. Performance is enforced by a
100 KB gzip budget check. The camera scanner (native `BarcodeDetector`, or a self-hosted ZXing WASM
ponyfill for iOS) is lazy-loaded and never costs the typing path.

Server-side changes are small: `GET /api/meta` (default threshold, cap), plus static serving of
`web/dist` with a strict CSP when the build exists.

## Technical Context

**Language/Version**: TypeScript 5 (strict), ESM; Node 24 for tooling

**Primary Dependencies**: `preact` 10; `barcode-detector` (ponyfill, lazy); dev: `vite`,
`@preact/preset-vite`, `vite-plugin-pwa`, `@vite-pwa/assets-generator`, `vitest`, `jsdom`,
`@testing-library/preact`, `axe-core`, `@playwright/test`, `@axe-core/playwright`. API:
`@fastify/static`. Use the latest stable versions at implementation time, pinned by lockfile.
Verify the `barcode-detector` `prepareZXingModule` API against the installed version.

**Storage**: device `localStorage` only (settings, 50-entry history); no server storage

**Testing**: Vitest (jsdom) for units and components with axe; Playwright e2e with axe, API mocked
via `page.route`; bundle budget script. All run in Docker.

**Target Platform**: evergreen mobile and desktop browsers: iOS Safari 16.4+, Chrome/Edge/Firefox
(last 2), Samsung Internet

**Project Type**: web application (existing API + new `web/` frontend package)

**Performance Goals**: SC-002: interactive < 2.5 s on first visit on a mid-range phone over 4G,
< 1 s on repeat visits; initial JS + CSS ≤ 100 KB gzip (scanner excluded); Lighthouse mobile
performance ≥ 90

**Constraints**: WCAG 2.2 AA (FR-016); no third-party origins at runtime (CSP `'self'`); no
analytics; money in integer cents (VI); no eBay access from the client (I); `/api/lookup` hot path
untouched (II)

**Scale/Scope**: one screen plus a settings dialog and a scanner overlay; about 12 components;
3 API-side touches (`server.ts`, `server.test.ts`, `package.json`), plus compose and docs

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| Principle | Assessment | Status |
|-----------|-----------|--------|
| **I. eBay Compliance** | The client calls only our API, same origin. No eBay keys, calls or pages in the browser. The scanner decodes on the device, and images never leave it. | ✅ PASS |
| **II. Latency First** | The lookup hot path is untouched: `/api/meta` and static files are separate routes with no hooks added. On the client, the typing path ships ≤ 100 KB, and the scanner is lazy-loaded. | ✅ PASS |
| **III. Cost Discipline** | No new external calls. `/api/meta` is local config, cacheable, with 0 eBay calls. History means re-viewing a result costs 0 lookups. | ✅ PASS |
| **IV. Spec-Driven** | Spec 006 → this plan → tasks. | ✅ PASS |
| **V. Sandbox-First Testing** | A new compose `web` service and a Playwright `e2e` profile. Nothing runs on the host. | ✅ PASS |
| **VI. Money Is Integer Cents** | Integer cents through the client. Dollar input is parsed without floats (R7), and dollars are formatted only at display. | ✅ PASS |
| **VII. Extensible Pipeline** | The client consumes the verdict response and doesn't reach into the steps. | ✅ PASS |
| **Stack constraint** | The constitution's Stack lists only the API, and there's no rule on accessibility. **Resolved by amendment 1.1.0**, applied during planning: add the web client to Stack and add Principle VIII "Accessible by Default (WCAG 2.2 AA)". This is a MINOR bump (a new principle), requested by the founder in the 006 kickoff. | ✅ PASS |
| **Valuation honesty** | FR-005 adds a basis note on every result, FR-006 never shows the raw asking median as the value, and UNCERTAIN is never presented as RIP (FR-004). | ✅ PASS |

**Post-Phase 1 re-check**: ✅ All pass. The design adds no hooks to the API request lifecycle
(static serving uses routes only; CSP is set via `setHeaders` on static files).

## Design

### Component tree

```text
<App>                               state: settings, history, lookup (useLookup), view
├─ <Header>                         wordmark (h1) + Settings button → <SettingsDialog>
├─ <main id="main">                 skip-link target
│  ├─ <LookupForm>                  label "Barcode or item name", input, [Check], [Scan]
│  │   └─ <CostField>               <details> "What I paid (optional)"
│  ├─ <ResultPanel>                 aria-labelledby its heading; states: empty | loading | result | error
│  │   ├─ <VerdictBanner>           icon + label (h2, receives focus) + reason
│  │   ├─ <MoneyBreakdown>          <dl>: sale value, fees, shipping, paid, profit
│  │   ├─ <MatchDetails>            matched title, confidence, category, competition
│  │   └─ <BasisNote>
│  └─ <RecentList>                  h2 "Recent", list of <button>s, Clear history
├─ <Scanner>                        lazy chunk; modal <dialog> with <video>, Cancel
├─ <SettingsDialog>                 native <dialog>: minimum profit ($), reset to default
└─ <LiveRegion>                     one polite + one assertive visually-hidden region
```

### Focus and announcement rules (FR-016)

- **New result**: focus moves to the verdict heading (`tabIndex=-1`), which is announced along
  with its reason (the heading is followed by the reason inside the labelled region).
- **Loading**: the polite live region says "Checking…". Focus stays on the button.
- **Validation errors**: `aria-invalid` plus `aria-describedby` on the input, and the error text is
  announced in the assertive region. Focus returns to the input.
- **Other errors**: an error panel in the result area whose heading receives focus, with a Retry
  button.
- **Scanner**: opens as a modal `<dialog>` (focus trapped natively), with Cancel focused first. On a
  read, the polite region announces "Scanned 9780345391803", and `navigator.vibrate?.(50)` fires.
- **Check another**: clears the input and focuses it.
- **Recent entry**: the result renders with a "Checked 3:42 PM" note, and focus moves to its verdict
  heading.

### Layout breakpoints

- `< 1024px`: one column (form, result, Recent). The Scan button is fixed in a bottom bar when the
  camera is supported.
- `≥ 1024px`: `grid-template-columns: minmax(18rem, 22rem) minmax(0, 1fr) minmax(16rem, 20rem)`.
  Recent scrolls independently (`max-block-size: calc(100dvh - header)`), and Scan is inline.

### API side

- `src/server.ts`:
  - Add `GET /api/meta` (R5).
  - Add `registerWebClient(app, dir)` using `@fastify/static` when `existsSync(join(dir,
    'index.html'))`, with the cache and CSP headers from R4 and R8.
  - Add `webDistDir` to `AppConfig` (`WEB_DIST_DIR`, default `web/dist`, resolved from `cwd`).
- Compose: add a `web` service (Vite dev, `:5173`, proxy to `api:3000`) and an `e2e` service
  (profile `e2e`, Playwright image matching the installed `@playwright/test` version).

## Project Structure

### Documentation (this feature)

```text
specs/006-web-client/
├── plan.md, research.md, data-model.md, quickstart.md
├── contracts/
│   ├── meta-api.yaml     # GET /api/meta
│   └── ui-states.md      # every screen state: copy, focus target, announcement, a11y checks
└── tasks.md
```

### Source Code

```text
web/
├── Dockerfile                     # node:24-slim, npm install, vite dev
├── package.json, tsconfig.json, vite.config.ts, vitest.config.ts, playwright.config.ts
├── index.html                     # lang="en", viewport, theme-color (light/dark), skip link
├── public/                        # favicon.svg, generated icons, robots.txt
├── scripts/check-size.mjs         # 100 KB gzip budget
├── src/
│   ├── main.tsx                   # render + SW registration
│   ├── app.tsx
│   ├── styles/
│   │   ├── tokens.css             # color/space/type tokens, light + dark + forced-colors
│   │   ├── base.css               # reset, focus-visible, reduced motion, utilities (.visually-hidden)
│   │   └── layout.css             # grid, bottom bar, breakpoints
│   ├── lib/
│   │   ├── api.ts                 # lookup(), meta(), typed errors (R6)
│   │   ├── types.ts               # VerdictResult etc. mirrored from contracts
│   │   ├── classify.ts            # barcode vs title (FR-001)
│   │   ├── money.ts               # parseDollarsToCents, formatCents, describeProfit (R7)
│   │   ├── storage.ts             # settings + history, safe wrappers (R10)
│   │   ├── verdict-copy.ts        # labels, icons, plain-language copy per verdict/tier/confidence
│   │   └── use-lookup.ts          # state machine, abort, sequence (R6)
│   ├── components/                # Header, LookupForm, CostField, ResultPanel, VerdictBanner,
│   │                              # MoneyBreakdown, MatchDetails, BasisNote, RecentList,
│   │                              # SettingsDialog, LiveRegion, Icon
│   └── scanner/
│       ├── scanner.tsx            # lazy-loaded dialog UI
│       └── detect.ts              # native BarcodeDetector → ponyfill fallback, self-hosted wasm
└── e2e/
    ├── fixtures.ts                # canned API responses for each state
    └── *.spec.ts                  # core loop, errors, layout/reflow, a11y matrix, keyboard
```

**Structure Decision**: The frontend is a sibling package `web/` with its own `package.json`, so
its dependencies never enter the API image or the API's `npm test`. The API stays in `src/`.

## Complexity Tracking

| Addition | Why Needed | Simpler Alternative Rejected Because |
|---|---|---|
| Second package (`web/`) | Browser build tooling and dependencies must not ship in the API | A single package would pull Vite, Preact and Playwright into the API image and its tests |
| WASM decoder (lazy) | iOS Safari has no `BarcodeDetector` (verified September 2026); iPhone is the primary audience | Native-only would leave scanning unavailable on every iPhone |
