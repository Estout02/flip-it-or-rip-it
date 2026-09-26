# Tasks: Web Client

**Input**: Design documents from `/specs/006-web-client/`

**Prerequisites**: plan.md, spec.md, research.md (R1–R12), data-model.md, contracts/ui-states.md, contracts/meta-api.yaml, quickstart.md, **spec 005 merged into the branch** (strict body + `competingSupplyCount`)

**Tests**: INCLUDED and mandatory. Constitution VIII requires an accessibility test for every UI
state, and SC-003 is defined by them. Component tests are colocated (`*.test.tsx`), e2e lives in
`web/e2e/`, and everything runs in Docker.

**Copy and behaviour source of truth**: `contracts/ui-states.md`. Use its strings verbatim.

## Format: `[ID] [P?] [Story] Description`

---

## Phase 1: Setup

- [X] T001 Scaffold `web/`: `package.json` (`"type": "module"`, scripts `dev`, `build` = `tsc --noEmit && vite build`, `preview`, `test` = `vitest run && node scripts/check-size.mjs` (the size check needs a build, so make `test` run `vite build` first, or make check-size build when `dist/` is missing), `typecheck`, `e2e` = `playwright test`), then install the deps listed in plan.md Technical Context at their latest stable versions, and commit `package-lock.json`. Add `tsconfig.json` (strict, `jsx: react-jsx`, `jsxImportSource: preact`, `moduleResolution: bundler`, `lib: [DOM, DOM.Iterable, ES2022]`). Add `vite.config.ts` with `@preact/preset-vite`, `server: { host: true, port: 5173, proxy: { '/api': 'http://api:3000', '/health': 'http://api:3000' } }`, `build.manifest: true`, and a `vite-plugin-pwa` config per research R9 (generateSW; `navigateFallback: 'index.html'`; `navigateFallbackDenylist: [/^\/api\//, /^\/health/]`; runtimeCaching `NetworkOnly` for `/api/`; `CacheFirst` for the scanner chunk and `*.wasm`; manifest name "Flip it or Rip it", short_name "Flip or Rip", `display: standalone`, theme/background colors from tokens). Add `vitest.config.ts` (jsdom, `setupFiles` for `@testing-library/jest-dom`-style matchers if used). Add `web/.gitignore` (`node_modules`, `dist`, `playwright-report`, `test-results`)
- [X] T002 Add `web/Dockerfile` (`node:24-slim`, `WORKDIR /app/web`, copy `package*.json`, `npm ci`, `CMD ["npm","run","dev"]`). In `docker-compose.yml` add a service `web` (build `./web`, ports `5173:5173`, volumes `./web:/app/web` and `/app/web/node_modules`, `depends_on: [api]`), and a service `e2e` under `profiles: [e2e]`, using image `mcr.microsoft.com/playwright:v<same version as @playwright/test>-noble`, `working_dir: /app/web`, volume `./web:/app/web` and `/app/web/node_modules`, `command: sh -c "npm ci && npx playwright test"`, and `ipc: host`. Make sure the root `.dockerignore` excludes `web/node_modules` and `web/dist` from the API image context
- [X] T003 [P] `web/index.html`: `<html lang="en">`, charset, `<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">` (never `maximum-scale` or `user-scalable=no`), two `theme-color` metas with `media="(prefers-color-scheme: light|dark)"`, `<meta name="color-scheme" content="light dark">`, `<title>Flip it or Rip it</title>`, a description meta, `<link rel="icon" href="/favicon.svg">`, and apple-touch-icon. There is no inline script (CSP R8)
- [X] T004 [P] Icons: create `web/public/favicon.svg` (a simple geometric mark: a rounded square split diagonally, one half using the flip green, the other the rip violet; legible at 16 px). Add `web/pwa-assets.config.ts` for `@vite-pwa/assets-generator` (minimal-2023 preset) and a script `generate-icons`. Run it once and commit the generated PNGs in `web/public/`

---

## Phase 2: Foundational (Blocking)

- [X] T005 [P] `web/src/styles/tokens.css`: every token from data-model.md "Design tokens", exactly as specified, under `:root` (light), `@media (prefers-color-scheme: dark)` overrides, and the forced-colors rules. Add a comment block recording the verified contrast ratios
- [X] T006 [P] `web/src/styles/base.css`: a modern minimal reset; `body` on `--bg`/`--text` using `--step-0`; `:focus-visible { outline: 3px solid var(--focus); outline-offset: 2px }` (never `outline: none` without a replacement); `.visually-hidden`; a skip-link style (visible on focus); `button, input, summary` minimum block size `var(--target)`; `@media (prefers-reduced-motion: reduce) { *, *::before, *::after { animation-duration: .01ms !important; animation-iteration-count: 1 !important; transition-duration: .01ms !important; scroll-behavior: auto !important } }`; and `font-variant-numeric: tabular-nums` on `.money`
- [X] T007 [P] `web/src/styles/layout.css`: the single-column default (max inline size 40 rem, centered, padding `--space-4`); the fixed bottom bar for `.scan-dock` below 1024 px, with `padding-bottom: env(safe-area-inset-bottom)` and a matching `scroll-padding-bottom` plus body bottom padding; and the ≥ 1024 px three-column grid from plan.md "Layout breakpoints", with Recent independently scrollable. No horizontal overflow at 320 px
- [X] T008 [P] `web/src/lib/types.ts`: types from data-model.md, with `VerdictResult` mirroring `specs/005-backend-hardening/contracts/lookup-api.yaml` (read that file)
- [X] T009 [P] `web/src/lib/money.ts` + `money.test.ts`: `parseDollarsToCents`, `formatCents`, `describeProfit` per data-model "Money" (no float multiplication). Tests: `'12'`→1200, `'12.5'`→1250, `'$1,234.05'`→123405, `'0'`→0, and errors for `'-1'`, `'1.234'`, `'abc'`, `''`, `'1234567'`; formatting of 0, 2207, −320 (true minus sign); describeProfit for both signs
- [X] T010 [P] `web/src/lib/classify.ts` + `classify.test.ts` per data-model "Input classification": `'9780345391803'`, `'978-0-345-39180-3'`, `'0345391802'`, `'034539180X'`, `'045496830434'`, `'12345678'` → identifier; `'1984'`, `'Chrono Trigger SNES'`, `'12345'` → title; a 201-character title → validation error; blank → validation error "Enter a barcode or an item name."
- [X] T011 [P] `web/src/lib/storage.ts` + `storage.test.ts` per research R10 / data-model: `loadSettings`/`saveSettings`, `loadHistory`/`addToHistory` (dedupe is not required; cap at 50, newest first)/`clearHistory`, and `storageAvailable()`. Every access is wrapped in try/catch. Tests cover the cap, ordering, malformed JSON → empty, and a throwing `localStorage` (stub) → memory-only, with `storageAvailable() === false`
- [X] T012 [P] `web/src/lib/api.ts` + `api.test.ts`: `lookup(input, signal)` → `VerdictResult` or a thrown typed `LookupError` per research R6 (400 uses the body's `message`; 429 → limit; 503 → unavailable; fetch `TypeError` or `navigator.onLine === false` → offline; else unexpected); an `AbortError` propagates as-is. `getMeta()` caches in memory and on failure returns `{ defaultProfitThresholdCents: 1000, lookupDailyCap: 50, marketplaceId: 'EBAY_US' }`. Tests use a stubbed `fetch`
- [X] T013 [P] `web/src/lib/verdict-copy.ts` + test: labels, eyebrows, competition phrases and the NO_MARKET_DATA / UNCERTAIN overrides, **verbatim** from `contracts/ui-states.md`; `nextUtcMidnightLocal(now)` for S8, formatted with `Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit' })`
- [X] T014 [P] `web/src/components/Icon.tsx`: inline SVG icons (tag, hourglass, heart-in-hand, question, scan, settings, alert, check, clock, trash). `aria-hidden="true"`, `focusable="false"`, `fill`/`stroke` `currentColor`, 24 px viewBox, hand-drawn simple paths (no icon library)
- [X] T015 [P] `web/src/components/LiveRegion.tsx` + a tiny `announce(message, 'polite'|'assertive')` module: two regions mounted once. Re-announcing identical text works (clear, then set on the next frame)
- [X] T016 API: in `src/server.ts` add `GET /api/meta` per `contracts/meta-api.yaml` (no rate-limit hook; `Cache-Control: public, max-age=300`); add `webDistDir` to `AppConfig` (`WEB_DIST_DIR`, default `web/dist`, resolved against `process.cwd()`); install `@fastify/static` in the root `package.json`; add `registerWebClient(app, dir)` per research R4/R8, called from `buildApp` only when `index.html` exists. HTML files get the CSP, `Referrer-Policy: no-referrer`, `Permissions-Policy: camera=(self)` and `Cache-Control: no-cache`; `sw.js`, `registerSW.js` and `manifest.webmanifest` get `no-cache`; `/assets/*` get `public, max-age=31536000, immutable`. It must not register any hook. Tests in `src/server.test.ts`: meta shape and values from config; meta is not charged against the lookup cap (cap 1: meta ×3, then lookup → 200); static serving with a temp dir containing `index.html` and `assets/a.js` → headers as specified; no dir → `GET /` 404 and `/api/lookup` unaffected. Update `.env.example` with `WEB_DIST_DIR`

**Checkpoint**: `docker compose run --rm web npm test` (lib tests) and `docker compose run --rm api npm test` are both green.

---

## Phase 3: User Story 1: Type and get a verdict (P1) 🎯 MVP

**Independent Test**: At 390 px with no camera, enter `9780345391803` → the verdict, reason, breakdown, match and basis note render, and focus is on the verdict heading.

- [X] T017 [US1] `web/src/lib/use-lookup.ts` + `use-lookup.test.tsx`: the state machine from data-model `LookupState`, with abort-previous and a sequence guard (FR-007). It adds a successful result to history via storage, and exposes `submit(input)`, `retry()`, `showEntry(entry)` and `reset()`. Tests: a stale response is discarded; double submit → one fetch in flight; retry re-sends the last input
- [X] T018 [P] [US1] `web/src/components/VerdictBanner.tsx` + test: the four treatments per ui-states "Verdict treatments" (icon + eyebrow + h2 label with `tabIndex=-1` + reason); the dashed border for UNCERTAIN; and the history note (S12)
- [X] T019 [P] [US1] `web/src/components/MoneyBreakdown.tsx` + test: the `<dl>` per S2 (cost row only when > 0), the hero profit via `describeProfit`, `.money` alignment, and an `unreliable` prop for S5's note
- [X] T020 [P] [US1] `web/src/components/MatchDetails.tsx` + `BasisNote.tsx` + tests: the matched title with the mobile clamp and "Show full title" toggle; the MEDIUM badge; the competition phrase per tier with `competingSupplyCount`; the basis note verbatim
- [X] T021 [US1] `web/src/components/ResultPanel.tsx` + test: composes S0 (empty), S1 (loading skeleton, `aria-busy`), S2–S4, S5 (UNCERTAIN: suggestions, closed `<details>` with the rough figures, no donate/recycle words; assert this in the test), and S6 (no-market, no breakdown). "Check another" calls `onCheckAnother`. On a new success, focus moves to the verdict heading (`useEffect` keyed on the entry id). Updates `document.title`
- [X] T022 [US1] `web/src/components/LookupForm.tsx` + `CostField.tsx` + tests: the label "Barcode or item name"; input `type="text"`, `inputmode="search"`, `enterkeyhint="go"`, `autocomplete="off"`, `autocapitalize="off"`, `spellcheck={false}`; the Check button (`aria-disabled` while loading, text "Checking…"); client-side validation via `classify` and `parseDollarsToCents` with S7 rendering (`aria-invalid`, `aria-describedby`, assertive announce, focus on the input); CostField as `<details><summary>What I paid (optional)</summary>` with `inputmode="decimal"`. It exposes `focusInput()` and `setValue()` via a ref for Check another, the scanner and S6
- [X] T023 [US1] `web/src/app.tsx` + `web/src/main.tsx`: the layout per the plan's component tree (header with h1 wordmark "Flip it or Rip it", skip link, main, form, result, Recent placeholder); wires `useLookup`, settings threshold (null → omit) and `getMeta()`; polite "Checking…" announce; registers the SW (`virtual:pwa-register`) in production only. Import the CSS in order tokens → base → layout, plus component CSS (one `app.css` is fine)
- [X] T024 [US1] Component-level accessibility test `web/src/a11y.test.tsx`: render `<App>` with a stubbed `fetch` into each of S0, S1, S2, S3, S4, S5, S6, and run `axe-core` (`axe.run(container, { runOnly: ['wcag2a','wcag2aa','wcag21aa','wcag22aa'] })`) → 0 violations each. (jsdom can't compute contrast; contrast is covered in e2e T036)

**Checkpoint**: The MVP works in `docker compose up` at :5173, typing only.

---

## Phase 4: User Story 2: Camera scanning (P1)

**Independent Test**: A device with a camera → Scan → barcode → verdict, with no typing. Denied → explanation → input focused.

- [X] T025 [US2] `web/src/scanner/detect.ts`: `createDetector()` per research R3. Use native `BarcodeDetector` if `'BarcodeDetector' in window` and `getSupportedFormats()` includes `ean_13`; otherwise `await import('barcode-detector/ponyfill')` and call `prepareZXingModule({ overrides: { locateFile: (path, prefix) => path.endsWith('.wasm') ? wasmUrl : prefix + path } })`, where `wasmUrl` comes from `import wasmUrl from 'zxing-wasm/reader/zxing_reader.wasm?url'` (**verify the exact wasm path and the `prepareZXingModule` export in the installed version**; the goal is that the wasm is emitted as a hashed asset on our origin). Formats `['ean_13','ean_8','upc_a','upc_e']`. `startScan(video, onCode, signal)` opens `getUserMedia({ video: { facingMode: { ideal: 'environment' } }, audio: false })`, runs the ~8 fps loop, accepts after 2 identical consecutive reads, and stops all tracks on accept/abort. It classifies failures as `'denied' | 'no-camera' | 'unsupported'` (`NotAllowedError` → denied; `NotFoundError`/`OverconstrainedError` → no-camera; missing `mediaDevices` → unsupported)
- [X] T026 [US2] `web/src/scanner/scanner.tsx` + test (mock `detect.ts`): a modal `<dialog>` per S15 (`showModal()`, Cancel focused first, Escape closes via the `cancel` event, the video `aria-hidden`, the target frame, "Point at a barcode"). On open it `history.pushState`s and closes on `popstate`; it closes on `visibilitychange` → hidden. Unsupported, denied and no-camera states use the S15 copy, and "Type it instead" closes and focuses the input. On a code: close, `setValue`, announce "Scanned {code}", `navigator.vibrate?.(50)`, then submit (ignored if a lookup is in flight). Restore focus to the Scan button on cancel
- [X] T027 [US2] Wire into `LookupForm`/`app.tsx`: the Scan button rendered only if `navigator.mediaDevices?.getUserMedia`, placed after Check, with class `scan-dock` (fixed bottom bar < 1024 px per T007); the scanner module is loaded via `lazy(() => import('./scanner/scanner'))` **only on the first click** (a test asserts no scanner import happens before the click); UNCERTAIN's "Scan the barcode" suggestion opens it too
- [X] T028 [US2] Verify with `npm run build` that the entry chunk doesn't contain `zxing`/`barcode-detector` (the check-size script from T037 asserts this) and that the `.wasm` is emitted into `dist/assets/`

---

## Phase 5: User Story 3: What I paid and threshold (P2)

- [X] T029 [P] [US3] `web/src/components/SettingsDialog.tsx` + test per S14: native `<dialog>`; the field "Minimum profit to flip ($)" pre-filled from settings or blank; help text with the meta default via `formatCents`; Save (validates with `parseDollarsToCents`, persists, closes, announces "Saved"); Use default (sets null); Close/Escape returns focus to the Settings button
- [X] T030 [US3] Header Settings button (`aria-haspopup="dialog"`, icon plus visible text "Settings" on ≥ 1024 px, and an accessible name at all widths) opens it. `useLookup` sends `profitThresholdCents` only when settings is non-null and `costBasisCents` only when > 0. Test: set $25 → the request body has `profitThresholdCents: 2500`; the cost field value is not persisted after submit

---

## Phase 6: User Story 4: Recent (P2)

- [X] T031 [US4] `web/src/components/RecentList.tsx` + test per S13: newest first; the accessible name pattern; the verdict chip; selecting an entry calls `showEntry` (**no fetch**; assert this) and moves focus to the verdict heading with the S12 note; empty state; Clear history with a confirm `<dialog>` (Cancel focused by default); the storage-unavailable notice. `id="recent"` for the S8 link
- [X] T032 [US4] Wire into `app.tsx`: on mobile it sits below the result; on desktop, in the right column

---

## Phase 7: User Story 5: Desktop layout (P2)

- [X] T033 [US5] Finish the ≥ 1024 px grid (T007) with the real components: form and settings summary (a line "Minimum profit: $X" with an Edit button opening the dialog) in the left column, the result in the center, Recent on the right. The input autofocuses only at ≥ 1024 px (`matchMedia` at mount). Keyboard loop check: Enter submits, the verdict heading gets focus, Tab reaches Check another, activating it focuses the input, and Tab reaches Recent items

---

## Phase 8: User Story 6: Errors (P3)

- [X] T034 [US6] Error panels in `ResultPanel` per S8–S11 (heading focus, copy verbatim, Retry wired to `retry()`; S8 has no Retry, uses the cap from meta and `nextUtcMidnightLocal`, and links to `#recent`). Validation (S7) stays inline at the input. Tests for each class, plus that the input value is preserved after each error
- [X] T035 [US6] Offline shell: confirm the SW precache serves the app offline in `vite preview` (covered by e2e T036). The offline error path is covered by the T034 unit test

---

## Phase 9: End-to-end, accessibility matrix, budget

- [ ] T036 `web/playwright.config.ts` (`webServer: { command: 'npm run build && npx vite preview --port 4173 --host', port: 4173 }`, `use.baseURL`; projects: `mobile-320` (320×640, hasTouch), `mobile-390` (390×844, hasTouch, isMobile), `desktop-1280` (1280×800); each project runs with `colorScheme` light and dark via a parameterised describe). `web/e2e/fixtures.ts`: canned `VerdictResult`s for FLIP, FLIP_RISKY, RIP, UNCERTAIN and NO_MARKET_DATA, and error responses 400/429/503, plus a helper `mockApi(page, handler)` using `page.route('**/api/**')`. Specs:
  - `core.spec.ts`: type → verdict for each fixture; focus on the verdict heading; basis note visible; Check another focuses the input; Recent persists across reload; selecting Recent makes no request (assert via route counter); settings persist across reload; stale-response guard (delay the first response, submit twice, and only the second renders)
  - `errors.spec.ts`: 400/429/503/offline (`context.setOffline(true)`) copy and focus; input preserved
  - `a11y.spec.ts`: for every state S0–S15 reachable without a camera (scanner: mock `navigator.mediaDevices` undefined → S15 unsupported, and `getUserMedia` rejecting `NotAllowedError` → denied), in both color schemes, run `new AxeBuilder({ page }).withTags(['wcag2a','wcag2aa','wcag21aa','wcag22aa']).analyze()` → `violations` is empty. For S2–S6 also run under `page.emulateMedia({ forcedColors: 'active' })`. Assert `scrollWidth <= clientWidth`, and that every visible `button, a, input, summary, select` (excluding links inside paragraphs) has a bounding box ≥ 44×44
  - `layout.spec.ts`: desktop shows form, result and Recent simultaneously in three columns (bounding boxes side by side); mobile 320 shows one column and the bottom Scan bar doesn't overlap the focused element when tabbing (for each focus stop, the focused element's rect doesn't intersect `.scan-dock`'s rect); 400% zoom emulation (viewport 320 wide at deviceScaleFactor 1, which approximates 1280/4) has no horizontal scroll; reduced motion → the computed `transition-duration` on the result is ≈ 0
  - `offline.spec.ts`: load once, go offline, reload → the app shell renders and Recent entries show
- [X] T037 `web/scripts/check-size.mjs`: read `dist/.vite/manifest.json`, take the `index.html` entry, recursively collect its `imports` (static only, **not** `dynamicImports`) plus their `css`, gzip each (`zlib.gzipSync`, level 9), sum, print `initial: X KB gzip (limit 100 KB)`, and exit 1 if over. Also exit 1 if any initial chunk's source contains `zxing` or `barcode-detector`
- [ ] T038 Run everything in Docker: `docker compose run --rm web npm test`, `docker compose run --rm web npm run typecheck`, `docker compose --profile e2e run --rm e2e`, `docker compose run --rm api npm test`, `docker compose run --rm api npm run typecheck`. All green. Fix, don't skip

---

## Phase 10: Polish

- [X] T039 [P] `CLAUDE.md`: add the web client to "Current state" (one paragraph: `web/` package, Preact + Vite, same-origin, scanner lazy, device-local history/settings, WCAG 2.2 AA enforced by axe in unit and e2e tests, 100 KB budget), to Stack, and to Commands (`docker compose up` now also serves :5173; `docker compose run --rm web npm test`; `docker compose --profile e2e run --rm e2e`; `docker compose run --rm web npm run build` for production serving). Note that `.dockerignore` excludes `web/node_modules`
- [X] T040 [P] `docs/PROJECT_BRIEF.md`: under Founder decisions, add a dated line (2026-09-26) recording the platform: responsive installable web app first (spec 006); native later on the same API
- [X] T041 Mark all tasks `[X]` as they complete

---

## Dependencies & Execution Order

- Phase 1 → Phase 2 → US1. US2–US6 each depend on US1's T021–T023 (the app shell) and are otherwise independent of each other.
- T016 (API) is independent of all `web/` tasks and can run anytime after Phase 1.
- Phase 9 needs all stories. T037 can be written early (after T001).

## Parallel Opportunities

- Phase 2: T005–T015 are all separate files, so fully parallel. T016 runs in parallel with all of them.
- US1: T018 ∥ T019 ∥ T020, then T021 → T022 → T023 → T024.
- After US1: US3, US4 and US6 in parallel (different components); US2 in parallel too.

## Implementation Strategy

**MVP** = Phases 1–3 (typing path, fully accessible). Then US2 (scanner, the speed win), then
US3/US4/US5/US6, then the Phase 9 matrix as the release gate. Suggested agent split: (A) Phase 1–2,
US1, US3–US6, polish; (B) US2 scanner (`web/src/scanner/`) once T022/T023 exist; (C) Phase 9 e2e +
budget once the UI exists. T016 goes to whoever touches the API.

---

## Implementation notes (T001–T035, T037, T039–T041)

Deviations from the literal task text, each keeping the task's intent:

- **T001**: `npm install` resolved TypeScript 7.x; pinned `typescript@^5` per plan.md "Language/Version:
  TypeScript 5". `npm test` = `vitest run && vite build && node scripts/check-size.mjs` (always builds,
  so the budget never checks a stale `dist/`). `includeAssets`/`includeManifestIcons` are off because
  `workbox.globPatterns` already precaches `public/` (otherwise every icon was precached twice).
- **T002**: Docker Hub pulls were hung daemon-wide during implementation (even `hello-world`), so the
  `node:24-slim` image behind `web/Dockerfile` (and the Playwright `e2e` image) could not be pulled or
  built. `docker compose config` validates. Every test/build/typecheck run was done in the equivalent
  throwaway container (`docker run -v ./web:/app/web node:22-slim …`, the only Node image cached
  locally). Run `docker compose build web` once pulls work.
- **T013/S13**: "1 similar listings" is pluralised to "1 similar listing". The Recent profit phrase is
  "no listings found" for NO_MARKET_DATA and "no reliable price" for UNCERTAIN, so an unmeasured figure
  is never shown as a profit (FR-004, US1-5).
- **T025/S15**: the contract gives copy for *denied* and *unsupported* only; *no camera* uses "No camera
  was found. Type the number under the barcode instead." Verified against barcode-detector 3.2.2:
  `prepareZXingModule` is re-exported by `barcode-detector/ponyfill`; the package pins zxing-wasm 3.1.3
  exactly, whose default `locateFile` targets jsDelivr, so we override it. The wasm path
  `zxing-wasm/reader/zxing_reader.wasm?url` exists as documented (`dist/reader/zxing_reader.wasm`,
  exported). A unit test asserts its SHA-256 equals the ponyfill's `ZXING_WASM_SHA256`. `NotReadableError`
  (camera busy) maps to *no-camera*.
- **T022**: a server-side 400 is shown inline (S7) while the result area keeps its previous content;
  the hook exposes `shown` (what the result area renders) separately from the machine `state`.
  An identical submit while one is in flight is ignored; a different one aborts the first (FR-007).
- **T031/S13**: each Recent button has an explicit `aria-label` in the S13 pattern (whitespace inside
  visually-hidden spans is trimmed by name computation, which garbled the name).
- **T033**: the "Minimum profit: $X (default) · Edit" summary shows at every width (useful on phones
  too), in the left column on desktop.
- **Forced colors**: buttons use `forced-color-adjust: none` with `ButtonFace`/`ButtonText`, because axe
  otherwise mixed the author `--btn-fg` with the forced background and reported a false 1.1:1.
- **T035**: confirmed with a scratch Chromium run: after one visit, offline reload renders the shell
  and Recent, and a lookup shows the offline panel. The e2e `offline.spec.ts` (T036) still owns this.
