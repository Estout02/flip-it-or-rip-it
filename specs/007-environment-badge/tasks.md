# Tasks: Environment Badge

**Input**: `/specs/007-environment-badge/` (spec.md, plan.md with decisions D1–D6, contracts/meta-api.yaml 0.2.0, quickstart.md)

**Tests**: INCLUDED (constitution VIII: every new UI state gets an accessibility test). Write tests first. Everything runs in Docker.

## Format: `[ID] [P?] [Story] Description`

---

## Phase 1: Foundational

- [ ] T001 [P] API: in `src/server.ts`, add `ebayEnv: config.ebayEnv` to the `/api/meta` response and change its `Cache-Control` to `no-cache` (plan D2; update the doc comment to say why). In `src/server.test.ts`, update the meta tests: `ebayEnv` is `'sandbox'` under `testConfig` and `'production'` with `{ ebayEnv: 'production' }`, and the header is `no-cache`
- [ ] T002 [P] Client types and API: in `web/src/lib/types.ts`, add `ebayEnv?: 'production' | 'sandbox'` to `Meta` and `HistoryEntry` (doc comments: absent means unknown or an older entry). In `web/src/lib/api.ts`, make `isMeta` accept `ebayEnv` when it is one of the two values, strip any other value to undefined, and keep `ebayEnv` out of `DEFAULT_META` (plan D1). Tests in `api.test.ts`: sandbox and production pass through; `'staging'` and a missing value become undefined; the fallback has no `ebayEnv`
- [ ] T003 [P] `web/src/styles/tokens.css`: add the `--test-fg`, `--test-tint` and `--test-border` light/dark values from plan D4, with the verified ratios in a comment
- [ ] T004 [P] `web/src/lib/verdict-copy.ts` + test: export `TEST_DATA_LABEL = 'Test data'`, `TEST_DATA_WIDE = ' — eBay sandbox'`, `TEST_DATA_EXPLAIN = ". Results come from eBay's test environment, not real listings."`, and `SANDBOX_NO_MARKET = "You're using eBay's test environment, which has very few listings. This item may well be for sale on real eBay."`, verbatim from the spec, plus `isTestEnv(env?: string): boolean` (true only for a defined value that isn't `'production'`)

## Phase 2: User Story 1: Header indicator (P1) 🎯 MVP

- [ ] T005 [US1] `web/src/components/EnvBadge.tsx` + `EnvBadge.test.tsx`: renders nothing unless `isTestEnv(env)`. Otherwise renders `<p class="env-badge">` with a flask `Icon` (add a `flask` path to `Icon.tsx`: `aria-hidden`, `currentColor`), `<span>Test data</span><span class="env-badge__wide"> — eBay sandbox</span><span class="visually-hidden">{TEST_DATA_EXPLAIN}</span>`. No role, no tabindex, and no live region (plan D3). Tests: nothing for production, undefined or unknown values; the full text content for sandbox; an axe check passes
- [ ] T006 [US1] Render `<EnvBadge env={meta.ebayEnv} />` in the header row between the wordmark and the Settings button (`Header.tsx` or `app.tsx`, wherever the header lives), passing the resolved meta. CSS in `app.css`: a pill in `--test-tint`/`--test-fg`, a 1.5 px `--test-border`, `--radius-sm`, `--step--1`-ish text with the icon at 1em. Under 480 px, hide `.env-badge__wide` **visually only**, with the `.visually-hidden` clip pattern and never `display:none`, so assistive technology gets the full "Test data — eBay sandbox. Results come from…" text at every width (FR-002). Assert that text in tests. When the badge is present and the viewport is under 360 px, visually hide the wordmark text via a modifier class on the header, keeping the `h1`'s accessible name. The header row's block size must not change when the badge appears. Forced colors: `border: 1px solid CanvasText`

## Phase 3: User Story 2: Sandbox no-market sentence (P1)

- [ ] T007 [US2] In `web/src/components/ResultPanel.tsx`, for S6 (no-market), when `isTestEnv(env)` render a paragraph with `SANDBOX_NO_MARKET` after the reason. `env` is the entry's `ebayEnv` for history results and the current `meta.ebayEnv` for live ones (plan D6). Tests: sandbox → the sentence is present; production and undefined → absent; other verdicts never show it

## Phase 4: User Story 3: History origin (P2)

- [ ] T008 [US3] In `web/src/lib/use-lookup.ts`, stamp `ebayEnv` on each saved `HistoryEntry` from the resolved meta (omit when unknown). Pass meta in as a hook argument or resolve `getMeta()` before saving; don't add a network request per lookup (meta is already cached by `getMeta`). Test: an entry saved under sandbox meta has `ebayEnv: 'sandbox'`; under the fallback, no key
- [ ] T009 [US3] In `web/src/components/RecentList.tsx`, for entries with `isTestEnv(entry.ebayEnv)`: a "Test data" chip (the same token pair, a small pill with the flask icon) placed first in the button's visible content, and an `aria-label` prefixed with `"Test data: "` so the name starts with the visible text (plan D5, WCAG 2.5.3). Tests: the chip and prefix appear for sandbox entries and not for production or legacy entries
- [ ] T010 [US3] Reopened history results: under the S12 "Saved result" note, render `<p class="env-note">` "Test data — eBay sandbox" when `isTestEnv(entry.ebayEnv)`. Add it to the heading's `aria-describedby` alongside the existing history note. Test: present for a sandbox entry even when the current meta is production

## Phase 5: E2E, accessibility and budget

- [ ] T011 `web/e2e/fixtures.ts`: let `mockApi` take a meta override. Add `web/e2e/env.spec.ts` covering, for each project (320/390/1280) and both color schemes: (a) sandbox meta → the badge is visible in the header, has the correct accessible text (`toHaveAccessibleName` doesn't apply to `<p>`, so assert `textContent` contains the full sentence), and 320 px has no header wrap (the header's height equals its height with production meta) and no horizontal overflow; (b) production meta → no `.env-badge`; (c) sandbox no-market → the sentence is shown; (d) a sandbox history entry reopened under production meta → the chip in Recent plus the env note; (e) axe with 0 violations on (a), (c) and (d), plus forced colors for (a); (f) the layout-shift guard: delay the meta response by 500 ms, type into the input immediately, and assert the input's bounding box doesn't move when the badge appears
- [ ] T012 Run everything: API `npm test` + typecheck; web `npm test` (the size budget must stay under 100 KB, and the growth versus 19.9 KB should be < 1 KB, per SC-004) + typecheck; the full e2e suite (`docker compose --profile e2e run --rm e2e`). All green
- [ ] T013 [P] Docs: in `CLAUDE.md` "Current state", add one sentence saying the client shows a "Test data" badge whenever the API runs against the eBay sandbox. In `specs/006-web-client/contracts/ui-states.md`, add a short "Global: environment badge (spec 007)" note pointing to spec 007
- [ ] T014 Mark tasks `[X]`

## Dependencies

T001–T004 are parallel. Then T005 → T006; T007, T008 → T009 → T010 can follow T004; T011 needs all UI tasks; T012 comes last.
