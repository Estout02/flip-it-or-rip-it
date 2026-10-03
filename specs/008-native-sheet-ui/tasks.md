# Tasks: Native Sheet UI (008)

**Input**: Design documents from `/specs/008-native-sheet-ui/`

**Prerequisites**: `plan.md`, `spec.md`, `research.md`, `data-model.md`,
`contracts/color-contract.md`, `contracts/sheet-states.md`, `contracts/copy-additions.md`,
`quickstart.md`

**Tests**: Test tasks are included and are **mandatory** here — spec 008's deliverable is partly the
new automated gates (FR-013/SC-002 token test, the axe `incomplete` guard, the amended camera
lifecycle assertions), and SC-008 forbids deleting a test to accommodate the redesign.

**Scope**: `web/` only, plus two spec contracts and `CLAUDE.md`. Nothing under `src/` (the API),
`docker-compose*.yml`, `web/package.json`, `web/scripts/check-size.mjs`, `web/playwright.config.ts`,
`web/vitest.config.ts` or `.env*` is touched (FR-023, FR-025).

**Organization**: phases group tasks by user story for traceability. **Execution order is the
`## Work Packages` table at the end of this file**, which the orchestrator dispatches in waves.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: can run in parallel (different files, no dependency on an incomplete task)
- **[Story]**: US1–US6 from `spec.md`
- Every task names its exact file paths.
- **T068 and T069 were appended after the `/speckit-analyze` pass** (the S0 non-regression test and
  the SC-007 latency gate). They sit in their phase position — end of Phase 3 and end of Phase 9 —
  so the file is ascending within each phase but not globally. Dispatch from the Work Packages table,
  which lists them against WP8 and WP10.

---

## Reference blocks (normative for every task below)

### R-A. Token migration map

`web/src/styles/tokens.css` is rewritten in T002. Every old 006 token name **disappears**; each
stylesheet owner migrates the references in the files it owns, using exactly this map. No other
substitution is permitted.

| 006 token (removed) | 008 replacement |
|---|---|
| `--bg` | `--ground-static` |
| `--surface` | `--sheet-opaque` |
| `--text` | `--ink` |
| `--text-muted` | `--secondary` |
| `--border-ui` | `--control-border` |
| `--border-subtle` | `--hairline` |
| `--btn-bg` | `--ink` |
| `--btn-fg` | `--sheet-opaque` |
| `--flip-fg` / `--flip-tint` | `--tint-flip` / `--caps-flip` |
| `--risky-fg` / `--risky-tint` | `--tint-risky` / `--caps-risky` |
| `--rip-fg` / `--rip-tint` | `--tint-rip` / `--caps-rip` |
| `--unc-fg` / `--unc-tint` | `--tint-unc` / `--caps-unc` |
| `--test-fg` / `--test-tint` / `--test-border` | `--chrome-fg` / `--chrome-bg` / `--control-border` |
| `--radius-lg` | `--radius-card` |
| `--dock-height` | deleted with `.scan-dock` |
| `--focus`, `--danger`, `--shadow`, `--radius-sm`, `--target`, `--space-1…8`, `--step--1…--step-4` | same names, values per T002 |

The neutral primary button (`Check`, `Try again`, dialog confirms — the buttons with no verdict) is
`background: var(--ink); color: var(--sheet-opaque)`. Measured: label 18.03:1 light / 16.43:1 dark;
button boundary against the worst-case sheet ground 17.06:1 / 13.69:1 (the same pair as L1/D1, so no
extra border is needed). Both are recorded as pair `NB1` in `contracts/color-contract.md` and mirrored
in `contrast-contract.ts` by T004.

### R-B. Class inventory

Markup packages emit exactly these names; CSS packages style exactly these names. Nothing else.

**Ground / chrome / sheet** (styled in `web/src/styles/sheet.css`, WP4):
`.ground`, `.ground--camera`, `.ground--static`, `.viewfinder__video`, `.viewfinder__reticle`,
`.pill`, `.ground--card` (the ≥ 1024 px viewfinder card), `.chrome`, `.wordmark`, `.wordmark__mark`, `.wordmark__text`, `.chrome__btn`, `.sheet`,
`.sheet--resting`, `.sheet--expanded`, `.sheet--pane` (the ≥ 1024 px variant), `.sheet--full`, `.sheet__grabber`, `.sheet__body`,
`.skip-link`, `.layout`, `.col-lookup`, `.col-result`, `.col-recent`.

**Content skins** (styled in `web/src/styles/app.css`, WP9):
`.result`, `.result__body`, `.capsule`, `.capsule--flip|--risky|--rip|--unc`, `.capsule__dot`,
`.capsule__icon`, `.capsule__label`, `.verdict__reason`, `.verdict__eyebrow`, `.verdict__saved`,
`.env-note`, `.env-badge`, `.env-badge__wide`, `.match`, `.match__title`, `.match__title--clamp`,
`.match__prefix`, `.match__name`, `.match__toggle`, `.match__meta`, `.facts`, `.facts__term`,
`.badge`, `.breakdown`, `.breakdown__note`, `.net`, `.net--loss`, `.net__figure`, `.net__caption`,
`.figures`, `.figures__row`, `.basis-note`, `.sandbox-note`, `.actions`, `.btn`, `.btn--primary`,
`.btn--ghost`, `.btn--scan`, `.btn-text`, `.link`, `.money`, `.suggestions`, `.suggestion`,
`.rough`, `.camera-notice`, `.empty`, `.empty__heading`, `.empty__body`, `.skeleton`,
`.skeleton__band`, `.skeleton__line`, `.skeleton__line--wide`, `.error-panel`,
`.error-panel__heading`, `.error-panel__icon`, `.threshold`, `.threshold__default`, `.field`,
`.cost`, `.chip`, `.chip--flip|--risky|--rip|--unc|--test`, `.recent`, `.recent__head`,
`.recent__title`, `.recent__list`, `.recent__empty`, `.recent__notice`, `.recent-item`,
`.recent-item__title`, `.recent-item__meta`, `.dialog`, `.dialog--small`, `.dialog__title`,
`.dialog__body`, `.dialog__actions`, `.icon`, `.icon--inline`, `.icon--chip`, `.icon--solid`,
`.visually-hidden`, `.result-enter`.

**Deleted** (no rule, no markup may reference them after WP9): `.scan-dock`, `.scanner`,
`.scanner--failed`, `.scanner__stage`, `.scanner__video`, `.scanner__frame`, `.scanner__bar`,
`.scanner__prompt`, `.scanner__cancel`, `.scanner__failed`, `.scanner__failed-icon`, `.verdict`,
`.verdict--flip|--risky|--rip|--unc`, `.verdict__icon`, `.verdict__text`, `.verdict__label`,
`.hero-profit`, `.hero-profit--loss`, `.figures__row--total`, `.card`, `.app-header`,
`.app-header--badged`, `.header__settings`, `.header__settings-text`.

**Stable ids (never renamed)**: `#main`, `#lookup-input`, `#lookup-error`, `#cost-input`,
`#cost-error`, `#result-heading`, `#result-saved-note`, `#result-env-note`, `#recent`,
`#recent-heading`, `#threshold-input`, `#threshold-error`, `#clear-title`.

### R-C. Expanded-sheet DOM order and CSS `order` map (FR-003)

`.result__body` is the flex column. DOM order is fixed by the reading-order constraint in
`contracts/sheet-states.md` ("Reading-order constraint"); visual order is restored with `order`.

| DOM position | element | `order` |
|---|---|---|
| 1 | `.verdict__saved` (optional) | 0 |
| 2 | `.env-note` (optional) | 0 |
| 3 | `.capsule` (contains `.capsule__dot`, `.capsule__icon`, `h2#result-heading.capsule__label`) | 1 |
| 4 | `.verdict__reason` | 5 |
| 5 | `.verdict__eyebrow` | 2 |
| 6 | `.match` | 3 |
| 7 | `.breakdown` or `.suggestions` | 4 |
| 8 | `.rough` / `.sandbox-note` | 6 |
| 9 | `.basis-note` | 7 |
| 10 | `.actions` | 8 |

So a screen reader that lands on `#result-heading` reads the reason next, while the eye reads
capsule → eyebrow → item name + meta → net figure + rows → reason → basis note → actions.
**The capsule contains only the dot, the icon and the ink label** — never `--secondary` text
(color-contract rule 1: `--secondary` on a light capsule measures 4.16–4.35:1 — under 4.5 on all four).

### R-D. Dismissal pair (research R11 / copy-additions §3) — pinned, no alternative

| `ground` | primary button | second control |
|---|---|---|
| `'camera'` (narrow only) | `Scan the next one` (`.btn.btn--primary`) → dismiss to the live viewfinder, decoding resumes | `Check another` (`.btn-text`) → collapse to rest, clear the input, focus it |
| `'static'` | `Check another` (`.btn.btn--primary`) → collapse to rest, clear the input, focus it | none (Escape and the back gesture still dismiss) |

**At ≥ 1024 px there is no dismissal at all** (desktop rule 6): the panes coexist, so `Scan the next one`
is a narrow-only control and the primary stays `Check another` even while the viewfinder card is live.
T034 achieves this by passing `ground="static"` at desktop. `suspendedCode` is cleared when the app
returns to the lookup-ready state — on sheet dismissal at narrow widths, and on `Check another` at both.

### R-E. Fixture arithmetic (already true in `web/src/test/fixtures.ts`; do not edit that file)

| fixture | `estimatedValueCents` | −fees | −shipping | `profitCents` | new rows |
|---|---|---|---|---|---|
| `flip` | 3120 | 413 | 500 | **2207** | `$31.20`, `−$4.13`, `−$5.00` → net `$22.07` |
| `flip` + cost 800 (`profitCents: 1407`) | 3120 | 413 | 500 | 1407 | adds `What you paid` `−$8.00` |
| `risky` | 12000 | 1590 | 500 | **9910** | net `$99.10` |
| `rip` | 1760 | 233 | 500 | **1027** | net `$10.27` |
| `uncertain` | 1200 | 159 | 500 | **541** | figures only inside the disclosure |
| `noMarket` | 0 | 0 | 500 | **−500** | no net figure, no rows |

The loss case is produced inline as `{ ...flip, profitCents: -320 }` → figure `−$3.20` (U+2212) and
caption `out of pocket — a loss`. **No new shared fixture is added**;
`web/src/test/fixtures.ts` is owned by WP8 and is expected to stay unchanged.

### R-G. Measured baselines and the submit→verdict recipe (SC-007, FR-028)

**Filled in by T001, read by T069.** T001 runs before any source change; the two figures below are
what the feature is later measured against. Do not guess them — if these slots are still blank, T069
is blocked.

| Baseline | Value (filled by T001) | Source of truth | Used by |
|---|---|---|---|
| initial download, gzip | `20.6 KB` | the `initial:` line printed by `check-size.mjs` | FR-028 |
| submit → verdict, median of 5 | `33.9 ms` | **`web/e2e/baseline.json`**, written by T001 | T069, SC-007 |

The **ms cell above is a human-readable mirror**: the gate reads `web/e2e/baseline.json`
(`{ "submitToVerdictMedianMs": <number>, "measuredOn": "<ISO date>", "commit": "<sha>" }`), because the
`e2e` service mounts only `./web` and therefore cannot read this file. T001 writes both; T069 imports
the JSON and fails if it is missing or not a positive finite number — there is no path where a blank
or stale baseline passes.

**Project**: `mobile-390`. Verified against `web/playwright.config.ts`, which defines exactly
`mobile-320`, `mobile-390` and `desktop-1280` — there is **no** `phone-390`, and naming a
non-existent project makes Playwright error out (T001) or skip everywhere (T069).

**The recipe** — used *identically* by T001 (pre-change) and T069 (post-change), so the two numbers
are comparable. `mockApi(page)` with zero added delay, so this measures the client render path only;
five cycles, each returning to the lookup-ready state via the visible `Check another` control; take
the **median**. Reuse the existing `web/e2e/fixtures.ts` exports (`mockApi`, `gotoApp`, `input`,
`resultHeading`, `QUERIES`, `LABELS`) rather than hand-rolling selectors.

**The fixture alternates, and that is load-bearing — do not "simplify" it to one fixture.** The exact
sequence is `flip, rip, flip, rip, flip`, i.e. queries `Chrono Trigger SNES` → `Common Paperback` →
… with expected labels `Flip it` → `Rip it` → … (`LABELS.flip` and `LABELS.rip`, verified distinct in
`web/e2e/fixtures.ts`). The reason: **pre-change, "Check another" does not reset the lookup.**
`checkAnother` in `web/src/app.tsx` (line ~58) calls only `formRef.current?.clear()` and never
`use-lookup`'s `reset()` (`web/src/lib/use-lookup.ts` line ~128), so `shown` never returns to
`{ status: 'idle' }` and the heading keeps displaying the **previous verdict label**. (008/T032 is what
wires `checkAnother` to `reset`, which is why the resting copy only appears post-change.) With one
fixed fixture the pre-change run would fail its precondition on cycle 1 — `Received: "Flip it"` where
`'Scan or type an item'` was expected — and a predicate of "heading text equals the label" would
already be true at ~0 ms, a false pass. Alternating makes both assertions valid on **both** sides of
the change without a second code path:

- **Per-cycle precondition**: the heading text does **not** equal *this* cycle's expected label. True
  pre-change (it holds the previous cycle's *different* label) and true post-change (it reads the
  resting copy).
- **Completion predicate**: heading text equals *this* cycle's expected label **and** the heading has
  focus. Because the previous cycle's label differs, a stale heading can no longer satisfy it.

Per cycle, with `name` walking the sequence and `label = LABELS[name]`:

```ts
// 1. Precondition, asserted every cycle: whatever the heading currently says, it is not what this
//    cycle is waiting for — so the completion predicate cannot already be true (no ~0 ms false pass).
await expect(resultHeading(page)).not.toHaveText(label);
// 2. Typing is not part of submit → verdict, so fill first — and without this the `required`
//    input would reject requestSubmit() and nothing would ever resolve.
await input(page).fill(QUERIES[name].query);
// 3. Measure entirely in-page: no Playwright polling latency in the number.
const ms = await page.evaluate(async (label) => {
  const el = document.querySelector('#lookup-input') as HTMLInputElement;
  const started = performance.now();
  const done = () => {
    const h = document.getElementById('result-heading');
    return !!h && h.textContent?.trim() === label && document.activeElement === h;
  };
  el.form!.requestSubmit();
  await new Promise<void>((resolve, reject) => {
    const obs = new MutationObserver(check);
    const onFocus = () => check();
    const timer = setTimeout(() => { stop(); reject(new Error('verdict never arrived')); }, 5000);
    function stop() { obs.disconnect(); document.removeEventListener('focusin', onFocus); clearTimeout(timer); }
    function check() { if (done()) { stop(); resolve(); } }
    obs.observe(document.body, { subtree: true, childList: true, characterData: true });
    // Focus moving to the heading is not a DOM mutation, so listen for it too.
    document.addEventListener('focusin', onFocus);
    check();
  });
  await new Promise(requestAnimationFrame);
  return performance.now() - started;
}, label);
// 4. Back to the lookup-ready state for the next cycle. The recipe only ever types, never scans,
//    so the ground stays static and this primary control is 'Check another' at both widths and on
//    both sides of the change (R-D).
await page.getByRole('button', { name: 'Check another' }).click();
```

A predicate of merely "`#result-heading` exists" would be satisfied by the first unrelated mutation and
report ≈ 0 ms; and post-change `#result-heading` also exists in the resting state carrying
`'Scan or type an item'` (T032), so existence alone is meaningless there too. Requiring *this* cycle's
label plus focus is what makes the measurement honest.

The median is taken over the mixed sequence rather than one fixture. That is fine for a regression
gate because **the same mix runs on both sides**: `rip` renders slightly more than `flip` (it carries
the MEDIUM match badge), and that difference is present in the baseline and in the gate alike, so it
cancels in the comparison. Do not swap in `uncertain` or `noMarket` — their branches render a different
shape (no money rows, a disclosure), which would make the mix less representative of the normal path.

**Tolerance (pinned)**: `median <= Math.max(baselineMs * 1.25, 150)` — 25 % of slack over the recorded
baseline, with a 150 ms floor so a very fast baseline cannot make the gate flaky, plus a hard ceiling
of 400 ms for the slowest of the five cycles. A red result is a real finding (an animated
`backdrop-filter`, a layout thrash from the sheet, a synchronous measure in the decode path); it is
never fixed by widening the tolerance.

### R-F. Intentionally-red window (do not "fix" it out of turn)

Because markup moves before its stylesheet and before the App rewires it, the *full* unit suite is
expected red between the end of wave 2 and the end of wave 4:

- `web/src/app.scanner.test.tsx` (`.scan-dock` assertion) — repaired by T035.
- `web/src/components/ResultPanel.test.tsx` — repaired by T030.
- `web/src/app.test.tsx`, `web/src/a11y.test.tsx`, `web/src/app.env.test.tsx` — repaired by
  T036/T041/T061.

Each package therefore verifies with the **narrow** command in its Work Package row. The first
full-suite gate is WP8; the first e2e gate is WP10. No package may edit a file it does not own to
make its own verify pass.

---

## Phase 1: Setup

- [X] T001 Record both pre-change baselines into the **R-G** table in this file (`specs/008-native-sheet-ui/tasks.md`) — this is a gate, not a formality: if either measurement cannot be taken, or the suites are already red, stop and report instead of starting T002. (a) Run `docker compose run --rm --no-deps web sh -c "npm test && npm run typecheck"` and write down the `initial:` gzip figure printed by `web/scripts/check-size.mjs` (expected ≈ **20.6 KB** of the 100 KB budget, FR-028). (b) Measure submit → verdict on the **current** client with the R-G recipe, including its **alternating `flip, rip, flip, rip, flip` sequence** — that alternation is what makes the recipe run on the pre-008 client at all: today's `checkAnother` never calls `use-lookup`'s `reset()`, so after "Check another" the heading still shows the previous verdict label, and a single-fixture recipe would fail its cycle-1 precondition and admit a ~0 ms false pass. Do not switch to one fixture, a single cycle, or `page.reload()` between cycles: a median of one has no variance to reason about, and reloading would make this baseline measure a colder path than T069's gate, destroying the like-for-like comparison R-G exists to guarantee. Create a throwaway `web/e2e/baseline.spec.ts` containing only that recipe (importing `mockApi`, `gotoApp`, `input`, `resultHeading`, `QUERIES` and `LABELS` from `web/e2e/fixtures.ts`) and run it with `docker compose --profile e2e run --rm e2e sh -c "npm ci && npx playwright test baseline.spec.ts --project=mobile-390 --reporter=line"` — the `sh -c "npm ci && …"` prefix is **required**: overriding the service command skips the compose file's own `npm ci`, and the `e2e` service is the bare Playwright image with an *empty* anonymous volume at `/app/web/node_modules`, so `npx playwright test` alone cannot resolve `@playwright/test`. Then write the median into **two** places: `web/e2e/baseline.json` as `{ "submitToVerdictMedianMs": <number>, "measuredOn": "<ISO date>", "commit": "<sha>" }` (this is what T069 reads) and the R-G mirror cell. Finally **delete `web/e2e/baseline.spec.ts` unconditionally, in this task, before reporting** — confirm with `test ! -f web/e2e/baseline.spec.ts`; it must never be committed. `web/e2e/baseline.json` **is** committed and is the only file this task leaves behind under `web/e2e/` (WP10 owns that directory from wave 6 and only reads the JSON, so there is no conflict). No other file changes.

---

## Phase 2: Foundational (blocking prerequisites)

**Purpose**: the token contract plus its automated gate, and every new copy key. Nothing downstream
may invent a token name or a user-facing string.

**⚠️ CRITICAL**: no user-story work starts until T002–T010 are done.

- [X] T002 Rewrite `web/src/styles/tokens.css` `:root` and `@media (prefers-color-scheme: dark)` blocks from `specs/008-native-sheet-ui/data-model.md` §4. Exact light values: `--sheet-glass: rgba(250,250,251,.95)`, `--sheet-blur: blur(26px) saturate(1.5)`, `--sheet-opaque: #f4f4f7`, `--ground-static: #e7e7ec`, `--viewfinder-bg: #000000`, `--chrome-bg: #1c1c1e`, `--chrome-fg: #f5f5f7`, `--chrome-secondary: #a0a6b0`, `--chrome-focus: #8ab4ff`, `--ink: #0a0a0b`, `--secondary: #636872`, `--hairline: rgba(10,10,11,.12)`, `--control-border: #6b717a`, `--focus: #1d4ed8`, `--danger: #b42318`, `--tint-flip: #0e8f6e`, `--tint-risky: #b07000`, `--tint-rip: #5f6672`, `--tint-unc: #4a4fbf`, `--fill-flip: #0c7f62`, `--fill-risky: #965f00`, `--fill-rip: #5f6672`, `--fill-unc: #4a4fbf`, `--fill-label: #ffffff`, `--caps-flip: #d4e6e4`, `--caps-risky: #eae2d4`, `--caps-rip: #dfe0e4`, `--caps-unc: #dcddef`. Dark overrides: `--sheet-glass: rgba(28,28,30,.95)`, `--sheet-opaque: #17171a`, `--ground-static: #101012`, `--ink: #f5f5f7`, `--secondary: #a0a6b0`, `--hairline: rgba(245,245,247,.14)`, `--control-border: #8a9099`, `--focus: #8ab4ff`, `--danger: #ff8a7a`, `--tint-flip: #38d39b`, `--tint-risky: #f0b357`, `--tint-rip: #a9b0bd`, `--tint-unc: #9ea4f5`, `--fill-flip: #08503c`, `--fill-risky: #5e3c00`, `--fill-rip: #383d45`, `--fill-unc: #343a96`, `--fill-label: #f5f5f7`, `--caps-flip: #1d3931`, `--caps-risky: #3e3325`, `--caps-rip: #313337`, `--caps-unc: #2f3041`, `--shadow: 0 1px 2px rgb(0 0 0 / .4)`. The four `--chrome-*` tokens (`--chrome-bg`, `--chrome-fg`, `--chrome-secondary`, `--chrome-focus`) and `--viewfinder-bg` are declared **once** in `:root` and MUST NOT be redeclared in the dark block (FR-016) — which is exactly why T005's existence check is scoped to scheme-specific pairs. Shape/type: `--radius-sheet: 22px`, `--radius-card: 16px`, `--radius-pill: 999px`, `--radius-sm: 10px`, `--target: 44px`, `--sheet-shadow: 0 -1px 0 var(--hairline), 0 -12px 32px rgb(0 0 0 / .18)`, `--font: -apple-system, BlinkMacSystemFont, 'SF Pro Text', 'Helvetica Neue', system-ui, sans-serif`, `--text-name: 1.3125rem`, `--text-net: 2.375rem`, `--kb-inset: 0px`; keep `--shadow`, `--space-1…--space-8` and `--step--1…--step-4` at their current values. Delete every 006 token named in R-A's left column. Replace the file's header comment with a pointer to `specs/008-native-sheet-ui/contracts/color-contract.md` and the note that `src/styles/contrast.test.ts` asserts it.
- [X] T003 Re-point the `@media (forced-colors: active)` block in `web/src/styles/tokens.css` at the new class names (FR-018, R14): `.capsule, .chip, .btn, .sheet, .figures__row, .pill, .chrome__btn { border: 2px solid CanvasText; }`, `.capsule--unc { border-style: dashed; }`, keep the `.icon` / `.icon--solid` fill rules, keep `:focus-visible { outline-color: Highlight; }`, and keep the `:root .btn, :root .btn--primary` ButtonFace/ButtonText/`forced-color-adjust: none` rule. Remove the `.verdict`, `.verdict--unc` and `.card` selectors.
- [X] T004 Create `web/src/styles/contrast-contract.ts` — the normative table as data (data-model §5). Export: `type Need = 4.5 | 3`; `type GroundRef = { kind: 'worst' } | { kind: 'opaque' } | { kind: 'chrome' } | { kind: 'capsule'; treatment: Treatment } | { kind: 'token'; name: string }`; `type Pair = { id: string; fg: string; on: GroundRef; need: Need; scheme?: 'light' | 'dark'; decorative?: boolean; note?: string }`; `const SCHEMES = ['light','dark'] as const`; `const GROUND_COMPOSITE = { light: { glass: '--sheet-glass', over: '#000000' }, dark: { glass: '--sheet-glass', over: '#FFFFFF' } } as const`; `const CAPSULE_ALPHA = { light: 0.14, dark: 0.18 } as const`; `const PAIRS: Pair[]`. `PAIRS` has **60 entries** covering the contract's 61 rows: L1–L30 (`scheme: 'light'`), D1–D25 (`scheme: 'dark'`), C1–C4 (no `scheme` — the chrome tokens are scheme-independent, so they are asserted once), plus one scheme-independent `NB1` entry covering both of its rows: `{ id: 'NB1', fg: '--sheet-opaque', on: { kind: 'token', name: '--ink' }, need: 4.5, note: 'neutral primary button label' }` (both schemes). Mark `L30` and `C4` `decorative: true` with the contract's note. Copy each row's "Used for" text into `note`.
- [X] T005 Create `web/src/styles/contrast.test.ts` — the SC-002 gate (research R5). It reads `web/src/styles/tokens.css` from disk with `node:fs`, brace-matches the `:root { … }` block and the `@media (prefers-color-scheme: dark)` block, parses `--name: value;` pairs, and reads `#rgb`/`#rrggbb`/`rgba(r,g,b,a)` values — **no CSS-parser dependency** (FR-025). Compositing rule, pinned: composite in floating point, then `Math.round` each channel to an integer 0–255 **before** computing relative luminance; this reproduces the contract's documented grounds and values. Token-resolution rule, pinned: build the light map from `:root` alone, and the **dark map as `:root` merged with the dark block's overrides** (dark wins) — exactly how the cascade behaves. This is what lets the scheme-independent pairs resolve in both schemes even though `--chrome-bg`, `--chrome-fg`, `--chrome-secondary`, `--chrome-focus` and `--viewfinder-bg` are declared only in `:root` (T002, FR-016); resolving dark from the dark block alone would make them undefined and the chrome and `NB1` pairs unresolvable. Cases: (1) `each non-decorative pair meets its requirement` — one assertion per pair per applicable scheme, asserting `ratio >= need` only (never equality), failing with `"{id} {fg} on {ground} ({scheme}): {measured} < {need}"`; (2) `the worst-case grounds are the documented composites` — light `--sheet-glass` over `#000000` rounds to `#EEEEEE`, dark over `#FFFFFF` rounds to `#272729`; (3) `every --caps-* equals its tint composited at the scheme alpha over --sheet-opaque` — light 14 %: `#D4E6E4`, `#EAE2D4`, `#DFE0E4`, `#DCDDEF`; dark 18 %: `#1D3931`, `#3E3325`, `#313337`, `#2F3041`; (4) `every token named in a scheme-specific pair exists in both blocks` — the check iterates **only** the pairs carrying an explicit `scheme` (the `L*` and `D*` rows): a scheme-specific token present in `:root` but missing from the dark block fails, so a rename cannot silently drop out of the check. The scheme-independent pairs (`C1`–`C4`, `NB1`) are asserted to exist in `:root` **only** — T002 deliberately declares `--chrome-bg`, `--chrome-fg`, `--chrome-secondary`, `--chrome-focus` and `--viewfinder-bg` once and never in the dark block (FR-016), so requiring them in both would fail this package's own verify; (5) `parser anchors` — eight documented ratios within ±0.02, guarding that the right block was parsed: L1 `--ink`/worst **17.06**, L3 `--secondary`/worst **4.82**, L5 `--tint-flip`/worst **3.50**, L6 `--tint-risky`/worst **3.51**, L21 `--tint-flip`/`caps-flip` **3.14**, D1 `--ink`/worst **13.69**, D23 `--focus`/worst **7.14**, C1 `--chrome-fg`/chrome **15.63**. (Every anchor is quoted verbatim from the re-derived `contracts/color-contract.md`, whose 61 rows were verified against the computation under this same rounding rule — D23, for instance, computes to 7.1375. Always quote the contract cell; never a figure taken before rounding.) A red assertion is never fixed by lowering `need` or widening an anchor — fix the token.
- [X] T006 **Verify, do not edit**, `specs/008-native-sheet-ui/contracts/color-contract.md` — it is the planner's file and is already correct: all 61 rows were re-derived in-container under the same rounding rule T005 pins and checked against the computation programmatically (61/61 match), including L6 = **3.51** (0.51 of headroom — do not lighten `--tint-risky`) and the `NB1` neutral-primary-button rows (light **18.03**, dark **16.43**, boundary = L1/D1 at **17.06** / **13.69**, so no extra border is needed). WP1's job here is the cross-check: confirm the row accounting between the contract and `web/src/styles/contrast-contract.ts` — the contract has **61 rows** (L1–L30 = 30, D1–D25 = 25, C1–C4 = 4, and `NB1` listed **once per scheme** = 2), which `PAIRS` expresses as **60 entries** (the single scheme-independent `NB1` entry covers both of its rows) and `contrast.test.ts` turns into **59 assertions** (L30 and C4 are `decorative`, C1–C3 are asserted once, `NB1` twice) — that `web/src/styles/contrast.test.ts` reports every non-decorative pair passing, and that the eight anchors in T005 case (5) equal the corresponding contract cells. If any cell disagrees with the parser's output, **stop and report the discrepancy** — do not edit the contract, and do not adjust a `need`, an anchor or a token to paper over a mismatch.
- [X] T007 [P] Add the new copy keys to `web/src/lib/verdict-copy.ts`, verbatim from `specs/008-native-sheet-ui/contracts/copy-additions.md` §1: `export const NET_CAPTION_PROFIT = 'in your pocket';`, `export const NET_CAPTION_LOSS = 'out of pocket — a loss';` (em dash U+2014), `export function netCaption(profitCents: number): string` returning the profit caption for `>= 0` and the loss caption for `< 0`, `export const DISMISS_SCAN_NEXT = 'Scan the next one';`, `export const MONEY_ROWS = { value: 'Sells for', fees: 'eBay fees', shipping: 'Shipping', cost: 'What you paid' } as const;`. Extend `SCANNER_COPY` with `found: (code: string) => \`Barcode found · ${code}\`` (separator `·` U+00B7 with a space either side) and `noCamera: 'No camera was found. Type the number under the barcode instead.'` — copied verbatim **out of** the local `NO_CAMERA` constant in `web/src/scanner/scanner.tsx`, which WP2 only reads: that file is not WP2's to edit and is deleted later by T033 (WP8). `prompt`, `unavailableHeading`, `denied`, `unsupported`, `typeInstead` and `cancel` are unchanged. Do not touch `web/src/lib/money.ts` — `formatCents` and `describeProfit` stay exactly as they are (`describeProfit` is still used by the Recent list).
- [X] T008 [P] Apply `specs/008-native-sheet-ui/contracts/copy-additions.md` to `specs/006-web-client/contracts/ui-states.md` (FR-021 — this must land with or before the components that consume the strings). §2 replacements, verbatim: rewrite the "Hero number"/"Breakdown" bullets of **S2/S3/S4** (line ~39–42) with the net-figure + caption + four-row description and the explicit "There is no separate 'Profit' row"; rewrite **S8**'s second line (line ~78) as the button version; rewrite **S15**'s "full-screen modal `<dialog>`" description with the viewfinder-as-ground paragraph. Add the **Sheet (spec 008)** paragraph to the `## Global` section. Add the §3 dismissal-pair table under S2's actions. Mark each edited block with a trailing `(008)` marker so a reader can see which spec amended it. Existing wording elsewhere is untouched (FR-022).
- [X] T009 [P] Extend `web/src/lib/verdict-copy.test.ts` for the new keys: `netCaption(0)` and `netCaption(2207)` → `'in your pocket'`; `netCaption(-320)` → `'out of pocket — a loss'`; `MONEY_ROWS` deep-equals `{ value: 'Sells for', fees: 'eBay fees', shipping: 'Shipping', cost: 'What you paid' }`; `SCANNER_COPY.found('9780345391803')` → `'Barcode found · 9780345391803'`; `DISMISS_SCAN_NEXT` → `'Scan the next one'`; `SCANNER_COPY.noCamera` → the exact sentence. Keep every existing case.
- [X] T010 [P] Add `data-icon={name}` to the `<svg>` rendered by `web/src/components/Icon.tsx` (research R14 — the e2e matrix reads a name, not a path) and assert nothing else changes: the `PATHS` table, `class`, `aria-hidden` and `focusable` handling stay as they are.

**Checkpoint**: `docker compose run --rm --no-deps web sh -c "npx vitest run src/styles/contrast.test.ts src/lib/verdict-copy.test.ts && npm run typecheck"` is green; the token table can no longer regress silently.

---

## Phase 3: User Story 1 — Scan, read, dismiss, scan again (P1) 🎯 MVP

**Goal**: one Scan tap, then dismiss-and-scan: the camera owns the screen, the verdict rises as a
sheet over it, dismissal returns to a viewfinder that is already decoding.

**Independent Test**: with a stubbed native `BarcodeDetector` feeding two codes over a fake camera
stream, one Scan tap produces two verdicts with nothing between them but a dismissal, and
`getUserMedia` is called exactly once.

### Camera lifecycle (amends 006 FR-009 — rewrites, not deletions)

- [X] T011 [US1] Rewrite the decode loop in `web/src/scanner/detect.ts` so `startScan(video, onCode, signal, makeDetector?)` resolves `Promise<ScanHandle>` where `ScanHandle = { suspendFor(code: string): void; resume(): void }`. Remove the stop-on-decode branch: on an accepted decode it now calls `onCode(value)` and **leaves the stream live**; `signal.abort()` stays the only release (stops every track, clears `video.srcObject`). State: `last` (the existing same-value-twice debounce), `suppressed: string | null`, `pendingClear: boolean`. `suspendFor(code)` sets `suppressed = code` and `last = code`. `resume()` sets `pendingClear = true`; the next tick whose read value differs from `suppressed` (including a frame with no code) clears `suppressed` and `pendingClear` — so the suppressed code must leave the frame before it can fire again (FR-010). A **different** code decoded while suspended emits normally (`contracts/sheet-states.md` behaviour 3). `FORMATS`, `FRAME_INTERVAL_MS = 125`, `createDetector`'s native-then-ponyfill order, `locateFile`, `wasmUrl`, `classifyMediaError` and `ScanError` are unchanged.
- [X] T012 [US1] Update `web/src/scanner/detect.test.ts`. Keep unchanged: `locateFile` points at the bundled asset, the wasm sha256, every `classifyMediaError` case, `missing mediaDevices → unsupported`, `permission denied → denied`. **Rewrite** `accepts after two identical consecutive reads and stops every track` → `emits after two identical consecutive reads and keeps the stream live`: `onCode` called once with `'9780345391803'`, `stream.getTracks()[0].readyState === 'live'`, `video.srcObject === stream` (this is the FR-011 amendment of 006 FR-009 — the assertion moves, it is not dropped). Keep `abort stops the camera` (all tracks `'ended'`, `video.srcObject === null`). Add: (a) `suspendFor('9780345391803')` then two more identical frames → `onCode` still called once; (b) a different code `'9780000000002'` read twice while suspended → `onCode` called with it; (c) after `resume()`, two more `'9780345391803'` frames still do **not** emit; (d) after `resume()` plus one frame with no code, two `'9780345391803'` frames emit a second time.
- [X] T013 [US1] Create `web/src/scanner/viewfinder.tsx` — the ground, not a dialog. Props, pinned: `{ onCode(code: string): void; onFailure(reason: ScanFailure): void; suspendedCode: string | null; lastCode?: string | null; presentation?: 'ground' | 'card' }`. Renders `<div class={presentation === 'card' ? 'ground ground--camera ground--card' : 'ground ground--camera'}>` containing `<video class="viewfinder__video" playsInline muted autoPlay aria-hidden="true" />`, `<div class="viewfinder__reticle" aria-hidden="true" />` and `<p class="pill">{lastCode ? SCANNER_COPY.found(lastCode) : SCANNER_COPY.prompt}</p>`. No `<dialog>`, no `showModal`, no `history` entry, no focus management, and **no failure UI** (the "Camera not available" notice lives in the resting sheet — T034). On mount: create an `AbortController`, call `startScan`, keep the `ScanHandle` in a ref; on `startScan` rejection call `onFailure(err instanceof ScanError ? err.reason : 'unsupported')` unless the signal already aborted. An effect on `suspendedCode` calls `handle.suspendFor(code)` when it is non-null and `handle.resume()` when it becomes null. On unmount: `abort()` — that is the only release path, and the App releases the camera by unmounting this component (data-model §1). Delete nothing yet: `web/src/scanner/scanner.tsx` stays until T033.
- [X] T014 [US1] Create `web/src/scanner/viewfinder.test.tsx`, carrying the equivalents of every case in `web/src/scanner/scanner.test.tsx` plus the new lifecycle (SC-008). Harness: fake `navigator.mediaDevices.getUserMedia` returning a stub `MediaStream` whose tracks record `stop()`, plus an injected detector via the `makeDetector` seam or a stubbed global `BarcodeDetector` reporting `ean_13`. Cases: (1) renders the video (`aria-hidden="true"`, `playsinline`, `muted`), the reticle and the pill reading `'Point at a barcode'`, and there is **no** `<dialog>` in the container; (2) with `lastCode="9780345391803"` the pill reads `'Barcode found · 9780345391803'`; (3) two identical decoded frames call `onCode` once **and the tracks stay `'live'` with `video.srcObject` still set** (this replaces scanner.test.tsx's "a detected code closes the dialog", per FR-011); (4) unmount ends every track and sets `video.srcObject` to `null`; (5) setting `suspendedCode` to the decoded value suppresses further identical frames, and clearing it back to `null` plus one code-free frame lets the same code fire again; (6) a `getUserMedia` rejection with `NotAllowedError` calls `onFailure('denied')` and renders no `<video>`.

### The sheet, the chrome and the structural styles

- [X] T015 [US1] Create `web/src/components/Sheet.tsx`. Props, pinned: `{ view: 'resting' | 'expanded'; onDismiss(): void; presentation?: 'bottom' | 'pane'; labelledBy?: string; label?: string; children: ComponentChildren }` — `presentation` defaults to `'bottom'`. Renders `<section class>` (`sheet` plus `sheet--expanded`/`sheet--resting`, plus `sheet--pane` when `presentation === 'pane'`) with `<div class="sheet__grabber" aria-hidden="true" />` then `<div class="sheet__body">{children}</div>`. **`presentation: 'pane'` (≥ 1024 px, desktop rule 2) renders no grabber, pushes no history entry and installs no Escape listener** — without that, a desktop page load would push a `flipSheet` entry the user can never step back out of, and Escape would appear to do nothing. `labelledBy`/`label` remain available but the **result sheet passes neither**: the labelled region stays inside `ResultPanel` (desktop rule 7, T028), so `.sheet` carries no `aria-labelledby` and no `aria-label`. The Recent `<dialog class="sheet sheet--full">` keeps its own labelling, as today. **Not** a `<dialog>` and never `inert` — FR-026 needs the chrome reachable. Behaviour (research R1/R2, following the `popped` pattern already proven in `web/src/scanner/scanner.tsx`): on `view` becoming `'expanded'`, `history.pushState({ flipSheet: true }, '')` — exactly one entry per expansion; a `popstate` while expanded calls `onDismiss()` and sets a `popped` ref so no `history.back()` follows; on `view` returning to `'resting'` without a pop, call `history.back()` if `(history.state as { flipSheet?: boolean } | null)?.flipSheet` is set. A `keydown` listener on `document`, active only while expanded, calls `onDismiss()` on `Escape` — and returns early when `document.querySelector('dialog[open]')` exists, so Recent and Settings keep their own Escape. Drag is **not** implemented (FR-004 allows this; the grabber is decorative).
- [X] T016 [US1] Create `web/src/components/Sheet.test.tsx`. Cases: (1) `view="resting"` renders `class="sheet sheet--resting"` and calls no `history.pushState`; (2) rerendering with `view="expanded"` pushes exactly one entry and `history.state.flipSheet === true`; (3) `Escape` while expanded calls `onDismiss` once; while resting it does not; (4) `Escape` is ignored while an open `<dialog>` is in the document; (5) a `popstate` while expanded calls `onDismiss` and `history.back` is not called; (6) collapsing back to `'resting'` after an expansion calls `history.back()` exactly once; (7) `.sheet__grabber` has `aria-hidden="true"` and is not focusable (`tabIndex` unset, not a button); (8) `presentation="pane"` renders `.sheet--pane` with **no** `.sheet__grabber`, pushes no history entry on mount or on `view` changes, and ignores `Escape` (no `onDismiss` call); (9) in both presentations the `<section>` has neither `aria-labelledby` nor `aria-label` when those props are omitted.
- [X] T017 [US1] Rewrite `web/src/components/Header.tsx` as the chrome bar (`contracts/sheet-states.md` "Document structure"). Props: `{ onOpenSettings(e: Event): void; settingsButtonRef?: Ref<HTMLButtonElement>; ebayEnv?: string; onOpenRecent?(e: Event): void; recentButtonRef?: Ref<HTMLButtonElement>; onCancelCamera?(): void; cancelButtonRef?: Ref<HTMLButtonElement> }` — the three new props are **optional** so `web/src/app.tsx` keeps type-checking until T034 passes them. Renders `<header class="chrome">` with the existing `<h1 class="wordmark">` (same inline SVG, same `.wordmark__text` "Flip it or Rip it"), `<EnvBadge env={ebayEnv} />` (pass no new prop), then, in this order: `<button type="button" class="chrome__btn" aria-haspopup="dialog" ref={recentButtonRef} onClick={onOpenRecent}>Recent</button>` rendered only when `onOpenRecent` is given; the Settings button (`class="chrome__btn"`, `aria-haspopup="dialog"`, `<Icon name="settings" />` + visible text `Settings`); and `<button type="button" class="chrome__btn" ref={cancelButtonRef} onClick={onCancelCamera}>{SCANNER_COPY.cancel}</button>` rendered only when `onCancelCamera` is given. Drop the `app-header`, `app-header--badged`, `header__settings` and `header__settings-text` classes and the `isTestEnv` import used only for the badged class.
- [X] T018 [US1] Create `web/src/styles/sheet.css` (research R4, R7, R8; imported by T021). Contents: `.ground` fills the viewport behind everything (`position: fixed; inset: 0; background: var(--ground-static)`), `.ground--camera { background: var(--viewfinder-bg); }` with `.viewfinder__video { inline-size: 100%; block-size: 100%; object-fit: cover; }`; `.viewfinder__reticle` as four corner brackets drawn with borders + `--radius-card`; `.pill` an opaque `--chrome-bg` / `--chrome-fg` pill (`--radius-pill`, min 44 px block size, centred above the sheet). `.chrome` is `position: fixed; inset-block-start: 0` with `background: var(--chrome-bg); color: var(--chrome-fg)` — **alpha 1, never translucent** (FR-016) — and `.chrome__btn` uses `--chrome-fg` with a `--chrome-focus` focus ring and a ≥ 44 px target. `.sheet`: `position: fixed; inset-inline: 0; inset-block-end: 0; border-start-start-radius: var(--radius-sheet); border-start-end-radius: var(--radius-sheet); box-shadow: var(--sheet-shadow); background: var(--sheet-opaque);` (opaque is the **default**), `max-block-size: calc(100dvh - var(--kb-inset)); overflow-y: auto; overscroll-behavior: contain; padding-block-end: max(env(safe-area-inset-bottom, 0px), var(--kb-inset));` plus `html { scroll-padding-block-end: … }` to match. The glass is opt-in exactly as in R4: `@supports ((backdrop-filter: blur(1px)) or (-webkit-backdrop-filter: blur(1px))) { @media (prefers-reduced-transparency: no-preference) { .sheet { background: var(--sheet-glass); -webkit-backdrop-filter: var(--sheet-blur); backdrop-filter: var(--sheet-blur); } } }` — the `-webkit-` declaration comes first (Safari < 18). `.sheet--resting` sits at its content height; `.sheet--expanded` may grow to the full height; `.sheet--full` (the Recent dialog) is full height with the same radius. The rise is one `transition: transform 220ms cubic-bezier(.32,.72,0,1), opacity 220ms …` inside `@media (prefers-reduced-motion: no-preference)` — `transform`/`opacity` only, and `backdrop-filter` is never animated (FR-020, constitution II). `.sheet__grabber` is a 36 × 4 px `--hairline` bar. No colour literal appears in this file; every value is a token.
- [X] T019 [US1] Update `web/src/styles/base.css`: `font-family: var(--font)` on `body` (the new system stack, FR-017); page background `var(--ground-static)` and text `var(--ink)`; `:focus-visible` outline `var(--focus)` with `.chrome :focus-visible`, `.ground :focus-visible` and `.pill :focus-visible` using `var(--chrome-focus)` (FR-016); keep the existing `prefers-reduced-motion: reduce` neutralisation (it is what `web/e2e/layout.spec.ts` asserts) and keep `.visually-hidden`, `.skip-link` and the 44 px control minimums; migrate every old token reference per R-A. Add no new colour literal.
- [X] T020 [US1] Update `web/index.html` and `web/vite.config.ts`. `index.html`: viewport becomes `width=device-width, initial-scale=1, viewport-fit=cover, interactive-widget=resizes-content` (research R8); replace the two `theme-color` media variants with a single `<meta name="theme-color" content="#1C1C1E" />` (the chrome bar owns the top of the screen in both schemes); keep `color-scheme`, the description, the title and the icon links. `vite.config.ts`: the PWA manifest's `theme_color` becomes `#1C1C1E` and `background_color` becomes `#F4F4F7`; nothing else in the config changes (no new plugin, no new dependency).
- [X] T021 [US1] Add `import './styles/sheet.css';` to `web/src/main.tsx`, ordered `tokens.css → base.css → sheet.css → layout.css → app.css` so later files can override the sheet shell. No other change to `main.tsx`.

### Result content in the sheet

- [X] T022 [US1] Rewrite `web/src/components/MoneyBreakdown.tsx`: `<div class="breakdown">`, then either `<p class="breakdown__note">{ROUGH_FIGURES_NOTE}</p>` when `unreliable`, or the hero `<p class={loss ? 'net net--loss' : 'net'}>` containing `<span class="net__figure money">{formatCents(result.profitCents)}</span>` and `<span class="net__caption">{netCaption(result.profitCents)}</span>`; then `<dl class="figures">` with rows in this order: `MONEY_ROWS.value` → `result.estimatedValueCents`, `MONEY_ROWS.fees` → `-result.feesCents`, `MONEY_ROWS.shipping` → `-result.shippingEstimateCents`, and `MONEY_ROWS.cost` → `-costBasisCents` **only when `costBasisCents > 0`**. Delete the `Profit` row and the `figures__row--total` modifier — the hero figure plus caption carries that fact (FR-022). `Row` keeps its `<div class="figures__row"><dt>…</dt><dd class="money">…</dd></div>` shape. No literal user-facing string remains in this file.
- [X] T023 [US1] Rewrite `web/src/components/MoneyBreakdown.test.tsx` with the R-E numbers. Cases: (1) `flip`, cost 0 → `.net__figure` text `'$22.07'`, `.net__caption` text `'in your pocket'`, and the row list deep-equals `[['Sells for','$31.20'],['eBay fees','−$4.13'],['Shipping','−$5.00']]` (three rows); (2) `{ ...flip, profitCents: 1407 }` with `costBasisCents={800}` → four rows, the last `['What you paid','−$8.00']`, figure `'$14.07'`; (3) `{ ...flip, profitCents: -320 }` → figure `'−$3.20'` (U+2212), caption `'out of pocket — a loss'`, root `.net--loss` present; (4) no row term equals `'Profit'` and no `.figures__row--total` element exists; (5) the container text never contains `'$39.00'` (the raw asking median, FR-023 honesty); (6) `unreliable` → `ROUGH_FIGURES_NOTE` is rendered and there is no `.net` element.
- [X] T024 [US1] Rewrite `web/src/components/VerdictBanner.tsx` to return a **Fragment of siblings** (no wrapper `div`), so `.result__body` can reorder them per R-C: the optional `<p id="result-saved-note" class="verdict__saved">` (Icon `clock` + `historyNote(savedAt)`), the optional `<p id="result-env-note" class="env-note">` (Icon `flask` + `TEST_DATA_LABEL` + `TEST_DATA_WIDE`), then `<div class={`capsule capsule--${copy.treatment}`}>` containing `<span class="capsule__dot" aria-hidden="true" />`, `<Icon name={copy.icon} class="capsule__icon" />` and `<h2 id="result-heading" class="capsule__label" tabIndex={-1} ref={headingRef} aria-describedby={…}>{copy.label}</h2>` (the `aria-describedby` chain is exactly today's: `result-saved-note`, or `result-saved-note result-env-note` when both, else undefined — S12, WCAG relationship preserved), then `<p class="verdict__reason">{reasonFor(result)}</p>`, then `<p class="verdict__eyebrow">{copy.eyebrow}</p>`. `RESULT_HEADING_ID` keeps its value and export. The capsule must contain nothing but the dot, the icon and the label (color-contract rule 1).
- [X] T025 [US1] Rewrite `web/src/components/VerdictBanner.test.tsx`. Cases, one per verdict where relevant: (1) FLIP/FLIP_RISKY/RIP/UNCERTAIN render `.capsule--flip|--risky|--rip|--unc`, the labels `'Flip it'`, `'Flip it — slow seller'`, `'Rip it'`, `"Can't tell"`, and `data-icon` values `'tag'`, `'hourglass'`, `'heart-hand'`, `'question'` (SC-006 redundancy); (2) `h2#result-heading` is a descendant of `.capsule` and has `tabindex="-1"`; (3) `.capsule.nextElementSibling` carries class `verdict__reason` (the reading-order constraint asserted in `web/e2e/core.spec.ts` and `a11y.spec.ts`); (4) each verdict's eyebrow is rendered verbatim (`'Worth selling'`, `'Worth listing, expect to wait'`, `'Not worth your time. Donate or recycle it.'`, `"We couldn't identify this item"`); (5) with `savedAt` the `.verdict__saved` note precedes the capsule in DOM order and `#result-heading`'s `aria-describedby` is `'result-saved-note'`; with `savedAt` + `testData` it is `'result-saved-note result-env-note'`; (6) `.capsule` contains no `.verdict__eyebrow`, `.verdict__saved` or `.env-note` descendant; (7) UNCERTAIN's reason is `UNCERTAIN_REASON` and no-market's is `NO_MARKET_REASON`.
- [X] T026 [US1] Update `web/src/components/MatchDetails.tsx` for the new layout: keep the clamp logic, the `ResizeObserver` measurement, the `Show full title` / `Show less` toggle, the `Matched: ` / `Closest match: ` prefix, the `.match__title`, `.match__title--clamp`, `.match__prefix`, `.match__name`, `.match__toggle`, `.badge`, `.facts` and `.facts__term` class names exactly (existing tests and e2e depend on them), and wrap the MEDIUM badge and the `<ul class="facts">` in a single `<div class="match__meta">` so the meta line can be laid out as one row (FR-003 "meta line"). No copy change.
- [X] T027 [US1] Update `web/src/components/MatchDetails.test.tsx` for the new wrapper: keep every existing case (title, prefix per `prefix` prop, the toggle appearing only when the clamp hides text, the MEDIUM badge only for non-UNCERTAIN, category and competition phrase, `showCompetition={false}` hiding the competition line) and add one case asserting `.match__meta` contains both the badge (when present) and the `.facts` list.
- [X] T028 [US1] Rework `web/src/components/ResultPanel.tsx` for the sheet. Props become `{ shown; meta; visible?: boolean; ground?: 'camera' | 'static'; onCheckAnother(); onTryTitle(); onRetry(); onScan?; onScanNext?(): void; onOpenRecent?(e: Event): void }` — `visible` defaults to `true` and `ground` to `'static'` so `web/src/app.tsx` keeps compiling until T034. **The labelled region stays here, not on `Sheet`** (`contracts/sheet-states.md` desktop rule 7): keep today's root `<section class="result" aria-labelledby="result-heading">`, switching to `aria-label="Result"` + `aria-busy="true"` while loading — drop only the `card` class (R-B). Moving the label onto `.sheet` would leave a dangling idref during S1, which has no heading, nest one labelled region inside another, and break the existing `.result[aria-busy="true"]` e2e locator. **Keep the `case 'idle'` branch** — it is desktop S0 in the middle pane, exactly as today (rule 3) — but extract its markup into a component exported from this file, `export function EmptyState()` rendering `<div class="empty"><h2 id="result-heading" class="empty__heading" tabIndex={-1}>{EMPTY_HEADING}</h2><p class="empty__body">{EMPTY_BODY}</p></div>`, so the resting sheet (T032) can render the *same* component at narrow widths. `EMPTY_HEADING`/`EMPTY_BODY` stay imported here. Exactly one surface renders `EmptyState` at a time: at desktop `ResultPanel` is always mounted and the resting explainer never renders; at narrow widths `ResultPanel` is mounted only while the sheet is expanded, so its idle branch never renders. Do not inline the markup in `app.tsx` — one component, two call sites. The success body keeps `<div class="result__body result-enter" key={`${entry.id}:${fromHistory}`}>` and now emits VerdictBanner's siblings directly inside it, in the R-C DOM order. Focus: move focus to the heading **only when `visible` is true** (research R13 — a result that resolves after dismissal is stored and announced but must not re-open the sheet or steal focus); the `document.title` effect is unchanged. Actions follow R-D exactly: `ground === 'camera'` → primary `{DISMISS_SCAN_NEXT}` calling `onScanNext` plus a `.btn-text` `Check another` calling `onCheckAnother`; `ground === 'static'` → a single primary `Check another`. `ResultPanel` itself never inspects the viewport: at ≥ 1024 px there is nothing to dismiss, so T034 simply passes `ground="static"` there (desktop rule 6), which yields the `Check another`-only pair without a second code path. The no-market `Try the item name instead` secondary button is unchanged.
- [X] T029 [US1] Confirm `web/src/components/BasisNote.tsx` still renders `<p class="basis-note">{BASIS_NOTE}</p>` and is present on every result state (FR-005 from 006, re-asserted by 008). Change the file only if the class name or the copy import drifted; otherwise leave it byte-identical and note that in the task's commit message.
- [X] T030 [US1] Rewrite `web/src/components/ResultPanel.test.tsx` for the sheet. **Keep `it('S0 empty: explainer, no focus move')` (line ~28, `renderPanel({ status: 'idle' })`) exactly as it is** — the `idle` branch survives because it *is* desktop S0 (`contracts/sheet-states.md` rule 3), so nothing is relocated and nothing is deleted. Add one case asserting the extracted `EmptyState` export renders `h2#result-heading` with `'Scan or type an item'`, the `EMPTY_BODY` paragraph, and `tabindex="-1"` without moving focus — that is the component `web/src/app.tsx` reuses for the resting sheet, and T068 asserts the two surfaces never render it at once. Keep every other existing case, re-pointed at the new markup, and add: (1) `flip` with `ground="static"` → exactly one action button, labelled `'Check another'`; (2) `flip` with `ground="camera"` → primary `'Scan the next one'` firing `onScanNext`, plus a `.btn-text` `'Check another'` firing `onCheckAnother`; (3) `visible={false}` → the heading is rendered but `document.activeElement` is **not** `#result-heading` (no focus theft); (4) `visible` flipping from `false` to `true` for the same `shown` object does not double-focus; (5) the `.result__body` children appear in the R-C DOM order for a normal result (`.capsule`, `.verdict__reason`, `.verdict__eyebrow`, `.match`, `.breakdown`, `.basis-note`, `.actions`); (6) loading renders `aria-busy="true"` and no `#result-heading`; (7) the S9/S10/S11 error panels keep their heading, copy and `Try again`.

### App wiring

- [X] T031 [US1] Create the two hooks. `web/src/lib/use-media-query.ts`: `export function useMediaQuery(query: string): boolean` — `matchMedia` + a `change` listener, SSR/jsdom-safe default `false` when `matchMedia` is absent, cleanup on unmount. `web/src/lib/use-viewport-inset.ts`: `export function useViewportInset(): void` — subscribes to `visualViewport`'s `resize` and `scroll` events and writes `--kb-inset` on `document.documentElement` as `Math.max(0, layoutHeight - (visualViewport.height + visualViewport.offsetTop))` in `px`; a no-op where `visualViewport` is absent; removes the property on unmount (research R8). No dependency, no more than ~20 lines each.
- [X] T032 [US1] Rework `web/src/app.tsx` view state per `data-model.md` §1: `ground: Ground` (`{kind:'static'} | {kind:'camera', lastCode} | {kind:'unavailable', reason}` — there is deliberately **no** `status: 'starting' | 'live'` member; see `data-model.md` §1 invariant 6, since the pinned `Viewfinder` props expose no "stream ready" callback for App to observe), `sheetView: 'resting' | 'expanded'`, `overlay: 'none' | 'recent' | 'settings'`. Build the tree from the two normative trees in `contracts/sheet-states.md` ("Document structure (narrow …)" and "(desktop, ≥ 1024 px)"), which differ in exactly one respect: **only the lookup group moves.** One `const desktop = useMediaQuery('(min-width: 1024px)')` value drives all three width decisions — which columns render, where the lookup group is parented, and `RecentList`'s presentation. Render order: skip link → the lazily loaded `Viewfinder` (full-bleed ground at narrow, `presentation="card"` at the top of `.col-lookup` at desktop) or `<div class="ground ground--static" />` → `<Header>` → `<main id="main" class="layout">` → the Recent surface → `SettingsDialog` → `LiveRegion`. Inside `main.layout`:

  - `<div class="col-lookup">` — **rendered only when `desktop`**; holds the **lookup group**: the `Viewfinder` card while scanning, the camera-unavailable notice when applicable, `<LookupForm>`, then `<p class="threshold">`.
  - `<div class="col-result">` — **always**; holds `<Sheet view={desktop ? 'expanded' : sheetView} presentation={desktop ? 'pane' : 'bottom'} onDismiss={dismiss}>`. **Pass neither `labelledBy` nor `label`** — the labelled region lives inside `ResultPanel` (desktop rule 7, T028), so `.sheet` carries no `aria-labelledby`/`aria-label`; putting it there would dangle the idref during S1. The sheet's children are `<ResultPanel …>` when expanded and, at narrow widths only, the resting content when `sheetView === 'resting'`: `<EmptyState />` imported from `./components/ResultPanel` (the *same* component its idle branch renders — do not inline the markup), then the **lookup group** in the order above.
  - `<div class="col-recent">` — **rendered only when `desktop`**; holds `<RecentList presentation="pane" />`, i.e. today's `<section id="recent">`.

  At ≥ 1024 px there is **no resting/expanded distinction** (desktop rule 1): the sheet is permanently `'expanded'`, so the middle pane always shows `ResultPanel` — S0 explainer → loading → result/error, exactly as today — and the resting explainer never renders. `sheetView` stays in App state and still drives narrow widths. `.col-lookup`/`.col-recent` are simply absent below 1024 px, their contents relocated into the sheet and the Recent sheet (FR-024 "relocated, not removed"). The S0 focus target is unchanged: browser default below 1024 px, `#lookup-input` at ≥ 1024 px. **Accepted cost** (planner-documented): crossing 1024 px re-parents and therefore remounts `<LookupForm>`, losing unsubmitted input text and re-running the desktop autofocus. Hoisting the draft into App state was considered and rejected as disproportionate — do not add it here. `sheetView` becomes `'expanded'` on submit (typed or scanned) and on selecting a Recent entry; `dismiss()` sets `'resting'` **without aborting an in-flight lookup** (R13), clears `suspendedCode` so decoding of that code resumes, and moves focus per `contracts/sheet-states.md` behaviour 2: camera ground → the chrome Cancel button, static ground → the emptied `#lookup-input` (via `formRef.current.clear()` then `focusInput()`); never `document.body`. At desktop `dismiss()` is unreachable from the UI (no dismissal control, no Escape listener on a pane, no history entry), so `suspendedCode` is cleared there by `Check another` instead — which clears it at both widths (desktop rule 6). The skip link keeps `href="#lookup-input"` and gains a click handler that collapses the sheet first, then focuses the input (behaviour 6). Call `useViewportInset()` once at the top. `useLookup`, `announce`, `storage` and the settings logic are untouched (FR-023).
- [X] T033 [US1] Wire the camera lifecycle in `web/src/app.tsx` and delete the old modal: lazy-import `./scanner/viewfinder` on the first Scan tap only (`const mod = await import('./scanner/viewfinder')`, keeping today's catch → announce `SCANNER_COPY.unsupported` + focus the input), so the typed path still downloads no decoder (FR-009, SC-004). Mount `<Viewfinder onCode={onCode} onFailure={…} suspendedCode={ground.kind === 'camera' ? ground.lastCode : null} lastCode={…} presentation={isDesktop ? 'card' : 'ground'} />` only while `ground.kind === 'camera'`. `onCode(code)` sets `ground.lastCode = code`, fills and submits the form, keeps today's `navigator.vibrate?.(50)` and the polite `Scanned {code}. Checking…` announcement, keeps the "a lookup is already in flight" branch, and expands the sheet. Release the camera by setting `ground` to `{kind:'static'}` on exactly the four triggers in FR-011: `visibilitychange → hidden` (re-acquiring on `→ visible` if the user was scanning, with no new permission prompt), the chrome Cancel control, leaving the scanning flow (focusing/typing in `#lookup-input`, or `overlay !== 'none'`), and unmount. Dismissing the sheet clears `lastCode` so decoding of that code resumes. `startScan` rejection → `ground = {kind:'unavailable', reason}`. Then **delete `web/src/scanner/scanner.tsx` and `web/src/scanner/scanner.test.tsx`** — their assertions now live in `web/src/scanner/viewfinder.test.tsx` (T014) and `detect.test.ts` (T012), so SC-008 holds.
- [X] T034 [US1] Finish the `web/src/app.tsx` wiring, reusing the single `desktop` value from T032 (never a second `useMediaQuery` call). `Header`: `onOpenRecent` and `recentButtonRef` **only when `!desktop`** — at ≥ 1024 px there is no chrome Recent button, because the column is permanently visible (desktop rule 4); `onCancelCamera` and `cancelButtonRef` whenever `ground.kind === 'camera'`, at **both** widths (the desktop viewfinder card is released by the same control). `ResultPanel`: `visible={desktop || sheetView === 'expanded'}`, `ground={!desktop && ground.kind === 'camera' ? 'camera' : 'static'}` — the `!desktop` guard is what gives desktop the `Check another`-only action pair without a second code path (desktop rule 6) — `onScanNext={dismiss}`, and `onOpenRecent` **only when `!desktop`**, so S8's line is a button at narrow widths and keeps the `#recent` anchor behaviour at desktop (FR-026, research R9). `RecentList`: `presentation={desktop ? 'pane' : 'sheet'}`, with close-focus returning to the chrome Recent button (narrow only — at desktop there is no opener and no dialog). Render the camera-unavailable notice inside the **resting** sheet when `ground.kind === 'unavailable'`: `<div class="camera-notice">` with `<Icon name="alert" />`, `<h2>{SCANNER_COPY.unavailableHeading}</h2>`, the body from `SCANNER_COPY.denied` / `SCANNER_COPY.noCamera` / `SCANNER_COPY.unsupported` by reason, and a primary `{SCANNER_COPY.typeInstead}` button that focuses `#lookup-input` — focus moves to that button when the notice appears (`contracts/sheet-states.md`, S15 unavailable). Opening Recent or Settings sets `overlay` and releases the camera; closing restores focus to the opener.
- [X] T035 [US1] Rewrite `web/src/app.scanner.test.tsx` for the new ground: mock `./scanner/viewfinder` instead of `./scanner/scanner`; **drop the `expect(scan.classList.contains('scan-dock')).toBe(true)` assertion** (the fixed dock is gone — FR-001/FR-002) and replace it with `expect(document.querySelector('.ground--camera')).toBeNull()` before the first Scan tap plus `expect(viewfinderModule.loads).toBe(0)` (the lazy chunk is still not loaded, FR-009). Keep: the first Scan tap loads the module exactly once and mounts the ground; `onCode` fills the input, vibrates with 50, submits exactly `{ identifier: '9780345391803' }`, and announces `'Scanned 9780345391803. Checking…'`; the viewfinder **stays mounted** after a decode (the rewritten 006 assertion — FR-011); `onFailure('denied')` renders the `'Camera not available'` notice in the resting sheet with `'Type it instead'` focused, and clicking it focuses the input; UNCERTAIN's `'Scan the barcode if it has one'` suggestion starts the camera.
- [X] T036 [US1] Update `web/src/app.test.tsx` for sheet-aware selectors: the sheet is `.sheet--resting` before a submit and `.sheet--expanded` after; dismissing with `Escape` returns it to `.sheet--resting`, clears `#lookup-input` and focuses it; a result that resolves after a dismissal is written to history and announced but leaves `.sheet--resting` in place and does not move focus (R13); the skip link collapses the sheet and focuses `#lookup-input`. Keep every existing case (settings persistence, threshold in the request, the stale-response guard, the cost field being sent once).
- [X] T037 [US1] Update `web/src/test/app-harness.tsx` with the helpers those suites now need — e.g. `sheet()` returning `container.querySelector('.sheet')`, `expandSheet(input, value)` wrapping `typeAndSubmit`, and a `startCamera()` helper that clicks Scan and waits for `.ground--camera`. `META`, `mockApi`, `renderApp` and `typeAndSubmit` keep their current signatures. `web/src/test/fixtures.ts` is **not** modified (R-E).
- [X] T038 [US1] Add the SC-003 loop test to `web/e2e/core.spec.ts` using the T049 helpers: `blackCamera` + `fakeDetector(page, ['9780345391803','9780000000002'])`, one Scan tap, assert the first verdict heading is focused, dismiss with the visible `'Scan the next one'` control, advance the stubbed detector, assert the second verdict arrives with **no further tap**, and assert `getUserMedia` was called exactly **once** across both scans (init-script counter). Also assert the pill read `'Barcode found · 9780345391803'` after the first decode and that `.ground--camera video` was never removed from the DOM between the two verdicts.

- [X] T068 [US1] Add the S0 non-regression cases to `web/src/app.test.tsx` (FR-024 — S0 moved surface in T028/T032 and nothing else asserts its copy): (1) on first render the resting sheet contains `h2#result-heading` with the exact text `'Scan or type an item'` and a sibling paragraph with the exact `EMPTY_BODY` text `"You'll get a verdict — flip it or rip it — with the numbers behind it."`, both inside `.sheet--resting`; (2) the pinned `#result-heading` invariant (`contracts/sheet-states.md` rule 3) — `document.querySelectorAll('#result-heading').length` is **≤ 1 always**, **exactly 1** in every state whose focus target is `#result-heading` (S0 and every result/error state), and **0 while loading**, at both widths. Assert all three: 1 at rest, **0** during the in-flight lookup, 1 once the verdict lands. The loading case is deliberate and matches today's client — the skeleton carries `aria-label="Result"` + `aria-busy="true"` and no heading — so a red assertion here is **never** fixed by giving the skeleton a heading; (3) after a verdict is dismissed, the S0 heading and body are present again; (4) the document title is `'Flip it or Rip it'` in the resting state; (5) with `matchMedia('(min-width: 1024px)')` stubbed to match, `.col-lookup` and `.col-recent` are rendered, the sheet is `.sheet--expanded.sheet--pane` with no `.sheet__grabber`, the explainer comes from `ResultPanel`'s idle branch inside `section.result`, the resting explainer is absent, and the count from (2) is still exactly 1 — proving the two surfaces never both render `EmptyState`.

**Checkpoint**: US1 is functional — one Scan tap, two verdicts, one permission.

---

## Phase 4: User Story 2 — I never turn the camera on (P1)

**Goal**: the typed path is unchanged in cost and better in layout: static ground, no permission, no
decoder bytes.

**Independent Test**: with `getUserMedia` absent and the decoder chunk blocked, type → verdict →
check another completes; no camera prompt; the initial download still contains no decoder.

- [X] T039 [US2] Update `web/src/components/LookupForm.tsx` for the resting sheet: **remove the `scan-dock` class** from the Scan button (it keeps `class="btn btn--scan"`, its `scanButtonRef`, its position after Check in DOM order, and its conditional rendering when `onScan` is absent — FR-008/US2-4). Keep `#lookup-input`, its label `Barcode or item name`, `#lookup-error`, `aria-invalid`/`aria-describedby`, the `LookupFormHandle` (`focusInput`, `clear`, `setValue`, `submit`), the loading `Checking…` + `aria-disabled` behaviour and the `CostField` composition exactly as they are.
- [X] T040 [US2] Update `web/src/components/LookupForm.test.tsx`: replace the `.scan-dock` expectation with `expect(scan.className).toBe('btn btn--scan')`, and keep every other case (label, required validation, cost disclosure `What I paid (optional)` closed by default, the loading state, the Scan button's absence when `onScan` is undefined).
- [X] T041 [US2] Extend `web/src/a11y.test.tsx` (sole owner: WP8) with the new sheet states and the typed-path guarantees: **N1** resting over static — assert `container.querySelector('video')` is `null`, there is no `.pill` and no `.viewfinder__reticle`, the S0 heading `'Scan or type an item'` and `EMPTY_BODY` are rendered (FR-024), and axe reports 0 violations; **N2** resting over a live viewfinder (fake `getUserMedia` + stubbed `BarcodeDetector`) — axe clean, the chrome Cancel button focused; **N3** result over the live viewfinder; **N4** the Recent sheet open over an expanded result. Keep every existing S0–S15 case, re-pointed at the new markup (the S15 pair becomes "viewfinder ground" and "camera-unavailable notice in the resting sheet"). Note in a comment that jsdom cannot evaluate `color-contrast`, which is why `src/styles/contrast.test.ts` and the e2e video-hidden pass exist.
- [X] T042 [US2] Extend `web/e2e/core.spec.ts` with the SC-004 assertions on a load where Scan is never tapped: an `addInitScript` counter shows `getUserMedia` called **zero** times, `page.locator('video')` has count 0, a route assertion records **no** request whose URL matches `/zxing|barcode-detector/`, and the typed loop (type → verdict → `Check another` → input focused and emptied) passes at every project width. Keep the existing per-fixture `type → verdict` cases, updated for the sheet selectors.

---

## Phase 5: User Story 3 — Legible on the worst day (P1)

**Goal**: the frosted sheet is AA against the worst image the camera can supply, in both schemes, in
forced colors, at 400 % zoom, and with reduced transparency — proved by tests, not by eye.

**Independent Test**: the axe matrix passes with zero violations **and** no `color-contrast` entry in
`incomplete` for every state at 320/390/1280 px in both schemes, plus `contrast.test.ts` green.

- [X] T043 [US3] In `web/src/styles/app.css`, implement the R-C order map and the verdict capsule: `.result__body { display: flex; flex-direction: column; gap: var(--space-3); }` with the ten `order` values exactly as tabulated; `.capsule` as an inline-flex pill (`--radius-pill`, 1 px solid border in the matching tint, background `--caps-*` by modifier, label `--ink` at `--step-1`/600, ≥ 44 px block size); `.capsule__dot` a 10 px dot in the matching `--tint-*`; `.capsule--unc { border-style: dashed; border-width: 2px; }` (FR-018, SC-006); `.verdict__reason` in `--ink` at body size; `.verdict__eyebrow`, `.verdict__saved` and `.env-note` in `--secondary` **on the sheet ground, never inside the capsule**.
- [X] T044 [US3] In `web/src/styles/app.css`, style the money block and the match block: `.net` as a stacked hero — `.net__figure` at `var(--text-net)`/600 with `font-variant-numeric: tabular-nums` in the verdict tint inherited from the `.result__body` treatment class, `.net__caption` in `--secondary` at `--step--1`; `.figures__row` a two-column row separated by `1px solid var(--hairline)` with `dd` right-aligned and tabular; `.match__name` at `var(--text-name)`/600 with `letter-spacing: -0.01em`; `.match__title--clamp` a 2-line `-webkit-line-clamp` below 1024 px only; `.match__meta` a wrapping row whose `.facts` items are separated by a decorative `·` via `::before` (never the sole carrier of meaning). **No tint may be applied to text below 24 px anywhere in this file** (FR-015) — the net figure is the only tinted text.
- [X] T045 [US3] In `web/src/styles/app.css`, style controls: `.btn` (≥ 44 px, `--radius-sm`, 1 px `--control-border`), `.btn--primary` (`background: var(--ink); color: var(--sheet-opaque)` — the R-A neutral pair), the four verdict primaries (`--fill-*` background with `--fill-label` text and a 1 px `--tint-*` border, which is what gives the dark fills a boundary), `.btn--ghost`, `.btn--scan`, `.btn-text`, `.link`, `.field`, `.cost`, `.threshold`, `.badge`, `.chip` + `.chip--*`, `.suggestions`/`.suggestion`, `.rough`, and `.env-badge` as the neutral chrome pill (`--chrome-bg`/`--chrome-fg`, reserving its space so its arrival shifts nothing — 007 FR, US5-3).
- [X] T046 [US3] In `web/src/styles/app.css`, style Recent and the dialogs: `.recent` in both presentations (`.sheet--full` dialog below 1024 px, `.col-recent` pane at and above it), `.recent__head`, `.recent__title`, `.recent__list`, `.recent-item` (≥ 44 px target, the `.chip` row, `.recent-item__title`, `.recent-item__meta`), `.recent__empty`, `.recent__notice`, `.dialog`, `.dialog--small`, `.dialog__title`, `.dialog__body`, `.dialog__actions` — all on `--sheet-opaque` with `--radius-card`, never translucent.
- [X] T047 [US3] In `web/src/styles/app.css`, style the remaining states: `.empty`, `.empty__heading`, `.empty__body`, `.skeleton*` (keep the existing pulse, which the e2e `settle()` helper treats as infinite), `.error-panel*`, `.sandbox-note`, `.basis-note`, `.camera-notice` (the T034 notice inside the resting sheet), and `.result-enter` (the 150 ms entrance that `web/e2e/layout.spec.ts` measures — keep the class name and keep it inside `prefers-reduced-motion: no-preference`).
- [X] T048 [US3] Finish `web/src/styles/app.css`: delete every rule for the classes in R-B's "Deleted" list, migrate every remaining old token reference per R-A, and verify with `docker compose run --rm --no-deps web sh -c '! find src -name "*.css" -o -name "*.tsx" | xargs grep -nE -- "--(bg|surface|text-muted|border-ui|border-subtle|btn-bg|btn-fg|flip-fg|flip-tint|risky-fg|risky-tint|rip-fg|rip-tint|unc-fg|unc-tint|test-fg|test-tint|test-border|radius-lg|dock-height)\b|--text[^-a-zA-Z]"'` — `find … | xargs` is the portable recursive form (a `src/**/*.tsx` glob does **not** recurse under `sh`, and `grep --include` is a GNU extension); the `--` before the pattern stops grep reading `--bg` as an option; `--text[^-a-zA-Z]` matches the removed `--text` without matching the legitimate new `--text-name` / `--text-net` (verified against the current tree, where it correctly reports `tokens.css`, `base.css`, `layout.css` and `app.css`). No output (grep exit 1, inverted by `!`) is the pass condition.
- [X] T049 [US3] Add the new helpers to `web/e2e/fixtures.ts` (sole owner: WP10): `openRecent(page)` — below 1024 px clicks the chrome `Recent` button and waits for `dialog[open] #recent-heading`, at ≥ 1024 px asserts `#recent` is visible; `withVideoHidden(page, fn)` — sets `display:none` on `.viewfinder__video`, runs `fn`, restores it (research R5: this is what lets axe composite the sheet over the `#000` ground); `emulateReducedTransparency(page, on)` — a CDP `Emulation.setEmulatedMedia` call with `features: [{ name: 'prefers-reduced-transparency', value: 'reduce' }]` or `features: []` (Playwright 1.63 has no option for it), reusing the `context.newCDPSession(page)` pattern from `axNode`; `expectChromeOpaque(page)` — every element matching `.chrome, .chrome__btn, .pill, .env-badge` has a computed `background-color` whose alpha is exactly 1 (FR-016); `blackCamera(page)` — `fakeCamera` but filling `#000000`, the worst-case backdrop; `fakeDetector(page, codes)` — an `addInitScript` stub of `window.BarcodeDetector` with `static getSupportedFormats = async () => ['ean_13']` and a queue plus a `window.__nextCode()` advance hook (research R15 — no test hook in production code); `expectNoIncompleteContrast(page)` — the axe run's `incomplete` array has no `color-contrast` entry. Extend `expectStateAccessible` to call `expectNoIncompleteContrast` for every state with no live `<video>` in the DOM.
- [X] T050 [US3] Rewrite the `STATES` table in `web/e2e/a11y.spec.ts` (sole owner: WP10). Replace the four `S15 scanner …` dialog states with: `S15 viewfinder` (`before: blackCamera` + `fakeDetector`, enter: click Scan, expect `.ground--camera video` and the pill `'Point at a barcode'`, focus the chrome `Cancel` button) and `S15 camera unavailable` × {denied `NotAllowedError`, no camera `NotFoundError`, unsupported `TypeError`} (notice inside the resting sheet, focus the `'Type it instead'` button). Add `N1` resting over static (assert no `video` in the DOM), `N2` resting over a live viewfinder (focus Cancel), `N3` result over a live viewfinder (`forced: true`), `N4` Recent open over an expanded result (focus `#recent-heading`), `N5` the opaque fallback via `emulateReducedTransparency` (focus `#result-heading`), `N6` keyboard open — set `--kb-inset` to `300px` on `documentElement`, focus `#lookup-input`, and assert the input's bounding box is fully above the sheet's padding edge and inside the viewport (FR-006). **Per-project applicability**: at `desktop-1280` the N-states render in the pane layout, so `N4` (Recent over a result) does **not** exist there — assert the visible `#recent` column instead — and `N6` is n/a (`test.skip`); `N2`/`N3`/`N5` do apply, with the viewfinder as the `.ground--card` in `.col-lookup`. Keep every S0–S14 state, re-pointed at the sheet selectors; S0's existing focus rule (`isDesktop ? '#lookup-input' : 'default'`) still holds unchanged.
- [X] T051 [US3] Add the three contrast-proof passes to `web/e2e/a11y.spec.ts`: for every camera-live state, run the matrix twice — as rendered (`violations` empty) and inside `withVideoHidden` (`violations` empty **and** `expectNoIncompleteContrast`), which is what makes the worst-case composite an asserted fact (research R5); call `expectChromeOpaque` in every camera state (FR-016); and in `N5` assert the sheet's computed `background-color` has alpha 1 and its `backdrop-filter` is `none` under emulated reduced transparency, then restore with `features: []` and assert the glass returns (FR-019).
- [X] T052 [US3] Add the SC-006 / FR-018 assertions to `web/e2e/a11y.spec.ts`: across the four verdict fixtures, `#result-heading` texts are four distinct strings and `.capsule__icon`'s `data-icon` values are four distinct names; `.capsule--unc`'s computed `border-style` is `dashed` while the other three are `solid`; and under `forcedColors: 'active'` the capsule, the money rows and the buttons keep a computed `border-width >= 1px` (re-point the existing forced-colors expectations from `.verdict/.chip/.btn/.card` to `.capsule/.chip/.btn/.sheet/.figures__row`).
- [X] T053 [US3] Update `web/e2e/layout.spec.ts` — **the phones half is the part that is rewritten**, because `.col-lookup`/`.col-recent` no longer exist below 1024 px and the fixed Scan dock is gone; the desktop three-column case is left alone (T065). Rename the phones test to "the sheet never covers the focused element", drop its `.col-lookup`/`.col-result`/`.col-recent` stacking assertions (those columns are absent at this width — the sheet is the only pane), and replace every `.scan-dock` reference with `.sheet`, keeping the ≥ 10-stop Tab walk and the intersection assertion (WCAG 2.4.11); add a keyboard-open variant that sets `--kb-inset: 300px` before the walk; re-point the reduced-motion test at `.sheet` (the transition must be ≤ 1 ms and `document.getAnimations()` must report nothing longer than 1 ms); and update the 400 % zoom walk (320 CSS px) to open the sheet, the rough-figures disclosure, a Recent entry and Settings, asserting no horizontal scrolling and that the sheet scrolls internally rather than clipping (FR-005, SC-005).

---

## Phase 6: User Story 4 — "Can't tell" and "nothing for sale" are not "rip it" (P2)

**Goal**: UNCERTAIN and no-market keep their own identity in the sheet: no hero figure, no donate or
recycle wording, figures behind the disclosure.

**Independent Test**: the UNCERTAIN state shows its own tint and a dashed capsule, no net figure and
no caption, the suggestions and closest-match line, and figures only inside the collapsed
"Show rough figures (unreliable)" disclosure.

- [X] T054 [US4] In `web/src/components/ResultPanel.tsx`, lay out the UNCERTAIN branch for the sheet: VerdictBanner's siblings (dashed `.capsule--unc`, label `"Can't tell"`, reason `UNCERTAIN_REASON`), `<ul class="suggestions" role="list">` with the two existing suggestions (the Scan one stays a button only when `onScan` is given), `<MatchDetails result={r} prefix="Closest match" showCompetition={false} />`, and the collapsed `<details class="rough"><summary>{ROUGH_FIGURES_SUMMARY}</summary><MoneyBreakdown … unreliable /></details>`. **No `.net` element and no caption anywhere in this branch** (US4-2), and no donate/recycle wording (that phrase exists only in RIP's eyebrow).
- [X] T055 [US4] In `web/src/components/ResultPanel.tsx`, lay out the no-market branch (`isNoMarket(r)`): the RIP capsule with the overridden `NO_MARKET_REASON`, **no `.net` element and no `.figures` rows**, the spec-007 `<p class="sandbox-note">{SANDBOX_NO_MARKET}</p>` when `isTestEnv(env)`, `BasisNote`, and the actions `Check another` (or `Scan the next one` per R-D) plus `Try the item name instead` when `entry.query.identifier !== null`. In the same file, replace the S8 limit panel's `<a href="#recent" class="link">` with `<button type="button" class="btn-text" onClick={onOpenRecent}>{ERROR_COPY.limit.recent}</button>` when `onOpenRecent` is provided, keeping the anchor when it is not (FR-026, research R9 — identical visible text, so the WCAG 2.5.3 label-in-name check still passes).
- [X] T056 [US4] Add the US4 cases to `web/src/components/ResultPanel.test.tsx`: (1) `uncertain` → `.capsule--unc` present, no `.net` and no `'in your pocket'` text, both suggestions present, `details.rough` closed with summary `'Show rough figures (unreliable)'` and containing `'These figures may be for a different product.'`, and the container text contains neither `'donate'` nor `'recycle'` (case-insensitive); (2) `noMarket` → no `.net`, no `.figures__row`, reason `NO_MARKET_REASON`, and with `meta.ebayEnv = 'sandbox'` the sandbox sentence appears while with `'production'` it does not; (3) the S8 panel renders a `button` with the exact text `'Your recent lookups are still here.'` when `onOpenRecent` is given (clicking it calls the handler) and an `a[href="#recent"]` with the same text when it is not; (4) `{ ...flip, profitCents: -320 }` renders the minus-signed figure **and** the loss caption (US4-4).

---

## Phase 7: User Story 5 — Recent and the test-data badge still have a home (P2)

**Goal**: **below 1024 px** Recent opens from the chrome as its own full-height sheet, reachable even
over a result; **at ≥ 1024 px it stays the visible third column** and the S8 line keeps its `#recent`
anchor (FR-026, FR-027, research R9). The sandbox badge lives in the chrome in both cases and is
legible over any camera image.

**Independent Test**: from a result, open Recent, select a saved entry, see it with its saved-result
note, close it and land back on the opener — keyboard only. In sandbox the badge is visible in every
state, including with a result sheet open.

- [X] T057 [US5] Give `web/src/components/RecentList.tsx` two presentations (research R9): a new prop `presentation?: 'sheet' | 'pane'` defaulting to `'pane'` (optional, so `web/src/app.tsx` compiles before T034). `'pane'` renders exactly today's `<section id="recent" class="card recent" aria-labelledby="recent-heading" tabIndex={-1}>` with `card` swapped for the new skin classes. `'sheet'` renders a modal `<dialog class="sheet sheet--full recent-sheet">` that reuses `web/src/lib/use-modal.ts` for Escape, the focus trap, inertness and focus return, containing the same `#recent-heading`, the same list and accessible names, the same empty state, the same storage notice and the same Clear-history confirm dialog, plus a close control with the existing visible text `Close`. On open, focus `#recent-heading`; on close, return focus to the opener (the App supplies it). The list, `entryTitle`, `recentProfitPhrase`, the `chip` markup, the WCAG 2.5.3 accessible names and the 44 px targets are unchanged. Do not import `use-media-query` here — the App picks the presentation.
- [X] T058 [US5] Update `web/src/components/RecentList.test.tsx`: keep every existing case against `presentation="pane"`, and add for `presentation="sheet"` — the root is a `dialog` that is open, `#recent-heading` receives focus, the `Close` button closes it, `Escape` closes it, the entries and their accessible names are identical to the pane's, the empty state and the storage notice render the same copy, and the Clear-history confirm still focuses Cancel first.
- [X] T059 [US5] Restyle `web/src/components/EnvBadge.tsx` as the neutral chrome pill (spec Assumptions): keep `isTestEnv`, the `flask` icon, `TEST_DATA_LABEL`, the `.env-badge__wide` `TEST_DATA_WIDE` span and the `visually-hidden` `TEST_DATA_EXPLAIN` text **verbatim**; the element stays `<p class="env-badge">` with no new prop (the chrome styling comes from CSS, so `Header` passes nothing new). Update `web/src/components/EnvBadge.test.tsx` only where markup moved; every copy assertion stays byte-identical (FR-022).
- [X] T060 [US5] Restyle `web/src/components/SettingsDialog.tsx` to the new tokens and classes (`.dialog`, `.dialog__title`, `.dialog__body`, `.dialog__actions`, `.field`, `.btn--primary`): the copy, `#threshold-input`, `#threshold-error`, the `Your settings` accessible name, the `Save`/`Close` labels, the validation behaviour, the `Saved` polite announcement and the focus return are unchanged (FR-024). Update `web/src/components/SettingsDialog.test.tsx` only for changed class names.
- [X] T061 [US5] Update `web/src/app.env.test.tsx`: the badge now lives in the chrome (`.chrome .env-badge`) and is present in the resting state, with a result sheet expanded, and with the Recent sheet open; the sandbox no-market sentence still appears in the expanded sheet; a `production` environment still renders no badge; and the history entry still remembers the environment it was checked in. Copy assertions stay verbatim.
- [X] T062 [US5] Update `web/e2e/errors.spec.ts` for FR-026: the S8 limit state's recent reference is a `button` whose visible text is exactly `'Your recent lookups are still here.'`; below 1024 px, clicking it opens the Recent sheet, focus lands inside it, and closing returns focus to that button; at 1280 px the existing `#recent` anchor behaviour is asserted instead (the "link lands on a labelled region" case keeps a home). Keep the S7/S9/S10/S11 cases, re-pointed at the sheet.
- [X] T063 [US5] Update `web/e2e/env.spec.ts` and `web/e2e/offline.spec.ts`: the badge is located in `.chrome`, is visible with the result sheet expanded and with Recent open, keeps the exact `BADGE_TEXT`, passes the forced-colors check with a solid border, and still causes no layout shift when it arrives (keep the existing measurement, re-pointed at the sheet's input position); `offline.spec.ts` reaches Recent through `openRecent` and asserts the offline shell still renders the ground, the chrome and the resting sheet.

---

## Phase 8: User Story 6 — Desktop still uses the screen (P3)

**Goal**: at ≥ 1024 px today's three-pane layout stays and is restyled — `.col-lookup` (the lookup
group, with the viewfinder card on top while scanning), `.col-result` (the sheet as a `.sheet--pane`,
permanently expanded), `.col-recent` (Recent as a visible column). The bottom-sheet metaphor, the
dismissal controls and the Recent dialog are narrow-viewport behaviours. **Only the lookup group moves
between breakpoints**; everything else has one home (`contracts/sheet-states.md`, both normative trees).

**Accepted cost** (planner-documented, recorded here so no implementer "fixes" it): crossing 1024 px
re-parents and therefore remounts `<LookupForm>`, losing unsubmitted input text and re-running the
desktop autofocus. Hoisting the draft into App state was considered and rejected as disproportionate.

**Independent Test**: at 1280 px the full loop works with the keyboard alone, nothing scrolls
horizontally, and the axe matrix passes at desktop width.

- [X] T064 [US6] Rewrite `web/src/styles/layout.css`: delete the whole `@media (max-width: 1023.98px)` `.scan-dock` block and the `--dock-height` token (the fixed dock is gone — FR-001); restyle `.chrome` and `.layout` for the new tokens; keep the ≥ 1024 px grid `minmax(18rem, 22rem) minmax(0, 1fr) minmax(16rem, 20rem)` with `.col-lookup`/`.col-recent` sticky and Recent scrolling independently (006 US5 must keep passing); style `.sheet--pane` (the class App applies at ≥ 1024 px, T015) as a static rounded surface in the middle column — `position: static`, all four corners `--radius-card`, no bottom anchoring, no `--kb-inset` height cap — and force the full-bleed `.ground` to the static tone at this width; give `.ground--card` (the desktop viewfinder, research R10) a 4:3 rounded card at the top of `.col-lookup`. Hook the pane rules on the **class**, not only the media query, so the markup and the styling agree at the same breakpoint. Migrate every token reference per R-A.
- [X] T065 [US6] Desktop e2e. **`layout.spec.ts`'s existing `desktop: form, result and Recent side by side in three columns` case needs no edit and must keep passing unchanged** — `.col-lookup`, `.col-result` and `.col-recent` all still exist in that order at ≥ 1024 px (006 US5, desktop rule 8); if it goes red, the tree is wrong, not the test. Add to `web/e2e/layout.spec.ts`: at 1280 px the sheet is `.sheet--pane` with no `.sheet__grabber` and no fixed positioning, `Escape` over a result changes nothing (no dismissal at this width), and a page load pushes **no** history entry (`history.length` unchanged, so Back leaves the app rather than collapsing a pane). In `web/e2e/core.spec.ts`: Recent is the visible `#recent` column and never a dialog, there is no chrome `Recent` button, the primary action stays `Check another` (no `Scan the next one`) even with the viewfinder card live, the whole loop is keyboard-only reachable, and there is no horizontal scrolling from 320 px to 1920 px (SC-005).

---

## Phase 9: Polish & cross-cutting

- [X] T066 [P] Update the web-client paragraph in `CLAUDE.md` under "Current state": the client is now the native-sheet UI (spec `specs/008-native-sheet-ui/`) — the camera is the ground and the verdict rises as a frosted bottom sheet; the camera stays live behind an open sheet and is released on page hide, Cancel, or leaving the flow (**this amends 006 FR-009**, whose stop-on-decode assertions were rewritten, not deleted); decoding is suspended for the code that opened the sheet so a dismissal cannot double-charge a lookup; token contrast is measured against the worst-case composited ground by `web/src/styles/contrast.test.ts` against `web/src/styles/contrast-contract.ts`; the e2e matrix runs a second axe pass with the `<video>` hidden and fails on a `color-contrast` entry in `incomplete`; Recent opens as its own full-height sheet below 1024 px and stays a column above it; the ≤ 100 KB gzip budget and WCAG 2.2 AA still bind. Mention that `web/src/scanner/scanner.tsx` is now `web/src/scanner/viewfinder.tsx`.
- [X] T067 [P] Sweep stale references: `grep -rn "scan-dock\|scanner/scanner\|Est\. sale value" CLAUDE.md docs/ specs/006-web-client/ specs/007-environment-badge/` — update any prose hit in `CLAUDE.md` or `docs/` (spec files for 006/007 keep their history except the amendments T008 already made, which are marked `(008)`). Confirm `.env.example` needs no change (this feature adds no env var) and that `docs/PROJECT_BRIEF.md` still describes the product truthfully.
- [X] T069 Add the SC-007 latency gate to `web/e2e/core.spec.ts`: a test named `submit → verdict does not regress (SC-007)` that runs the **R-G recipe verbatim** — same helpers, the same alternating `flip, rip, flip, rip, flip` sequence, the same per-cycle "heading does not yet read *this* cycle's label" precondition and the same in-page predicate that T001 measured the baseline with. The two runs must be byte-for-byte the same procedure; if you find yourself simplifying it here (one fixture, fewer cycles, a reload) the comparison stops being like-for-like and the gate is worthless. With `mockApi(page)`, five cycles, assert `median <= Math.max(BASELINE_MS * 1.25, 150)` and `Math.max(...samples) <= 400`. `BASELINE_MS` is **read mechanically** — `web/e2e/fixtures.ts` gains `export const BASELINE_MS: number` that imports `./baseline.json` (`{ "submitToVerdictMedianMs": … }`, written by T001) and throws at module load if the file is absent or the value is not a finite number > 0; do not hand-copy the figure into a literal, so a stale or blank baseline cannot pass unnoticed. Gate it to one device profile with `test.skip(({}, testInfo) => testInfo.project.name !== 'mobile-390')` — the project name must be one of the three in `web/playwright.config.ts` (`mobile-320`, `mobile-390`, `desktop-1280`); a name that exists in none of them skips on all three and the verify then passes having measured nothing. **Acceptance for this task is that the `list` reporter shows this test as passed on `mobile-390`** — "skipped everywhere" is a failure, not a pass. If `web/e2e/baseline.json` is missing, stop and report; do not invent a baseline and do not widen the tolerance to go green.

---

## Dependencies & Execution Order

### Phase dependencies

- Phase 1 (Setup) → Phase 2 (Foundational) blocks everything: no component may reference a token or
  a string that T002–T010 have not created.
- Phase 3 (US1) is the MVP; Phase 4 (US2) depends only on Phase 3's shell existing.
- Phase 5 (US3) depends on all markup existing (it is the CSS plus the accessibility matrix).
- Phases 6–8 depend on Phase 3; Phase 9 depends on T007/T008 having fixed the copy keys.

### Ordering constraints carried from `plan.md`

**A before B/D/F** (every style depends on the token names) · **C is independent of D** · **E depends
on B and C** · **G depends on B–F** · **H any time after the copy keys exist**. The wave plan below
satisfies all of them.

### Parallel opportunities

- Phase 2: WP1 ∥ WP2 (tokens vs copy — disjoint files).
- Phase 3: WP3 ∥ WP4 ∥ WP5 ∥ WP6 all run together (camera, shell, result leaves, secondary
  surfaces).
- Phase 9: WP10 ∥ WP11 (e2e vs docs).

### Independent test criteria per story

| Story | Criterion | Proved by |
|---|---|---|
| US1 | one Scan tap → two verdicts, one `getUserMedia` call | T038, T012, T014, T035 |
| US2 | typed loop with no camera and no decoder bytes | T042, T041 (N1), `check-size.mjs` |
| US3 | 0 axe violations and no `color-contrast` `incomplete`, every token pair ≥ its ratio | T005, T050–T053 |
| US4 | UNCERTAIN/no-market keep their identity, no hero figure, no donate wording | T056, T054, T055 |
| US5 | Recent reachable from every state — as a sheet below 1024 px, as the `#recent` column at ≥ 1024 px — focus returns to the opener, badge in the chrome | T058, T062, T063, T061 |
| US6 | three panes, keyboard loop, no horizontal scroll at 1280 px | T065, T064 |

### MVP scope

Phases 1–3 (T001–T038): the sheet, the camera lifecycle, the result content and the app wiring —
the loop the founder chose. Everything after that is preservation of already-shipped behaviour
(US2/US4/US5/US6) plus the accessibility proof (US3), which is a release gate rather than an
increment.

---

## Work Packages

| WP | Tasks | Owns (files/globs) | Depends on | Tier | Verify |
|----|-------|--------------------|------------|------|--------|
| WP1 | T001–T006 | `web/src/styles/tokens.css`, `web/src/styles/contrast-contract.ts`, `web/src/styles/contrast.test.ts`, `web/e2e/baseline.json` (**create**; WP10 only reads it), `web/e2e/baseline.spec.ts` (**create and remove inside T001** — must not survive the task or be committed), the R-G baseline table in `specs/008-native-sheet-ui/tasks.md` (**reads** `contracts/color-contract.md`; T006 must not write it) | — | sonnet | `docker compose run --rm --no-deps web sh -c "npx vitest run src/styles/contrast.test.ts && npm run typecheck"` |
| WP2 | T007–T010 | `web/src/lib/verdict-copy.ts`, `web/src/lib/verdict-copy.test.ts`, `web/src/components/Icon.tsx`, `specs/006-web-client/contracts/ui-states.md` | — | sonnet | `docker compose run --rm --no-deps web sh -c "npx vitest run src/lib/verdict-copy.test.ts && npm run typecheck"` |
| WP3 | T011–T014 | `web/src/scanner/detect.ts`, `web/src/scanner/detect.test.ts`, `web/src/scanner/viewfinder.tsx`, `web/src/scanner/viewfinder.test.tsx` | WP2 | sonnet | `docker compose run --rm --no-deps web sh -c "npx vitest run src/scanner/detect.test.ts src/scanner/viewfinder.test.tsx && npm run typecheck"` (named files only — `src/scanner` would also sweep `scanner.test.tsx`, which WP3 does not own and which WP8 deletes) |
| WP4 | T015–T021, T064 | `web/src/components/Sheet.tsx`, `web/src/components/Sheet.test.tsx`, `web/src/components/Header.tsx`, `web/src/styles/sheet.css`, `web/src/styles/base.css`, `web/src/styles/layout.css`, `web/index.html`, `web/vite.config.ts`, `web/src/main.tsx` | WP1 | sonnet | `docker compose run --rm --no-deps web sh -c "npx vitest run src/components/Sheet.test.tsx && npm run build"` |
| WP5 | T022–T027 | `web/src/components/MoneyBreakdown.tsx`, `MoneyBreakdown.test.tsx`, `VerdictBanner.tsx`, `VerdictBanner.test.tsx`, `MatchDetails.tsx`, `MatchDetails.test.tsx` (all under `web/src/components/`) | WP1, WP2 | sonnet | `docker compose run --rm --no-deps web sh -c "npx vitest run src/components/MoneyBreakdown.test.tsx src/components/VerdictBanner.test.tsx src/components/MatchDetails.test.tsx && npm run typecheck"` |
| WP6 | T039, T040, T057–T060 | `web/src/components/LookupForm.tsx`, `LookupForm.test.tsx`, `CostField.tsx`, `RecentList.tsx`, `RecentList.test.tsx`, `SettingsDialog.tsx`, `SettingsDialog.test.tsx`, `EnvBadge.tsx`, `EnvBadge.test.tsx` (all under `web/src/components/`) | WP1, WP2 | sonnet | `docker compose run --rm --no-deps web sh -c "npx vitest run src/components/LookupForm.test.tsx src/components/RecentList.test.tsx src/components/SettingsDialog.test.tsx src/components/EnvBadge.test.tsx && npm run typecheck"` |
| WP7 | T028–T030, T054–T056 | `web/src/components/ResultPanel.tsx`, `web/src/components/ResultPanel.test.tsx`, `web/src/components/BasisNote.tsx` | WP5 | sonnet | `docker compose run --rm --no-deps web sh -c "npx vitest run src/components/ResultPanel.test.tsx && npm run typecheck"` |
| WP8 | T031–T037, T041, T061, T068 | `web/src/app.tsx`, `web/src/lib/use-media-query.ts`, `web/src/lib/use-viewport-inset.ts`, `web/src/app.test.tsx`, `web/src/app.scanner.test.tsx`, `web/src/app.env.test.tsx`, `web/src/a11y.test.tsx`, `web/src/test/app-harness.tsx`, `web/src/test/fixtures.ts`, `web/src/scanner/scanner.tsx` (delete), `web/src/scanner/scanner.test.tsx` (delete) | WP3, WP4, WP6, WP7 | sonnet | `docker compose run --rm --no-deps web sh -c "npm test && npm run typecheck"` |
| WP9 | T043–T048 | `web/src/styles/app.css` | WP8 | sonnet | `docker compose run --rm --no-deps web sh -c "npm test && npm run typecheck"` |
| WP10 | T038, T042, T049–T053, T062, T063, T065, T069 | `web/e2e/fixtures.ts`, `web/e2e/a11y.spec.ts`, `web/e2e/core.spec.ts`, `web/e2e/errors.spec.ts`, `web/e2e/layout.spec.ts`, `web/e2e/env.spec.ts`, `web/e2e/offline.spec.ts` | WP9 | sonnet | `docker compose --profile e2e run --rm e2e` |
| WP11 | T066, T067 | `CLAUDE.md`, `docs/` | WP8 | haiku | `grep -q "viewfinder" CLAUDE.md && grep -q "contrast.test.ts" CLAUDE.md && grep -q "native sheet" CLAUDE.md && ! grep -rn "scan-dock\|scanner/scanner" CLAUDE.md docs/` — all four clauses must hold; the first three fail today, so the gate actually proves T066 ran. No Docker: `CLAUDE.md` and `docs/` are not mounted in any container. |

### Waves

- **W1**: WP1 ∥ WP2
- **W2**: WP3 ∥ WP4 ∥ WP5 ∥ WP6
- **W3**: WP7
- **W4**: WP8  ← first full unit-suite gate
- **W5**: WP9
- **W6**: WP10 ∥ WP11  ← first e2e gate

### Single-owner notes (the planner's stated collision risk)

- `web/src/a11y.test.tsx` → **WP8 only** (T041).
- `web/e2e/a11y.spec.ts` → **WP10 only** (T050–T052).
- `web/src/test/fixtures.ts` → **WP8 only**, and expected to stay unchanged (R-E pins the loss case
  as an inline override).
- `web/src/styles/app.css` → **WP9 only**; `web/src/styles/sheet.css`, `base.css`, `layout.css` →
  **WP4 only**; `web/src/styles/tokens.css` → **WP1 only**.
- `specs/006-web-client/contracts/ui-states.md` → **WP2 only**, in W1, so the copy exists before
  WP5/WP7 consume it (FR-021).
- `web/e2e/baseline.json` is **written once by WP1** (T001) and only **read** by WP10 (T069, via
  `BASELINE_MS` in `web/e2e/fixtures.ts`). `web/e2e/baseline.spec.ts` is created and removed inside
  T001 and must not be committed.
- No two packages in the same wave own the same file.

### Notes

- The narrow verify commands are deliberate: see R-F for the intentionally-red window between W2 and
  W4. The full `npm test && npm run typecheck` is the gate for WP8 and WP9; the full e2e matrix is
  the gate for WP10; the orchestrator's verify phase runs both again at the end, plus
  `docker compose run --rm api npm test` to prove the API untouched (FR-023).
- `npm run build` and `npm run typecheck` are repo-wide (`tsc --noEmit`). If a package in a
  parallel wave fails typecheck **only** because of a sibling package's in-flight file, re-run the
  verify after the wave completes — never edit a file the package does not own to go green.
- No package starts, stops or restarts the stack. Every command is `docker compose run --rm …`.
- No dependency is added and `web/package.json` is never edited (FR-025).
- **SC-007** is owned by T069 (WP10) against the baseline T001 (WP1) records in R-G; **SC-002** by
  T005 (WP1); **SC-004** by T042 plus `check-size.mjs`; **SC-008** by the rewrite-not-delete rule in
  T012, T014, T030, T035 and T050. No success criterion is left without a task.
