# Tasks: Environment Badge

**Input**: `specs/007-environment-badge/` (spec.md, plan.md with binding decisions D1–D6, contracts/meta-api.yaml 0.2.0, quickstart.md)

**Tests**: INCLUDED. Constitution VIII requires an accessibility test for every new UI state. Write each task's tests before its implementation. Everything runs in Docker.

**Safety**: the user's live stack runs from this tree. Use one-off `docker compose run --rm …` (add `--no-deps` for `web`) or `docker compose --profile e2e run --rm e2e …` only. Never `up`, `down`, `restart` or `build`. Unit verifies use `npx vitest run <files>` rather than `npm test`, because `npm test` in `web/` rebuilds `web/dist`, which the live API serves.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: can run in parallel (different files, no dependency on an incomplete task)
- **[Story]**: US1 / US2 / US3 from spec.md

## Shared constants (defined once in T005, referenced everywhere)

| Constant (in `web/src/lib/verdict-copy.ts`) | Exact value |
|---|---|
| `TEST_DATA_LABEL` | `'Test data'` |
| `TEST_DATA_WIDE` | `' — eBay sandbox'` (leading space, em dash U+2014) |
| `TEST_DATA_EXPLAIN` | `". Results come from eBay's test environment, not real listings."` |
| `SANDBOX_NO_MARKET` | `"You're using eBay's test environment, which has very few listings. This item may well be for sale on real eBay."` |

`TEST_DATA_LABEL + TEST_DATA_WIDE + TEST_DATA_EXPLAIN` must equal the FR-002 text exactly: `Test data — eBay sandbox. Results come from eBay's test environment, not real listings.`

Fixture facts used by the tests below (from `web/src/test/fixtures.ts`, verified): `flip.matchedTitle` = `Chrono Trigger (Super Nintendo, 1995) — Cart Only`, `flip.profitCents` = 2207 → `+$22.07 profit`. `noMarket` has verdict `RIP` (label `Rip it`), `reasonCode: 'NO_MARKET_DATA'`, and query identifier `9780000000002`. `formatCents(1500)` = `$15.00`.

---

## Phase 1: Foundational (blocking prerequisites)

**Purpose**: the API field, client types and parsing, shared copy, icon, and color tokens. No UI yet.

- [X] T001 [P] API tests in `src/server.test.ts`, inside `describe('GET /api/meta (spec 006, research R5)')`:
  1. Update the existing test `'reports client-facing settings straight from config'`. Expect `res.headers['cache-control']` to be `'no-cache'` (was `'public, max-age=300'`) and `res.json()` to equal `{ defaultProfitThresholdCents: 1234, lookupDailyCap: 7, marketplaceId: 'EBAY_GB', ebayEnv: 'sandbox' }` (`testConfig.ebayEnv` is `'sandbox'`).
  2. Add the test `'reports the eBay environment (spec 007)'`: `makeApp({ config: { ebayEnv: 'production' } })`, GET `/api/meta` → status 200, `res.json().ebayEnv === 'production'`, and `res.headers['cache-control'] === 'no-cache'`.
- [X] T002 API implementation in `src/server.ts`, in the `app.get('/api/meta', …)` handler. Change `reply.header('Cache-Control', 'public, max-age=300')` to `reply.header('Cache-Control', 'no-cache')` and add `ebayEnv: config.ebayEnv,` as the last property of the returned object. Replace the comment above the route with: `// Local config only — zero eBay calls, so it carries no rate-limit hook and never touches the per-client lookup cap (research R5). no-cache (spec 007, plan D2): an operator switches eBay environments by restarting, and a cached response would show sandbox answers without the "Test data" badge.` Make no other change to `src/server.ts`. `contracts/meta-api.yaml` is already at 0.2.0 and needs no edit.
- [X] T003 [P] Client meta tests in `web/src/lib/api.test.ts`, in `describe('getMeta')`. Add these cases (each starts from a fresh cache, because the file's `beforeEach` already calls `resetMetaForTests()`):
  1. `fetchMock.mockResolvedValue(jsonResponse({ defaultProfitThresholdCents: 1000, lookupDailyCap: 50, marketplaceId: 'EBAY_US', ebayEnv: 'sandbox' }))` → `(await getMeta()).ebayEnv === 'sandbox'`
  2. The same with `ebayEnv: 'production'` → `'production'`
  3. The same with `ebayEnv: 'staging'` → the result `toEqual({ defaultProfitThresholdCents: 1000, lookupDailyCap: 50, marketplaceId: 'EBAY_US' })` and `'ebayEnv' in result === false`
  4. No `ebayEnv` key → `'ebayEnv' in result === false`
  5. `'ebayEnv' in DEFAULT_META === false`
  6. `fetchMock.mockRejectedValue(new TypeError('offline'))` → the result `toBe(DEFAULT_META)` and has no `ebayEnv`
- [X] T004 Client types and parsing (depends on T003). In `web/src/lib/types.ts`:
  - Add `export type EbayEnv = 'production' | 'sandbox';`.
  - Add `ebayEnv?: EbayEnv;` to `Meta` with the doc comment `/** Which eBay answers lookups (spec 007). Absent = unknown: the client shows no badge. */`.
  - Add `ebayEnv?: EbayEnv;` to `HistoryEntry` with the doc comment `/** Environment the result was checked in (spec 007). Absent on entries saved before 007 or while unknown. */`.

  In `web/src/lib/api.ts`:
  - Keep `isMeta` as is.
  - In `getMeta`, replace `return body;` with `return toMeta(body);`, where a new function is `function toMeta(m: Meta): Meta { const out: Meta = { defaultProfitThresholdCents: m.defaultProfitThresholdCents, lookupDailyCap: m.lookupDailyCap, marketplaceId: m.marketplaceId }; const env = (m as { ebayEnv?: unknown }).ebayEnv; if (env === 'production' || env === 'sandbox') out.ebayEnv = env; return out; }`.
  - Leave `DEFAULT_META` unchanged, with no `ebayEnv` (plan D1).
- [X] T005 [P] Copy in `web/src/lib/verdict-copy.ts` and `web/src/lib/verdict-copy.test.ts`:
  - Add `'flask'` to the `IconName` union.
  - Export the four constants from the "Shared constants" table above, verbatim, under the comment `// Spec 007: environment badge. Verbatim from specs/007-environment-badge/spec.md.`
  - Export `export function isTestEnv(env?: string): boolean { return env !== undefined && env !== 'production'; }`.

  Tests (a new `describe('environment copy (spec 007)')`):
  - `TEST_DATA_LABEL + TEST_DATA_WIDE + TEST_DATA_EXPLAIN` `toBe` `"Test data — eBay sandbox. Results come from eBay's test environment, not real listings."`
  - `SANDBOX_NO_MARKET` `toBe` the exact string from the table
  - `isTestEnv('sandbox') === true`, `isTestEnv('staging') === true`, `isTestEnv('production') === false`, `isTestEnv(undefined) === false`
- [X] T006 Flask icon in `web/src/components/Icon.tsx` (depends on T005, which adds `'flask'` to `IconName`). Add this entry to `PATHS`: `flask: <path d="M9 3h6M10 3v6L4.8 18.2A1.8 1.8 0 0 0 6.4 21h11.2a1.8 1.8 0 0 0 1.6-2.8L14 9V3M7.2 15h9.6" />,`. Change nothing else. The component already renders `aria-hidden="true"` and `stroke="currentColor"`.
- [X] T007 [P] Tokens in `web/src/styles/tokens.css` (plan D4):
  - In `:root`, after `--unc-tint`, add `--test-fg: #1e3a8a; --test-tint: #e4ecfb; --test-border: #3b5bcc;`.
  - In the `@media (prefers-color-scheme: dark)` `:root` block, after `--unc-tint`, add `--test-fg: #a9c1ff; --test-tint: #18223d; --test-border: #6f8fe8;`.
  - In the header comment, under "Additional pairs used by components", add these lines verbatim:
    - `*   --test-fg on --test-tint       8.73 /  8.81     --test-fg on --bg            9.65 / 10.68   (spec 007 badge)`
    - `*   --text on --test-tint         14.84 / 13.42`
    - `*   --test-border on --bg (UI)     5.50 /  6.15     --test-border on --test-tint 4.98 /  5.07`

**Checkpoint**: `GET /api/meta` returns `ebayEnv` with `no-cache`, and the client parses it. No visible change yet.

---

## Phase 2: User Story 1: I can tell at a glance that I'm looking at test data (P1) 🎯 MVP

**Goal**: a persistent, non-interactive "Test data" pill in the header whenever meta reports a non-production environment, and nothing when production or unknown.

**Independent test**: `src/app.env.test.tsx` US1 cases. With sandbox meta the badge renders in the header and axe is clean. With production meta or a failed meta request there is no badge.

- [X] T008 [US1] App-level tests.
  - In `web/src/test/app-harness.tsx`, change `mockApi(handler: LookupHandler)` to `mockApi(handler: LookupHandler, meta: Meta | null = META)`: for `/api/meta` return `jsonResponse(meta)` when `meta !== null`, else `new Response('boom', { status: 500 })`. Keep the exported `META` unchanged (no `ebayEnv`), so every existing test stays "unknown".
  - Create `web/src/app.env.test.tsx` with `afterEach(() => vi.unstubAllGlobals())`, the constants `SANDBOX = { ...META, ebayEnv: 'sandbox' as const }` and `PRODUCTION = { ...META, defaultProfitThresholdCents: 1500, ebayEnv: 'production' as const }`, and `describe('environment badge (spec 007, US1)')`:
    1. `mockApi(() => jsonResponse(flip), SANDBOX)`, `renderApp()`, `await waitFor(() => expect(document.querySelector('header .env-badge')).not.toBeNull())`. Then check:
       - The badge's `textContent` is `"Test data — eBay sandbox. Results come from eBay's test environment, not real listings."`.
       - `badge.previousElementSibling.tagName === 'H1'`.
       - `badge.nextElementSibling.classList.contains('header__settings')`.
       - `document.querySelector('header').classList.contains('app-header--badged')`.
       - `screen.getByRole('heading', { level: 1, name: 'Flip it or Rip it' })` exists.
    2. `mockApi(() => jsonResponse(flip), PRODUCTION)`, `renderApp()`, `await screen.findByText('$15.00')` (proves meta resolved), then `document.querySelector('.env-badge') === null` and the header has no `app-header--badged` class.
    3. `mockApi(() => jsonResponse(flip), null)`, `renderApp()`, `await waitFor(() => expect(fetchMock).toHaveBeenCalledWith('/api/meta'))`, `await new Promise((r) => setTimeout(r, 0))`, then `document.querySelector('.env-badge') === null`.
    4. axe: as case 1, then `axe.run(document.body, { runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa'] } })` → `violations` equals `[]` (the same pattern as `src/a11y.test.tsx`).
- [X] T009 [US1] Create `web/src/components/EnvBadge.tsx` and `web/src/components/EnvBadge.test.tsx`.

  Component: `export function EnvBadge({ env }: { env?: string })` returns `null` unless `isTestEnv(env)`. Otherwise it returns exactly:
  `<p class="env-badge"><Icon name="flask" class="icon--chip" /><span>{TEST_DATA_LABEL}</span><span class="env-badge__wide">{TEST_DATA_WIDE}</span><span class="visually-hidden">{TEST_DATA_EXPLAIN}</span></p>`
  It has no `role`, no `tabindex`, and no `aria-live` (plan D3: static text, not a live region, not focusable). Add the file comment `// Spec 007 (plan D3): persistent "Test data" pill for any non-production eBay environment.`

  Tests:
  1. `render(<EnvBadge />)` → `container.innerHTML === ''`
  2. `env="production"` → empty
  3. `env="sandbox"` → `p.env-badge` exists, its `textContent` is the FR-002 string, and it has no `role`, `tabindex` or `aria-live` attribute. `.env-badge__wide` has `textContent === ' — eBay sandbox'`, and `svg` has `aria-hidden="true"`.
  4. `env="staging"` → `p.env-badge` exists
  5. axe on the sandbox render (the tag set from T008) → 0 violations
- [X] T010 [US1] Header wiring (depends on T009).
  - In `web/src/components/Header.tsx`, add `ebayEnv?: string` to `Props`.
  - Set the header's `class` to `isTestEnv(ebayEnv) ? 'app-header app-header--badged' : 'app-header'`.
  - Wrap the wordmark's text node in `<span class="wordmark__text">Flip it or Rip it</span>`, keeping it inside the `h1` after the svg.
  - Render `<EnvBadge env={ebayEnv} />` between `</h1>` and the Settings `<button>`.

  In `web/src/app.tsx`, change `<Header onOpenSettings={openSettings} />` to `<Header onOpenSettings={openSettings} ebayEnv={meta.ebayEnv} />`. Make no other app.tsx change in this task.
- [X] T011 [US1] Styles in `web/src/styles/app.css`. This file holds **all** 007 CSS, including the classes WP4 and WP5 use. Add a section after the `/* ---------- Header ---------- */` block:
  ```css
  /* ---------- Environment badge (spec 007, plan D3/D4) ---------- */
  .env-badge,
  .env-note,
  .chip--test {
    background: var(--test-tint);
    color: var(--test-fg);
    border: 1.5px solid var(--test-border); /* solid: dashed is reserved for UNCERTAIN */
  }
  .env-badge,
  .env-note {
    display: inline-flex;
    align-items: center;
    gap: var(--space-1);
    padding: 0.125rem var(--space-2);
    border-radius: var(--radius-sm);
    font-size: var(--step--1);
    font-weight: 700;
    line-height: 1.25;
  }
  .env-badge {
    flex: 0 1 auto;
    min-inline-size: 0;
    margin-inline-start: auto; /* hugs the Settings button */
  }
  .env-note {
    justify-self: start;
  }
  @media (max-width: 479.98px) {
    /* Visually only: assistive technology still gets "— eBay sandbox" at every width (FR-002). */
    .env-badge__wide {
      position: absolute;
      inline-size: 1px;
      block-size: 1px;
      overflow: hidden;
      clip-path: inset(50%);
      white-space: nowrap;
    }
  }
  @media (max-width: 359.98px) {
    /* Room for the badge at 320 px: keep the logo mark; the h1's accessible name is unchanged. */
    .app-header--badged .wordmark__text {
      position: absolute;
      inline-size: 1px;
      block-size: 1px;
      overflow: hidden;
      clip-path: inset(50%);
      white-space: nowrap;
    }
  }
  @media (forced-colors: active) {
    .env-badge,
    .env-note {
      border: 1px solid CanvasText;
      forced-color-adjust: auto;
    }
  }
  ```
  Never use `display: none` for `.env-badge__wide` or `.wordmark__text`. Do not change `.app-header` in `layout.css`. Measured in the e2e Chromium: with these rules the header stays 64 px tall at 320, 390 and 1280 px, and the narrow pill is about 94 px wide.

**Checkpoint**: sandbox shows the pill, production and unknown show nothing, and axe is clean.

---

## Phase 3: User Story 2: A "not being sold" answer explains itself in test mode (P1)

**Goal**: S6 adds the `SANDBOX_NO_MARKET` paragraph in sandbox.

**Independent test**: `ResultPanel.test.tsx` US2 cases.

- [ ] T012 [P] [US2] Tests in `web/src/components/ResultPanel.test.tsx`, in a new `describe('sandbox no-market sentence (spec 007, US2)')`. Define `const SANDBOX_META = { ...DEFAULT_META, ebayEnv: 'sandbox' as const }` and `const PROD_META = { ...DEFAULT_META, ebayEnv: 'production' as const }`, and import `SANDBOX_NO_MARKET` from `../lib/verdict-copy`.
  1. `renderPanel(success(noMarket), { meta: SANDBOX_META })` → `screen.getByText(SANDBOX_NO_MARKET)` exists and is a `P` with class `sandbox-note`
  2. `renderPanel(success(noMarket), { meta: PROD_META })` → `screen.queryByText(SANDBOX_NO_MARKET) === null`
  3. `renderPanel(success(noMarket))` (DEFAULT_META, unknown) → null
  4. `renderPanel(success(flip), { meta: SANDBOX_META })` and `renderPanel(success(uncertain), { meta: SANDBOX_META })` → null (other verdicts never show it)
  5. History, sandbox entry under production meta: `renderPanel({ status: 'success', entry: { ...entryFor(noMarket), ebayEnv: 'sandbox' }, fromHistory: true }, { meta: PROD_META })` → present
  6. History, legacy entry under sandbox meta: `renderPanel({ status: 'success', entry: entryFor(noMarket), fromHistory: true }, { meta: SANDBOX_META })` → null
- [ ] T013 [US2] Implementation in `web/src/components/ResultPanel.tsx` (depends on T012). In the `case 'success'` block, after `const savedAt = …`, add `const env = fromHistory ? entry.ebayEnv : meta.ebayEnv;` (plan D6). In the `isNoMarket(r)` branch, insert `{isTestEnv(env) && <p class="sandbox-note">{SANDBOX_NO_MARKET}</p>}` directly after `<VerdictBanner … />` and before `<BasisNote />`. Import `isTestEnv` and `SANDBOX_NO_MARKET` from `../lib/verdict-copy`. The paragraph needs no CSS.

**Checkpoint**: a sandbox no-market result explains itself, and production is unchanged.

---

## Phase 4: User Story 3: Saved results remember where they came from (P2)

**Goal**: history entries carry `ebayEnv`. Recent shows a "Test data" chip, and reopened sandbox results show an env note.

**Independent test**: `VerdictBanner`, `ResultPanel`, `use-lookup`, `RecentList` and `app.env.test.tsx` US3 cases.

- [ ] T014 [US3] Env note in `web/src/components/VerdictBanner.tsx` and `web/src/components/VerdictBanner.test.tsx`.
  - Add `testData?: boolean` to `Props`, with the doc comment `/** Spec 007: history result checked in a non-production environment. Only shown with savedAt. */`.
  - Add `const ENV_NOTE_ID = 'result-env-note';`.
  - Directly after the `savedAt` `<p id={SAVED_NOTE_ID}…>` element, render `{savedAt && testData && (<p id={ENV_NOTE_ID} class="env-note"><Icon name="flask" class="icon--chip" />{TEST_DATA_LABEL}{TEST_DATA_WIDE}</p>)}`.
  - Change the heading's `aria-describedby` to `savedAt ? (testData ? \`${SAVED_NOTE_ID} ${ENV_NOTE_ID}\` : SAVED_NOTE_ID) : undefined`.

  Tests:
  1. `render(<VerdictBanner result={flip} savedAt="2026-09-26T19:42:00.000Z" testData />)` → `#result-env-note` has `textContent === 'Test data — eBay sandbox'`, and the heading's `aria-describedby === 'result-saved-note result-env-note'`
  2. `savedAt` without `testData` → no `#result-env-note`, and `aria-describedby === 'result-saved-note'`
  3. `testData` without `savedAt` → no `#result-env-note`, and no `aria-describedby` attribute
- [ ] T015 [US3] Pass the flag from `web/src/components/ResultPanel.tsx`, with tests in `web/src/components/ResultPanel.test.tsx` (depends on T013 and T014). In the `case 'success'` block, add `const testData = fromHistory && isTestEnv(entry.ebayEnv);` and add `testData={testData}` to all three `<VerdictBanner …>` usages.

  Tests (a new `describe('history env note (spec 007, US3)')`, reusing `SANDBOX_META` and `PROD_META` from T012):
  1. `{ status: 'success', entry: { ...entryFor(flip), ebayEnv: 'sandbox' }, fromHistory: true }` with `PROD_META` → `document.getElementById('result-env-note').textContent === 'Test data — eBay sandbox'`
  2. The same entry with `fromHistory: false` and `SANDBOX_META` → no `#result-env-note` (live results rely on the header badge)
  3. `entryFor(flip)` (legacy) with `fromHistory: true` → none
  4. `{ ...entryFor(flip), ebayEnv: 'production' }` with `fromHistory: true` → none
- [ ] T016 [P] [US3] Stamp the environment in `web/src/lib/use-lookup.ts` and `web/src/lib/use-lookup.test.tsx`.
  - Change the signature to `export function useLookup(ebayEnv?: EbayEnv): UseLookup` (import `EbayEnv` from `./types`).
  - Add `const envRef = useRef(ebayEnv); envRef.current = ebayEnv;` next to the other refs. `submit` has `[]` deps, so it must read the ref at save time.
  - In the success handler, build the entry with `...(envRef.current !== undefined ? { ebayEnv: envRef.current } : {}),` after `result,`.
  - Make no network request here (the environment comes from the caller).

  Tests (in the existing `describe('useLookup')`, using the file's `pending` fetch pattern):
  1. `renderHook(() => useLookup('sandbox'))`, `submit({ title: 'x' })`, `pending[0].resolve(jsonResponse(flip))` → the success entry has `ebayEnv === 'sandbox'`, and `loadHistory()[0].ebayEnv === 'sandbox'`
  2. `renderHook(() => useLookup())`, the same flow → `'ebayEnv' in entry === false`, and `'ebayEnv' in loadHistory()[0] === false`
  3. `renderHook(({ env }) => useLookup(env), { initialProps: { env: undefined as EbayEnv | undefined } })`, then `rerender({ env: 'production' })`, then submit and resolve → `entry.ebayEnv === 'production'`
- [ ] T017 [US3] Wire it in `web/src/app.tsx` (depends on T010 and T016). Move the line `const [meta, setMeta] = useState<Meta>(DEFAULT_META);` above `const lookup = useLookup();`, and change the latter to `const lookup = useLookup(meta.ebayEnv);`. No other change.
- [ ] T018 [P] [US3] Chip in `web/src/components/RecentList.tsx` and `web/src/components/RecentList.test.tsx`. In the `history.map` callback, add `const test = isTestEnv(e.ebayEnv);`.
  - Set the button's `aria-label` to `` `${test ? `${TEST_DATA_LABEL}: ` : ''}${copy.label}: ${title}, ${profit}, checked ${time}` ``.
  - As the **first** child of the button, before the verdict chip, render `{test && (<span class="chip chip--test"><Icon name="flask" class="icon--chip" />{TEST_DATA_LABEL}</span>)}`.

  DOM order and visual order are both chip-first. `.recent-item` is a single-column grid, so the chip sits on its own row above the verdict chip, and no CSS change is needed. This makes the accessible name start with the visible text (plan D5, WCAG 2.5.3). Update the name-pattern comment to mention the optional "Test data: " prefix.

  Tests (with `now` from the file):
  1. `[{ ...entryFor(flip, { id: 's', checkedAt: now.toISOString() }), ebayEnv: 'sandbox' as const }]` → `screen.getByRole('button', { name: \`Test data: Flip it: Chrono Trigger (Super Nintendo, 1995) — Cart Only, +$22.07 profit, checked ${formatCheckedAt(now.toISOString())}\` })` exists. Its `firstElementChild` has class `chip--test` and `textContent === 'Test data'`.
  2. `ebayEnv: 'production'` → no `.chip--test`, and the button's `aria-label` starts with `'Flip it: '`
  3. `entryFor(flip, { id: 'l', checkedAt: now.toISOString() })` (legacy) → no `.chip--test`, and the `aria-label` starts with `'Flip it: '`
- [ ] T019 [US3] Integration tests appended to `web/src/app.env.test.tsx` (depends on T008, T013, T017 and T018), in `describe('environment origin (spec 007, US2 + US3)')`:
  1. `mockApi(() => jsonResponse(noMarket), SANDBOX)`, `const { input } = renderApp()`, `await waitFor(() => expect(document.querySelector('.env-badge')).not.toBeNull())` (meta resolved before the lookup), then `typeAndSubmit(input, '9780000000002')` and `await screen.findByText(SANDBOX_NO_MARKET)`. Then check:
     - `screen.getByRole('button', { name: /^Test data: Rip it: / })` exists.
     - `JSON.parse(localStorage.getItem(HISTORY_KEY)!)[0].ebayEnv === 'sandbox'` (import `HISTORY_KEY` from `./lib/storage`).
  2. `mockApi(() => jsonResponse(noMarket), PRODUCTION)`, `renderApp()`, `await screen.findByText('$15.00')`, then submit `'9780000000002'` and `await screen.findByRole('heading', { level: 2, name: 'Rip it' })`. Then check:
     - `screen.queryByText(SANDBOX_NO_MARKET) === null`.
     - `screen.getByRole('button', { name: /^Rip it: / })` exists.
     - `document.querySelector('.chip--test') === null`.

**Checkpoint**: all three stories work in the unit suite.

---

## Phase 5: End-to-end, accessibility and layout (Playwright)

- [ ] T020 E2E fixtures in `web/e2e/fixtures.ts`.
  - Change the signature to `mockApi(target, handler = byQuery, meta: Meta = META, metaDelayMs = 0)`. In the `/api/meta` branch, `if (metaDelayMs) await new Promise((r) => setTimeout(r, metaDelayMs));` before `route.fulfill({ json: meta })`.
  - Export `SANDBOX_META: Meta = { ...META, ebayEnv: 'sandbox' }` and `PRODUCTION_META: Meta = { ...META, defaultProfitThresholdCents: 1500, ebayEnv: 'production' }`.
  - Export `BADGE_TEXT = "Test data — eBay sandbox. Results come from eBay's test environment, not real listings."`.
  - Leave `META` unchanged (no `ebayEnv`), so every existing spec keeps running with an unknown environment.
- [ ] T021 Header cases in a new `web/e2e/env.spec.ts` (depends on T020), wrapped in `for (const colorScheme of THEMES) { test.describe(\`env badge (${colorScheme})\`, () => { test.use({ colorScheme }); … }) }` so it runs for all three projects in both schemes. Let `w = page.viewportSize()!.width`.
  - (a) Sandbox: `mockApi(page, byQuery, SANDBOX_META)`, `gotoApp(page)`. Then check:
    - `page.locator('header .env-badge')` is visible, `toBeInViewport()`, and `toHaveText(BADGE_TEXT)`.
    - If `w < 480`, `.env-badge__wide`'s `boundingBox().width <= 1`, else `> 1`.
    - If `w < 360`, `.wordmark__text`'s `boundingBox().width <= 1`, else `> 1`.
    - `page.getByRole('heading', { level: 1, name: 'Flip it or Rip it' })` is visible.
    - `expectNoHorizontalScroll(page)` and `expectNoAxeViolations(page, \`badge / ${colorScheme}\`)`.
  - (a-forced) As (a), then `page.emulateMedia({ forcedColors: 'active' })`. Then check:
    - `expectNoAxeViolations`.
    - The badge's computed `borderTopStyle === 'solid'` and `borderTopWidth === '1px'`.
  - (b) Production: `mockApi(page, byQuery, PRODUCTION_META)`, `gotoApp(page)`, `await expect(page.locator('.threshold .money')).toHaveText('$15.00')` (meta resolved), then `expect(page.locator('.env-badge')).toHaveCount(0)`.
  - (f) Layout-shift guard: `mockApi(page, byQuery, SANDBOX_META, 500)`, `page.goto('/')`, `await input(page).click()`, `await input(page).pressSequentially('Chrono')`, `await expect(page.locator('.env-badge')).toHaveCount(0)`. Then:
    1. Record `inputBefore = await input(page).boundingBox()` and `headerBefore = await page.locator('header.app-header').boundingBox()`.
    2. `await expect(page.locator('.env-badge')).toBeVisible()`.
    3. Re-measure, and assert `inputAfter.y` and `inputAfter.x` are `toBeCloseTo` the before values, and `headerAfter.height` is `toBeCloseTo(headerBefore.height, 0)`.
    4. `expect(input(page)).toBeFocused()` and `toHaveValue('Chrono')`.
- [ ] T022 Result and history cases in `web/e2e/env.spec.ts` (depends on T021; same file, same `THEMES` loop):
  - (c) Sandbox no-market: `mockApi(page, byQuery, SANDBOX_META)`, `gotoApp`, `await expect(page.locator('.env-badge')).toBeVisible()`, `lookupFixture(page, 'noMarket')`. Then check:
    - `page.getByText("You're using eBay's test environment, which has very few listings. This item may well be for sale on real eBay.")` is visible.
    - `expectStateAccessible(page, \`S6 sandbox / ${colorScheme}\`)`.
    - Then `emulateMedia({ forcedColors: 'active' })` and `expectNoAxeViolations` again.
  - (d) History origin: do (c)'s lookup, then `await page.unroute('**/api/**')`, `await mockApi(page, byQuery, PRODUCTION_META)`, `await page.reload()`, `await expect(page.locator('.threshold .money')).toHaveText('$15.00')`. Then check:
    - `expect(page.locator('.env-badge')).toHaveCount(0)`.
    - The first Recent button (`page.locator('#recent .recent-item').first()`) has an `aria-label` matching `/^Test data: Rip it: /` and contains `.chip--test` with text `Test data`.
    - Click it → `resultHeading(page)` has text `Rip it` and is focused.
    - `#result-env-note` has text `Test data — eBay sandbox`.
    - The sandbox sentence is visible.
    - `expectStateAccessible(page, \`S12 sandbox / ${colorScheme}\`)`.

---

## Phase 6: Docs and close-out

- [ ] T023 [P] `CLAUDE.md`, in the web client paragraph of "Current state". Directly after the sentence ending ``All UI copy comes verbatim from `specs/006-web-client/contracts/ui-states.md`.``, insert: ``Whenever `/api/meta` reports an `ebayEnv` other than `production`, the client shows a "Test data — eBay sandbox" badge in the header, adds a sparse-sandbox sentence to no-market results, and marks Recent entries checked in sandbox (spec `specs/007-environment-badge/`); `/api/meta` is served `no-cache` so an environment switch shows on the next page load.``
- [ ] T024 [P] `specs/006-web-client/contracts/ui-states.md`, under `## Global`, append this bullet: ``- **Environment badge (spec 007)**: when `/api/meta` reports an `ebayEnv` other than `production`, the header shows a non-interactive "Test data" pill ("Test data — eBay sandbox" at ≥ 480 px; full text for assistive technology: "Test data — eBay sandbox. Results come from eBay's test environment, not real listings."). S6 then adds "You're using eBay's test environment, which has very few listings. This item may well be for sale on real eBay." Recent entries (name prefixed "Test data: ") and S12 results checked in sandbox carry a "Test data" marker. Unknown environment shows nothing. Details: `specs/007-environment-badge/`.``
- [ ] T025 Mark T001–T025 `[X]` in `specs/007-environment-badge/tasks.md`

---

## Dependencies & execution order

- **Foundational** (T001–T007): T001 → T002. T003 → T004. T005 → T006. T007 is independent. T001, T003, T005 and T007 can start together.
- **US1** (T008–T011): needs T004–T007. T009 → T010. T008 and T011 are independent of each other.
- **US2** (T012–T013): needs T004 and T005. It is independent of US1 (no shared files).
- **US3**: T014–T015 need T013 (same file). T016 and T018 need only the foundation. T017 needs T010 and T016. T019 needs T008, T013, T017 and T018.
- **E2E** (T020–T022): needs all UI tasks.
- **Docs** (T023–T025): last.

The full-suite run (API `npm test` + typecheck, web `npm test` + typecheck, full e2e) belongs to the orchestrator's verify phase. **SC-004 budget**: `web/scripts/check-size.mjs` reported **19.9 KB** initial gzip on 2026-09-26 before this feature. After it, the figure must be **< 20.9 KB**.

## Parallel examples

- Wave 1: T001 (API tests) ∥ T003 (client meta tests) ∥ T005 (copy) ∥ T007 (tokens)
- Wave 2: T009 (EnvBadge) ∥ T012 (ResultPanel US2 tests) ∥ T011 (CSS)
- Within US3: T016 (use-lookup) ∥ T018 (RecentList) ∥ T014 (VerdictBanner)

## Implementation strategy

MVP = Foundational + US1: the header pill alone fixes the misreading from the spec's background. US2 then fixes the exact surprise moment, and US3 keeps Recent honest across environment switches. Every phase leaves the app shippable, and an unknown environment always renders exactly as before 007.

## Work Packages

| WP | Tasks | Owns (files/globs) | Depends on | Tier | Verify |
|----|-------|--------------------|------------|------|--------|
| WP1 | T001–T002 | src/server.ts, src/server.test.ts | — | sonnet | docker compose run --rm api sh -c "npx vitest run src/server.test.ts && npm run typecheck" |
| WP2 | T003–T007 | web/src/lib/types.ts, web/src/lib/api.ts, web/src/lib/api.test.ts, web/src/lib/verdict-copy.ts, web/src/lib/verdict-copy.test.ts, web/src/components/Icon.tsx, web/src/styles/tokens.css | — | sonnet | docker compose run --rm --no-deps web sh -c "npx vitest run src/lib/api.test.ts src/lib/verdict-copy.test.ts && npm run typecheck" |
| WP3 | T008–T011 | web/src/test/app-harness.tsx, web/src/app.env.test.tsx, web/src/components/EnvBadge.tsx, web/src/components/EnvBadge.test.tsx, web/src/components/Header.tsx, web/src/app.tsx, web/src/styles/app.css | WP2 | sonnet | docker compose run --rm --no-deps web sh -c "npx vitest run src/components/EnvBadge.test.tsx src/app.env.test.tsx src/app.test.tsx src/a11y.test.tsx && npm run typecheck" |
| WP4 | T012–T015 | web/src/components/ResultPanel.tsx, web/src/components/ResultPanel.test.tsx, web/src/components/VerdictBanner.tsx, web/src/components/VerdictBanner.test.tsx | WP2 | sonnet | docker compose run --rm --no-deps web sh -c "npx vitest run src/components/ResultPanel.test.tsx src/components/VerdictBanner.test.tsx && npm run typecheck" |
| WP5 | T016–T019 | web/src/lib/use-lookup.ts, web/src/lib/use-lookup.test.tsx, web/src/components/RecentList.tsx, web/src/components/RecentList.test.tsx, web/src/app.tsx, web/src/app.env.test.tsx | WP3, WP4 | sonnet | docker compose run --rm --no-deps web sh -c "npx vitest run src/lib/use-lookup.test.tsx src/components/RecentList.test.tsx src/app.env.test.tsx src/app.test.tsx && npm run typecheck" |
| WP6 | T020–T022 | web/e2e/fixtures.ts, web/e2e/env.spec.ts | WP3, WP4, WP5 | sonnet | docker compose --profile e2e run --rm e2e sh -c "npm ci && npx playwright test e2e/env.spec.ts" |
| WP7 | T023–T025 | CLAUDE.md, specs/006-web-client/contracts/ui-states.md, specs/007-environment-badge/tasks.md | WP1, WP2, WP3, WP4, WP5, WP6 | haiku | grep -c "Test data" CLAUDE.md specs/006-web-client/contracts/ui-states.md |
