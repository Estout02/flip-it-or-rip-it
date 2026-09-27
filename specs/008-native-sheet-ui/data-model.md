# Data Model: Native Sheet UI (008)

No API type changes (FR-023). No storage changes: `flip-or-rip:settings:v1` and
`flip-or-rip:history:v1` keep the 006 shapes, and `HistoryEntry` is untouched. What this feature adds
is **client-side view state** and a **token model**.

## 1. View state (all device-local, all in `web/src/app.tsx` unless noted)

```ts
/** Which surface is behind the sheet. Exactly one at a time (spec: "Ground"). */
type Ground =
  | { kind: 'static' }                                  // no camera started, unavailable, or released
  | { kind: 'camera'; lastCode: string | null }         // the <Viewfinder> is mounted
  | { kind: 'unavailable'; reason: 'denied' | 'no-camera' | 'unsupported' };

/** What the single sheet is presenting (spec: "Sheet"). */
type SheetView = 'resting' | 'expanded';

/** Which modal surface, if any, sits above the sheet. */
type Overlay = 'none' | 'recent' | 'settings';

/** One media query decides the whole layout difference (contracts/sheet-states.md). */
const desktop: boolean = useMediaQuery('(min-width: 1024px)');
```

| Field | Owner | Transitions |
|---|---|---|
| `ground` | App | `static` → `camera` on the Scan action (which mounts `<Viewfinder>`) → `static` on cancel / leaving the flow / page hidden / release (which unmounts it, aborting the stream); → `unavailable` when the Viewfinder reports `onFailure`. `lastCode` is set on each decode and drives the status pill |
| `sheetView` | App | `resting` → `expanded` on submit (typed or scanned) and on selecting a Recent entry; `expanded` → `resting` on dismissal (visible control, Escape, back gesture) and on the skip link |
| `overlay` | App | `none` ↔ `recent` (chrome control, S8 button) ↔ `settings` (chrome control, the minimum-profit "Edit" button); closing restores focus to the opener |
| `lookup` (`useLookup`) | `web/src/lib/use-lookup.ts` | **unchanged**: `idle → loading → success \| error` with the existing sequence guard |
| `desktop` | `web/src/lib/use-media-query.ts` | `matchMedia('(min-width: 1024px)')` plus its `change` listener. Decides three things together: whether `.col-lookup` / `.col-recent` render at all, whether the lookup group sits in `.col-lookup` or in the resting sheet, and whether Recent is a pane or a modal sheet |

**Invariants**

1. `sheetView === 'expanded'` does not imply a result: it may hold `loading`, a result, or an error.
   `lookup.shown` decides the content; `sheetView` decides visibility (R13).
2. A result that resolves while `sheetView === 'resting'` is stored in history and announced-as-usual
   by `use-lookup`, but does **not** re-expand the sheet and does **not** move focus.
3. `ground.kind === 'camera'` survives every `sheetView` change (FR-002, FR-011). Only the four
   release triggers change it.
4. `ground.kind !== 'camera'` ⇒ no reticle, no status pill, no `<video>` element in the DOM, and no
   decoder chunk requested (FR-008, FR-009).
5. `overlay !== 'none'` ⇒ the camera is released (leaving the scanning flow, FR-011) — Recent and
   Settings are places where the camera has no job.
6. `desktop === true` ⇒ the sheet is rendered `presentation="pane"` with `view="expanded"`
   **always**: the lookup group lives in `.col-lookup`, so the middle pane has nothing to collapse to.
   `sheetView` is still tracked (a narrow viewport may appear on resize) but is not read for rendering
   at that width, and no history entry or Escape listener is installed there.
7. At most **one** `#result-heading` exists at any moment, at any width: the shared S0 explainer is
   rendered by `ResultPanel`'s idle branch when `desktop`, and by the resting sheet when not — never
   both. It is absent only while loading, as today.
8. **There is no `starting` / `live` distinction in App state.** The Viewfinder's pinned props
   (`onCode`, `onFailure`, `suspendedCode`, `lastCode`, `presentation`) carry no "stream ready"
   callback, so App could never observe such a transition; readiness stays internal to the component,
   where it changes nothing observable (the reticle and pill render identically while the first frames
   arrive). FR-008's static ground is about the *absence of a camera session*, not about stream
   readiness, so nothing in the contracts needs the extra state — and a state App cannot set would
   leave an untestable branch in the reducer.

## 2. Scanner session (`web/src/scanner/detect.ts`)

```ts
type ScanHandle = {
  /**
   * Suppress ONLY this code: it will not be emitted again until resume(). Any other code decoded
   * while suspended is emitted normally (FR-010, contracts/sheet-states.md behaviour 3).
   */
  suspendFor(code: string): void;
  /** Clear the suppression and the debounce state, so the same code can fire again. */
  resume(): void;
};

startScan(
  video: HTMLVideoElement,
  onCode: (code: string) => void,
  signal: AbortSignal,
  makeDetector?: () => Promise<Detector>,
): Promise<ScanHandle>;
```

`signal.abort()` remains the only release: it stops every track and clears `video.srcObject`. The
formats (`ean_13`, `ean_8`, `upc_a`, `upc_e`), the native-then-ponyfill selection, the self-hosted
`locateFile` override and the 125 ms frame interval are unchanged.

## 3. Verdict tint set (spec: "Verdict tint set")

Per verdict, four values plus an icon, selected **by verdict, never by profit sign**:

| Verdict | display tint | opaque fill | capsule fill | icon | capsule edge |
|---|---|---|---|---|---|
| FLIP | `--tint-flip` | `--fill-flip` | `--caps-flip` | `tag` | solid |
| FLIP_RISKY | `--tint-risky` | `--fill-risky` | `--caps-risky` | `hourglass` | solid |
| RIP | `--tint-rip` | `--fill-rip` | `--caps-rip` | `heart-hand` | solid |
| UNCERTAIN | `--tint-unc` | `--fill-unc` | `--caps-unc` | `question` | **dashed 2 px** |

`web/src/lib/verdict-copy.ts#VERDICT_COPY` already carries `label`, `eyebrow`, `icon` and
`treatment`; `treatment` (`flip | risky | rip | unc`) keeps selecting the token quartet by class name
(`.capsule--flip` …). No new mapping table is introduced.

## 4. Design tokens (`web/src/styles/tokens.css`)

Exact values; every ratio measured under the rule pinned in `contracts/color-contract.md`
(composite → round each channel to an integer → compute luminance), which is what reproduces
`spec.md` FR-014 to the digit. Worst-case grounds are `#EEEEEE` (light sheet over black) and
`#272729` (dark sheet over white).

### Grounds and surfaces

| Token | Light | Dark | Notes |
|---|---|---|---|
| `--sheet-glass` | `rgba(250,250,251,.95)` | `rgba(28,28,30,.95)` | used only inside the `@supports` + `prefers-reduced-transparency: no-preference` block |
| `--sheet-blur` | `blur(26px) saturate(1.5)` | same | emitted with `-webkit-backdrop-filter` first (Safari < 18) |
| `--sheet-opaque` | `#F4F4F7` | `#17171A` | the default background; the FR-019 fallback |
| `--ground-static` | `#E7E7EC` | `#101012` | flat tone behind the sheet when there is no camera |
| `--viewfinder-bg` | `#000000` | `#000000` | behind the `<video>`; also what makes the e2e worst-case contrast check real |
| `--chrome-bg` | `#1C1C1E` | `#1C1C1E` | opaque in both schemes (FR-016) |
| `--chrome-fg` | `#F5F5F7` | `#F5F5F7` | 15.63:1 |
| `--chrome-secondary` | `#A0A6B0` | `#A0A6B0` | 6.95:1 |
| `--chrome-focus` | `#8AB4FF` | `#8AB4FF` | 8.15:1 |

### Ink, lines, state

| Token | Light | Dark | Measured on the worst-case ground |
|---|---|---|---|
| `--ink` | `#0A0A0B` | `#F5F5F7` | 17.06:1 / 13.69:1 |
| `--secondary` | `#636872` | `#A0A6B0` | 4.82:1 / 6.09:1 |
| `--hairline` | `rgba(10,10,11,.12)` | `rgba(245,245,247,.14)` | decorative (1.29:1) — never the sole carrier of meaning |
| `--control-border` | `#6B717A` | `#8A9099` | 4.24:1 / 4.64:1 (UI, ≥ 3:1) |
| `--focus` | `#1D4ED8` | `#8AB4FF` | 5.78:1 / 7.14:1 |
| `--danger` | `#B42318` | `#FF8A7A` | 5.67:1 / 6.51:1 |

### Verdict quartets

| Token | Light | on worst ground | Dark | on worst ground |
|---|---|---|---|---|
| `--tint-flip` | `#0E8F6E` | 3.50:1 (large/UI) | `#38D39B` | 7.78:1 |
| `--tint-risky` | `#B07000` | 3.51:1 (large/UI) | `#F0B357` | 8.02:1 |
| `--tint-rip` | `#5F6672` | 4.99:1 | `#A9B0BD` | 6.84:1 |
| `--tint-unc` | `#4A4FBF` | 5.72:1 | `#9EA4F5` | 6.45:1 |
| `--fill-flip` | `#0C7F62` | label 4.97:1 | `#08503C` | label 8.68:1 |
| `--fill-risky` | `#965F00` | label 5.34:1 | `#5E3C00` | label 9.09:1 |
| `--fill-rip` | `#5F6672` | label 5.78:1 | `#383D45` | label 10.04:1 |
| `--fill-unc` | `#4A4FBF` | label 6.64:1 | `#343A96` | label 8.80:1 |
| `--fill-label` | `#FFFFFF` | — | `#F5F5F7` | — |
| `--caps-flip` | `#D4E6E4` | ink 15.30:1 | `#1D3931` | ink 11.47:1 |
| `--caps-risky` | `#EAE2D4` | ink 15.39:1 | `#3E3325` | ink 11.31:1 |
| `--caps-rip` | `#DFE0E4` | ink 15.00:1 | `#313337` | ink 11.62:1 |
| `--caps-unc` | `#DCDDEF` | ink 14.73:1 | `#2F3041` | ink 11.91:1 |

Fills carry a 1 px border in the matching tint, which is what gives the dark fills a perceivable
boundary (6.45–8.02:1 against the worst ground; the dark fills themselves reach only 1.58:1 there).

**Structural token rules** (they are what keep the measured numbers true):

- Only `--ink` and the tints appear on a **light** capsule fill. `--secondary` there measures
  4.16–4.35:1, so the saved-result note (S12) and the test-data marker live on the sheet ground, not
  inside the capsule. (In dark the same pair reaches 5.03:1 — the rule is a light-scheme constraint.)
- A tint may be used for text only at ≥ 24 px (the WCAG large-text threshold at weight < 700) —
  in practice, the net figure alone — and otherwise only as an opaque fill, a border or a dot
  (FR-015).
- Chrome over live video uses `--chrome-*` exclusively and never inherits the sheet tokens (FR-016).

### Shape, space, type

| Token | Value |
|---|---|
| `--radius-sheet` | `22px` (top corners of the sheet) |
| `--radius-card` | `16px` |
| `--radius-pill` | `999px` |
| `--radius-sm` | `10px` |
| `--target` | `44px` (unchanged) |
| `--space-1 … --space-8` | unchanged 4 px scale |
| `--sheet-shadow` | `0 -1px 0 var(--hairline), 0 -12px 32px rgb(0 0 0 / .18)` |
| `--font` | `-apple-system, BlinkMacSystemFont, 'SF Pro Text', 'Helvetica Neue', system-ui, sans-serif` |
| `--text-name` | `1.3125rem` / 600 / `-0.01em` (21 px item name) |
| `--text-net` | `2.375rem` / 600 / `tabular-nums` (38 px net figure) |
| `--step--1 … --step-4` | unchanged (body copy, headings elsewhere) |
| `--kb-inset` | set at runtime from `visualViewport` (R8); default `0px` |

## 5. The contrast contract as data (`web/src/styles/contrast-contract.ts`, new)

The normative table becomes a small typed structure that the unit test consumes, so a token edit
fails a test instead of a review:

```ts
export type Requirement = 4.5 | 3;                 // body text | large text & UI
export type Ground =
  | { kind: 'worst' }                              // --sheet-glass over the worst backdrop
  | { kind: 'opaque' }                             // --sheet-opaque, the FR-019 fallback
  | { kind: 'chrome' }                             // --chrome-bg, opaque in both schemes
  | { kind: 'capsule'; treatment: Treatment }      // --caps-<treatment>
  | { kind: 'token'; name: string };               // any solid token, e.g. the --ink button fill
export type Pair = {
  /** The contract's row id: 'L1' … 'L30', 'D1' … 'D25', 'C1' … 'C4', 'NB1'. */
  id: string;
  /** CSS custom property names, resolved out of tokens.css at test time. */
  fg: string;
  on: Ground;
  need: Requirement;
  /** Omitted = scheme-independent, asserted in both (the C* and NB1 rows). */
  scheme?: 'light' | 'dark';
  /** Documented as decorative: recorded, never asserted. */
  decorative?: boolean;
  note?: string;
};
export const SCHEMES = ['light', 'dark'] as const;
export const GROUND_COMPOSITE = {
  // the translucent ground composited over the worst backdrop it can meet
  light: { glass: '--sheet-glass', over: '#000000' },
  dark: { glass: '--sheet-glass', over: '#FFFFFF' },
} as const;
export const CAPSULE_ALPHA = { light: 0.14, dark: 0.18 } as const;
/** 60 entries covering the contract's 61 rows (NB1 is one entry, asserted in both schemes). */
export const PAIRS: Pair[] = [ /* … */ ];
```

The test (`web/src/styles/contrast.test.ts`) reads `tokens.css` from disk, parses `:root { … }` and
the `@media (prefers-color-scheme: dark)` block, composites per `GROUND_COMPOSITE`, and asserts every
non-decorative pair in the scheme(s) that pair applies to. It also asserts that every token named in
a **scheme-specific** pair (the `L*` and `D*` rows, which carry `scheme`) **exists** in both blocks,
so a renamed token cannot silently drop out of the check. Scheme-independent pairs — the chrome rows
`C1`–`C4` and the neutral-button row `NB1` — are asserted to exist in `:root` only: `--chrome-bg`,
`--chrome-fg`, `--chrome-secondary`, `--chrome-focus` and `--viewfinder-bg` are declared once and
deliberately **not** redeclared in the dark block, because the chrome is opaque and identical in both
schemes (FR-016).
