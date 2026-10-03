# Implementation Plan: Native Sheet UI

**Branch**: `008-native-sheet-ui` | **Date**: 2026-09-26 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/008-native-sheet-ui/spec.md`

## Summary

Restyle the existing `web/` Preact client to the founder's chosen "native sheet" direction: the
camera owns the screen and the verdict rises over it as a frosted bottom sheet, so dismissing a
result is the same gesture as asking for the next item. No API change, no new dependency, no web
font, the 100 KB gzip budget and WCAG 2.2 AA still bind.

This is a restyle of existing files, not a new screen. The work is concentrated in four places:

1. **Tokens** — `tokens.css` is replaced by the measured color contract in
   `contracts/color-contract.md`, and a new unit test (`src/styles/contrast.test.ts`) asserts every
   pair against the *worst-case composited ground* on every run. That test is the feature's real
   deliverable: it is what stops the token table silently regressing (FR-013, SC-002).
2. **Surfaces** — one new component (`Sheet.tsx`) plus a ground/chrome split of the existing
   `Header.tsx`; `scanner/scanner.tsx` (a modal dialog) becomes `scanner/viewfinder.tsx` (the ground).
   The result sheet is deliberately **not** a `<dialog>`, because FR-026 needs the chrome reachable
   while a result is shown.
3. **Camera lifecycle** — `detect.ts#startScan` stops killing the stream on a decode and returns a
   `suspendFor`/`resume` handle; the App releases the stream on page hide, on cancel, and on leaving
   the flow. This is the amendment of 006 FR-009 that FR-011 authorises, and the 006 assertions that
   the stream stops on decode are **rewritten**, not deleted.
4. **Verification** — a live Chromium probe proved that axe-core goes *incomplete* (neither pass nor
   violation) for every text node on a sheet that overlaps a `<video>`, so the existing matrix would
   silently stop checking contrast the moment the camera is live. The plan closes that with the token
   test, a second axe pass with the video hidden, an `incomplete` guard, an explicit
   chrome-opacity assertion, and CDP emulation of `prefers-reduced-transparency` (verified working;
   Playwright 1.63 has no option for it).

## Technical Context

**Language/Version**: TypeScript 5.9 (strict), ESM; Node 24 for tooling

**Primary Dependencies**: unchanged and verified in the container — `preact` 10.29.8,
`barcode-detector` 3.2.2 (lazy); dev: `vite` 8.3.1, `vitest` 5.0.2, `jsdom` 29.1.1,
`@testing-library/preact` 3.2.4, `axe-core` 4.13.0, `@playwright/test` 1.63.0,
`@axe-core/playwright` 4.13.0. **No dependency is added** (FR-025).

**Storage**: unchanged — device `localStorage` (`settings:v1`, 50-entry `history:v1`)

**Testing**: Vitest (jsdom) units + axe + the new token-contrast test; Playwright + axe matrix in the
pinned `mcr.microsoft.com/playwright:v1.63.0-noble` image (Chromium 153); `check-size.mjs` budget.
All in Docker.

**Target Platform**: iOS Safari 16.4+, Chrome/Edge/Firefox (last 2), Samsung Internet. Consequences
verified from MDN BCD: `backdrop-filter` needs `-webkit-` below Safari 18;
`prefers-reduced-transparency` does not exist in Safari at all (Chrome 118+, Firefox behind a pref).

**Project Type**: web application — this feature touches only the `web/` package (plus two spec
contracts and CLAUDE.md)

**Performance Goals**: initial download ≤ 100 KB gzip (measured baseline today: **20.6 KB**; FR-028);
submit → verdict no slower than today on the same fixtures (SC-007); blur confined to the sheet and
never animated; decode loop unchanged at ≈ 8 fps

**Constraints**: WCAG 2.2 AA verified against the worst-case composite, in both schemes and
forced-colors; no API, request or response change (FR-023); no new external request; all copy from
`specs/006-web-client/contracts/ui-states.md`

**Scale/Scope**: one screen, 4 grounds × 2 sheet presentations; ~22 changed files in `web/`, 1 new
component, 2 new hooks, 2 new style/test files, 1 renamed scanner module; 2 spec contracts amended

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| Principle | Assessment | Status |
|---|---|---|
| **I. eBay Compliance** | No eBay surface is touched. The client still calls only our API, same-origin. Camera frames are decoded on-device and never leave it (FR-012); no new external request (FR-025); the e2e off-site guard still fails any test whose page leaves localhost. | ✅ PASS |
| **II. Latency First** | The lookup hot path is untouched (FR-023). Client budget: 20.6 KB today of 100 KB, enforced by `check-size.mjs`, which also fails if the decoder enters the initial chunk — the typed path still pays nothing for the camera (FR-009, SC-004). The sheet's rise animates `transform`/`opacity` only, and `backdrop-filter` is confined to the sheet. | ✅ PASS |
| **III. Cost Discipline** | No new external call. FR-010 (decoding suspended for the code that opened the sheet) removes a *new* way to double-charge a lookup that the always-live camera would otherwise create. A stale result is kept rather than aborted (research R13), so a lookup already counted against the cap is never thrown away. | ✅ PASS |
| **IV. Spec-Driven** | spec 008 → this plan → tasks. The one amendment to an earlier requirement (006 FR-009) is written into the spec (FR-011) and into the 006 contract as part of this feature (FR-021, `contracts/copy-additions.md`). | ✅ PASS |
| **V. Sandbox-First Testing** | Every command in `quickstart.md` is `docker compose run --rm …`. Version facts and contrast numbers in `research.md` were produced inside the containers, not on the host. | ✅ PASS |
| **VI. Money Is Integer Cents** | Cents end to end; the hero figure and rows format through `formatCents`/`describeProfit` at the display edge only. The loss case keeps the true minus sign *and* states the loss in words. | ✅ PASS |
| **VII. Extensible Verdict Pipeline** | Client-only change; the four pipeline steps and their boundaries are untouched. | ✅ PASS |
| **VIII. Accessible by Default (WCAG 2.2 AA)** | The gating principle here, and the reason for the verification design: meaning stays on label + icon + shape (FR-018); tokens are contrast-verified in *both* schemes against the worst-case composite, by a test rather than by hand (FR-013); every state keeps its focus target and announcement (FR-024); new states N1–N6 all enter the axe matrix in both schemes; 44 px targets, 320 px reflow and 400 % zoom are already asserted and extended; `incomplete` results are no longer allowed to hide a missing contrast check. Automated checks are explicitly not a substitute for the keyboard/screen-reader walkthrough in `quickstart.md` §3. | ✅ PASS |
| **Stack constraint** | Same stack: Preact + TypeScript + Vite in `web/`, hand-written CSS, Vitest + Playwright. No design-token pipeline, no animation library, no icon font. | ✅ PASS |
| **Valuation honesty** | Untouched and re-asserted in the new layout: the basis note is on every result, the raw asking median and realization rate are still never displayed, UNCERTAIN keeps its own identity with no donate/recycle wording and its figures behind a disclosure, no-market shows no zero figures, and the spec-007 sandbox badge and sentence survive in the chrome and in S6. | ✅ PASS |

**No constitution amendment is required.** No entry in Complexity Tracking.

**Post-Phase 1 re-check**: ✅ All pass. The design adds one component, two ~15-line hooks and one
test module; it removes the modal scanner dialog, so net component count is flat. The only new
*capability* is the always-live camera, whose cost (battery, recording indicator) the founder
accepted on 2026-09-26 and whose lookup-cost risk is closed by FR-010.

## Design

### Surfaces

**Narrow (< 1024 px)** — the sheet metaphor:

```text
<App>                                  state: ground, sheetView, overlay, desktop, settings, lookup
├─ skip link                           "Skip to lookup" → collapses the sheet, focuses the input
├─ <Viewfinder>  (lazy chunk)          the GROUND when scanning: <video> + reticle + status pill
│                                      …or a static tone div when not (no <video> in the DOM)
├─ <Header>      (restyled → chrome)   wordmark h1 · EnvBadge · Recent · Settings · Cancel
├─ <main id="main" class="layout">
│   └─ <div class="col-result">
│        └─ <Sheet presentation="bottom" view="resting|expanded">   (no aria-label*: ResultPanel keeps
│                                                                 its own labelled `.result` section)
│             NOTE: the lookup group is UNMOUNTED while expanded, so at this width S1 has no
│             Check button and no spinner — focus moves to the aria-busy loading region instead
│             resting:  S0 explainer (h2#result-heading) + THE LOOKUP GROUP
│             expanded: <ResultPanel>        loading | result | error
│               ├─ <VerdictBanner>           capsule (dot + label h2#result-heading) + reason + saved note
│               ├─ <MatchDetails>            item name (2-line clamp) + meta line
│               ├─ <MoneyBreakdown>          net figure + caption + hairline rows
│               └─ <BasisNote>
├─ <RecentList presentation="sheet">   modal <dialog class="sheet sheet--full">
├─ <SettingsDialog>                    unchanged modal, restyled
└─ <LiveRegion>                        unchanged polite + assertive regions
```

**Desktop (≥ 1024 px)** — today's three panes, restyled (FR-027, 006 US5). The only thing that moves
is the **lookup group**: `<Viewfinder presentation="card">` (while scanning) + the camera-unavailable
notice + `<LookupForm>` + the minimum-profit line. It sits in the resting sheet at narrow widths and
in `.col-lookup` here:

```text
├─ <Header>                            wordmark · EnvBadge · Settings · Cancel   (no Recent button)
└─ <main id="main" class="layout">
    ├─ <div class="col-lookup">        THE LOOKUP GROUP (viewfinder card on top while scanning)
    ├─ <div class="col-result">        <Sheet presentation="pane" view="expanded"> → <ResultPanel>
    └─ <div class="col-recent">        <RecentList presentation="pane"> → <section id="recent">
```

`<main id="main" class="layout">` and `.col-result` are always rendered; `.col-lookup` and
`.col-recent` only at ≥ 1024 px. One `use-media-query('(min-width: 1024px)')` value drives both the
column rendering and `RecentList`'s presentation. At ≥ 1024 px there is **no resting/expanded
distinction** (the sheet is always expanded), **no grabber, no history entry and no Escape listener**
(`presentation="pane"`), and **no dismissal control** — the primary button stays "Check another".
`#result-heading` exists at most once at any width: the S0 explainer is a shared component rendered by
`ResultPanel`'s idle branch at desktop and by the resting sheet at narrow widths, never both.

Two founder decisions of 2026-09-27 that follow from the re-parenting, both pinned in
`contracts/sheet-states.md`: **S1 is width-dependent** — below 1024 px the expanded sheet is skeleton
only (no Check button exists to carry a spinner, so focus moves to the `aria-busy` loading region),
while at ≥ 1024 px the form stays mounted in `.col-lookup` and 006's spinner-plus-`aria-disabled`
behaviour is unchanged. And **the draft query lives in App state**, reversing the plan's original
"accepted cost": the lookup group unmounts on every narrow-width collapse, not just a resize, so the
form was losing the user's text after every validation error — and one string in App also removes the
`pendingFormAction` race that could submit an empty query.

Full desktop tree, the seven pinned desktop rules, the state map, focus targets, announcements and the
per-state acceptance bar: [`contracts/sheet-states.md`](./contracts/sheet-states.md).

### Why the sheet is not a `<dialog>`

`showModal()` makes everything outside inert, which would make the chrome — and therefore Recent —
unreachable while a result is shown, breaking FR-026. So the sheet is an in-page surface with managed
focus, hand-wired `Escape`, and one `history.pushState` entry per expansion for the back gesture
(the pattern the 006 scanner already proved). Recent and Settings stay modal `<dialog>`s and keep
`use-modal.ts`'s focus trap, inertness and focus return for free.

### Accessibility verification (the gating risk)

| Requirement | How it is proved | Where |
|---|---|---|
| FR-013 / SC-002 worst-case token contrast | unit test parses `tokens.css`, composites the glass over black (light) / white (dark), asserts every pair in the contract | `web/src/styles/contrast.test.ts` + `contrast-contract.ts` |
| the same, on the real DOM | axe matrix runs twice in camera states: as rendered, and with the `<video>` hidden so axe can composite over the `#000` ground (verified: it then reports the contract's own pairs — axe prints 17.05 / 4.82 / 3.49 where the contract, which rounds instead of truncating, says 17.06 / 4.82 / 3.50 — and it catches a tint at body size) | `web/e2e/a11y.spec.ts` |
| contrast checks cannot silently disappear | no `color-contrast` entry allowed in axe's `incomplete` (measured failure mode: a `<video>` makes axe give up on every sheet text node) | `web/e2e/fixtures.ts` helper |
| FR-016 chrome has its own ground | computed `background-color` alpha = 1 for every chrome element | `web/e2e/a11y.spec.ts` |
| FR-019 opaque fallback | CDP `Emulation.setEmulatedMedia` `prefers-reduced-transparency: reduce` (verified working; no Playwright option exists) + a `@supports`-off path | `web/e2e/fixtures.ts` + `a11y.spec.ts` |
| FR-015 no tint below 24 px | axe catches it once contrast is computable (proved in the probe); the contract also records the rule | matrix |
| FR-018 / SC-006 grayscale + forced colors | distinct label + `data-icon` per verdict, UNCERTAIN capsule `border-style: dashed`, forced-colors axe runs on the new classes, **plus a forced-colors pair walk**: for every visible text node, assert its computed `color`/effective `background-color` pair is self-consistent (both system-forced, or both pinned to system keywords) and ≥ 4.5:1. axe does not police this — it stands down on colour contrast in forced-colors mode — and the mixed state is what shipped the `.chrome` 1.08:1 defect (contract rule 5). Note `forced-color-adjust` **inherits**: a container pinned with `none` disables forcing for every descendant, so the walk must cover descendants, not just the pinned surface | `web/e2e/a11y.spec.ts` |
| FR-020 reduced motion | existing "nothing animates > 1 ms under reduce" assertion, re-pointed at the sheet | `web/e2e/layout.spec.ts` |
| FR-005 / FR-006 reflow and focus | existing 320 px / 400 % zoom / "never covers a focused control" walks, extended to the sheet and to the keyboard-open state (N6) | `web/e2e/layout.spec.ts` |
| FR-010 / FR-011 / SC-003 one tap, two verdicts, one permission | a stubbed **native** `BarcodeDetector` installed via `addInitScript` feeds a queue of codes over the existing `fakeCamera` stream — no production test hook needed, because `detect.ts` already prefers a native detector; the test asserts two verdicts with only a dismissal between them and `getUserMedia` called exactly once (research R15) | `web/e2e/fixtures.ts` + `core.spec.ts` |
| SC-004 the typed path costs no camera | on a load where Scan is never tapped: zero `getUserMedia` calls, no `<video>` in the DOM, no decoder request (route-level assertion), and `check-size.mjs`'s decoder-free initial chunk | `web/e2e/core.spec.ts` + `npm test` |

**Where SC-001's dimensions actually live.** SC-001 asks for 0 violations "in both the unit suite and
the Playwright matrix", but jsdom has no layout, no media-query emulation and no computed-colour
resolution, so three of the four dimensions cannot exist there. The split is therefore fixed, and no
task should try to build a jsdom test for the right-hand column:

| Dimension | Unit suite (vitest + jsdom, `src/a11y.test.tsx`) | Playwright matrix (`web/e2e/a11y.spec.ts`) |
|---|---|---|
| every state reachable (S0–S15, N1–N6) | yes — one axe run per state | yes |
| axe rules that need no layout (roles, names, ARIA relationships, label-in-name, `aria-describedby`) | yes — this is what the unit suite proves | yes |
| light **and** dark scheme | no — jsdom does not evaluate `prefers-color-scheme` | **yes, both schemes** (`test.use({ colorScheme })`) |
| widths 320 / 390 / 1280 px | no — jsdom has no viewport | **yes, three projects** |
| forced-colors for result states | no | **yes** (`emulateMedia({ forcedColors: 'active' })`) |
| colour-contrast values, `incomplete` guard, target sizes, no-horizontal-scroll, focus visibility | no — all need real layout and computed colour | **yes**, plus the token test for the worst-case composite |

So SC-001 is satisfied jointly: the unit suite covers *state × semantics*, the matrix covers
*state × scheme × width × forced-colors × geometry*, and `src/styles/contrast.test.ts` covers the
composited colour maths that neither can see.

### File ownership map (for `/speckit-tasks` — disjoint sets)

**A. Tokens and the contrast gate** (no component logic)
- `web/src/styles/tokens.css` (rewrite to `contracts/color-contract.md`)
- `web/src/styles/contrast-contract.ts` *(new)*
- `web/src/styles/contrast.test.ts` *(new)*

**B. Sheet, ground and chrome shell**
- `web/src/components/Sheet.tsx` *(new: grabber, Escape, history entry, internal scroll)*
- `web/src/components/Header.tsx` (becomes the chrome bar: wordmark, badge, Recent, Settings, Cancel)
- `web/src/styles/sheet.css` *(new: ground, sheet, chrome, glass/opaque, reticle, pill)*
- `web/src/styles/layout.css` (drop the fixed `.scan-dock`; restyle the ≥ 1024 px three-pane grid)
- `web/src/styles/base.css` (font stack, focus rules, reduced-motion/transparency hooks)
- `web/index.html` (`interactive-widget=resizes-content`, new theme-colors)
- `web/vite.config.ts` (manifest `theme_color` / `background_color`)
- `web/src/main.tsx` (import `sheet.css`)

**C. Camera lifecycle**
- `web/src/scanner/detect.ts` (+ `ScanHandle` suspend/resume; abort remains the only release)
- `web/src/scanner/viewfinder.tsx` *(new; replaces `scanner.tsx`, which is deleted)*
- `web/src/scanner/viewfinder.test.tsx` *(rewritten from `scanner.test.tsx`)*
- `web/src/scanner/detect.test.ts`

**D. Result content**
- `web/src/components/ResultPanel.tsx`, `VerdictBanner.tsx`, `MoneyBreakdown.tsx`,
  `MatchDetails.tsx`, `BasisNote.tsx`, `Icon.tsx` (`data-icon`)
- `web/src/lib/verdict-copy.ts`, `web/src/lib/money.ts` (net caption helper)
- their `*.test.tsx`

**E. Resting sheet, Recent, settings, app wiring**
- `web/src/app.tsx` (ground / sheetView / overlay, camera release triggers, skip-link collapse)
- `web/src/components/LookupForm.tsx`, `CostField.tsx`, `RecentList.tsx`, `SettingsDialog.tsx`,
  `EnvBadge.tsx`
- `web/src/lib/use-media-query.ts` *(new)*, `web/src/lib/use-viewport-inset.ts` *(new)*
- `web/src/app.test.tsx`, `app.scanner.test.tsx`, `app.env.test.tsx`, `a11y.test.tsx`, component tests

**F. Component styling** (single owner to avoid CSS conflicts)
- `web/src/styles/app.css` (capsule, rows, recent rows, dialogs, buttons, pills)

**G. e2e**
- `web/e2e/fixtures.ts` (new helpers: `openRecent`, `withVideoHidden`, `emulateReducedTransparency`,
  `expectChromeOpaque`, `blackCamera`, `fakeDetector`)
- `web/e2e/a11y.spec.ts`, `core.spec.ts`, `errors.spec.ts`, `layout.spec.ts`, `env.spec.ts`,
  `offline.spec.ts`

**H. Contracts and docs**
- `specs/006-web-client/contracts/ui-states.md` (the additions and amendments in
  `contracts/copy-additions.md` — required by FR-021)
- `CLAUDE.md` (web-client paragraph: the sheet, the amended camera lifecycle, the contrast test)

**Untouched**: everything under `src/` (the API), `docker-compose*.yml`, `web/package.json`,
`web/scripts/check-size.mjs`, `web/playwright.config.ts`, `web/vitest.config.ts`, `.env*`.

### Ordering constraints

A must land before B/D/F (every style depends on the token names). C is independent of D. E depends
on B and C. G depends on B–F. H can land any time after the copy keys exist in D.

## Project Structure

### Documentation (this feature)

```text
specs/008-native-sheet-ui/
├── plan.md                    # this file
├── research.md                # R1–R16: decisions, measured ratios, verified platform facts
├── data-model.md              # view state, ScanHandle, the token model
├── quickstart.md              # how to run the gates and what to check by hand
├── contracts/
│   ├── color-contract.md      # normative token table + required ratios + measured values
│   ├── sheet-states.md        # S0–S15 + N1–N6: surface, focus target, announcement, acceptance
│   └── copy-additions.md      # exact strings to add to the 006 contract (FR-021)
├── checklists/                # from /speckit-specify
└── tasks.md                   # /speckit-tasks output (not created here)
```

### Source Code (repository root)

```text
web/
├── index.html                          # viewport interactive-widget, theme-color
├── vite.config.ts                      # PWA manifest colors
└── src/
    ├── main.tsx                        # + styles/sheet.css
    ├── app.tsx                         # ground / sheetView / overlay, camera release triggers
    ├── styles/
    │   ├── tokens.css                  # rewritten from contracts/color-contract.md
    │   ├── base.css                    # system font stack, focus, motion
    │   ├── sheet.css                   # NEW: ground, sheet, chrome, glass ↔ opaque
    │   ├── layout.css                  # breakpoints; three-pane desktop restyle
    │   ├── app.css                     # component skins
    │   ├── contrast-contract.ts        # NEW: the pair table as data
    │   └── contrast.test.ts            # NEW: the SC-002 gate
    ├── components/
    │   ├── Sheet.tsx                   # NEW: the sheet shell
    │   ├── Header.tsx                  # → chrome bar
    │   ├── ResultPanel.tsx  VerdictBanner.tsx  MoneyBreakdown.tsx  MatchDetails.tsx
    │   ├── LookupForm.tsx   CostField.tsx      RecentList.tsx      SettingsDialog.tsx
    │   └── EnvBadge.tsx     BasisNote.tsx      Icon.tsx            LiveRegion.tsx
    ├── lib/
    │   ├── verdict-copy.ts  money.ts   use-lookup.ts (unchanged)   use-modal.ts (unchanged)
    │   ├── use-media-query.ts          # NEW
    │   └── use-viewport-inset.ts       # NEW
    ├── scanner/
    │   ├── viewfinder.tsx              # NEW (replaces scanner.tsx)
    │   └── detect.ts                   # + ScanHandle
    └── e2e/ …                          # matrix + helpers (in web/e2e/)
```

**Structure Decision**: no new package and no new directory — the feature stays inside the existing
`web/` client, adding one component, one stylesheet, two hooks and one test module, and renaming the
scanner module to reflect that it is now the ground rather than a dialog.

## Complexity Tracking

> Not required — the Constitution Check has no violations.
