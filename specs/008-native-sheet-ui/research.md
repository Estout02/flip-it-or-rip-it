# Phase 0 Research: Native Sheet UI (008)

Every version- or platform-dependent claim below was checked against reality on 2026-09-26:
installed packages inside the Docker containers, MDN browser-compat-data, and two live Chromium
probes run in the pinned Playwright image (`mcr.microsoft.com/playwright:v1.63.0-noble`,
Chromium 153.0.8010.12). Contrast numbers are computed, not estimated.

Installed versions (read from `node_modules` in `docker compose run --rm web`): preact 10.29.8,
vite 8.3.1, vitest 5.0.2, jsdom 29.1.1, axe-core 4.13.0, @axe-core/playwright 4.13.0,
@playwright/test 1.63.0, barcode-detector 3.2.2. No dependency is added by this feature.

---

## R1 — The result sheet is an in-page surface, not a `<dialog>`

**Decision**: The result sheet is a normal in-page element (`<main id="main" class="layout"><div class="col-result"><section class="sheet">`, keeping today's `.layout` / `.col-*` wrappers — R10).
Only **Recent** and **Settings** stay native modal `<dialog>`s.

**Rationale**: FR-026 requires the Recent control in the viewfinder chrome to be reachable *while a
result sheet is open*. `dialog.showModal()` makes everything outside the dialog inert, so a modal
result sheet would make the chrome (Recent, Settings, the sandbox badge, the cancel control)
unreachable — it would break FR-026 by construction. The sheet is also not a modal in meaning: it is
the app's primary surface, and the viewfinder behind it stays live and keeps decoding (FR-011).

**Consequences**: Escape and the back gesture must be wired by hand (R2), and focus is *managed*
rather than trapped. Recent-over-result becomes a modal dialog stacked above a non-modal sheet, which
is legal and works in Chromium (nested `showModal` for the clear-history confirm inside the Recent
dialog is also legal — assert it in e2e).

**Alternatives considered**: (a) modal `<dialog>` sheet — rejected, breaks FR-026; (b) `popover`
attribute — gives light-dismiss and Escape for free but also top-layer semantics and no reliable
focus-return contract in 2026 Safari, and light-dismiss on tap-outside would fight the viewfinder
tap targets; rejected.

---

## R2 — Dismissal: visible control + Escape + one history entry; drag is deferred

**Decision**: The sheet is dismissed by (1) a visible control in the sheet, (2) `Escape` (a `keydown`
listener on `document` active only while the sheet is expanded), and (3) the back gesture, via
`history.pushState({ flipSheet: true }, '')` when the sheet expands and `history.back()` /
`popstate` on dismissal — the same pattern the 006 scanner already uses successfully
(`web/src/scanner/scanner.tsx` `onPop`/`popped`). Drag-to-dismiss is **not implemented** in this
feature.

**Rationale**: FR-004 requires a non-drag path for every sheet action and explicitly makes drag
optional; the spec's own Assumptions say "if the drag interaction costs more than it earns, the text
link, Escape and back gesture are sufficient". A pointer-drag implementation would add
`pointermove`/`pointercancel` handling, a translate transition that must be disabled under reduced
motion, and a WCAG 2.5.7 single-pointer alternative for each gesture — cost without a requirement.
The grabber stays as a **visual** affordance (`aria-hidden="true"`), matching the lookbook.

**Alternatives considered**: implementing drag with a `pointerdown`-to-`pointerup` translate —
deferred, not rejected; it can be added later without changing any contract.

---

## R3 — Camera lifecycle: one long-lived stream, decoding suspended per code

**Decision**: `web/src/scanner/detect.ts#startScan` stops being "stop the stream on decode" and
returns a handle:

```ts
type ScanHandle = { suspendFor(code: string): void; resume(): void };
startScan(video, onCode, signal, makeDetector?): Promise<ScanHandle>
```

- **Suspension is per code, not global.** The frame loop keeps running and keeps emitting; only the
  code passed to `suspendFor(code)` is suppressed, and only until `resume()`. A *different* code
  decoded while the result sheet is open is emitted normally and starts a new lookup that replaces the
  sheet's content — that is the fast loop the design is for, and it is the reading FR-010 ("decoding
  MUST be suspended **for the code that produced the open sheet**") and
  `contracts/sheet-states.md` behaviour 3 both require. The existing "same value twice in a row"
  debounce is kept and is cleared by `resume()`, so re-pointing at the same item works.
  - *Superseded alternative*: an earlier draft of this note said the loop "emits nothing" while
    suspended, i.e. a global pause. That would have made the second item in a stack unreachable
    without first dismissing the sheet, which is the round trip this feature exists to remove; it is
    rejected, and `suspendFor`'s per-code contract is the pinned behaviour.
- `signal.abort()` remains the single release path: it stops all tracks and clears `video.srcObject`.
- The App releases the stream (aborts) on `visibilitychange → hidden`, on leaving the scanning flow
  (typing in the input, opening Recent or Settings, the chrome Cancel control) and on unmount, and
  re-acquires it on `visibilitychange → visible` if the user was scanning. Permission is not
  re-prompted: a granted camera permission persists per origin, so re-acquiring is silent.

**Rationale**: FR-011 amends 006 FR-009 — the stream must survive an open result sheet so the next
scan is instant, and FR-010 forbids a second lookup for the code that produced the open sheet. Both
are properties of the decode loop, not of the stream, so the fix belongs in `detect.ts`.

**Alternatives considered**: (a) keep stop-on-decode and restart the camera on dismissal — rejected:
`getUserMedia` costs 300–900 ms on a phone and a visible black flash, which is precisely the loop the
founder chose this design to remove; (b) `track.enabled = false` while the sheet is open — the
recording indicator stays on either way (the founder accepted that), and disabling the track adds a
re-enable path that can race with the decode loop; rejected as complexity without benefit.

**Test consequence (intentional, per the spec)**: `web/src/scanner/scanner.test.tsx`'s "a detected
code closes the dialog" and `web/e2e/*` assertions that the stream stops on decode are **rewritten**
to assert the new lifecycle (live through the sheet; released on hide / cancel / leaving the flow).
Nothing is deleted.

---

## R4 — Frosted ground: prefixes, fallbacks, and what actually guarantees legibility

**Decision**: the sheet ground is

```css
background: var(--sheet-glass);                   /* rgba(250,250,251,.95) light */
-webkit-backdrop-filter: var(--sheet-blur);       /* blur(26px) saturate(1.5) */
backdrop-filter: var(--sheet-blur);
```

wrapped so that the **opaque** ground is the default and the glass is opt-in:

```css
.sheet { background: var(--sheet-opaque); }       /* #F4F4F7 light / #17171A dark */
@supports ((backdrop-filter: blur(1px)) or (-webkit-backdrop-filter: blur(1px))) {
  @media (prefers-reduced-transparency: no-preference) {
    .sheet { background: var(--sheet-glass); backdrop-filter: var(--sheet-blur); … }
  }
}
```

**Verified facts**:

| Fact | Source | Result |
|---|---|---|
| `backdrop-filter` unprefixed in Safari | MDN BCD `css/properties/backdrop-filter.json` | Safari **18**; `-webkit-` prefix since Safari 9 → the prefix is **required** for the iOS 16.4–17.x targets from 006 |
| `backdrop-filter` elsewhere | same | Chrome 76, Firefox 103, Edge 79 |
| `prefers-reduced-transparency` | MDN BCD `css/at-rules/media.json` | Chrome/Edge **118**; Firefox 113 **behind a pref**; **Safari: not supported** (WebKit bug 175497) |
| `CSS.supports('-webkit-backdrop-filter', …)` in Chromium 153 | live probe | `false` (unprefixed `true`); the `or()` query is `true`, so the combined `@supports` is the correct gate |
| `color-mix`, `dvh`, `overscroll-behavior`, `:has()`, `visualViewport` | live probe | all supported in the test Chromium; `color-mix` is Baseline (Safari 16.2) so it is safe on the iOS 16.4 floor |
| `env(keyboard-inset-height)` | live probe | parses, but `navigator.virtualKeyboard` is absent → not usable; use `visualViewport` (R8) |

**The important consequence**: because iOS Safari does not expose "Reduce Transparency",
`prefers-reduced-transparency` cannot be the accessibility guarantee on the product's primary
platform. The guarantee is the **worst-case composite** (R5/R6): every token pair passes its required
ratio against the sheet ground composited over a fully black (light scheme) or fully white (dark
scheme) backdrop, so the frosted sheet is AA-compliant even with the camera pointed at the worst
possible image and even where the media query does not exist. FR-019's opaque fallback is then a
comfort and performance measure, not the thing that keeps text readable.

**Alternatives considered**: holding the lookbook's `.82` ground and darkening the palette — already
rejected by the founder in the spec's Clarifications; the measurements below confirm `.82` fails
(`#6B7079` → 3.13:1 measured by axe itself in the probe, matching the spec's stated 3.13).

---

## R5 — How the contrast claim is *automated* (FR-013, SC-002) — and why axe alone cannot do it

Two live probes settled this.

**Probe 1 — axe over a translucent sheet with no video present**: axe-core 4.13 *does* composite
`rgba()` backgrounds down the ancestor chain, and reports real violations. On a `rgba(250,250,251,.82)`
sheet over a black body it computed background `#CDCDCE` and failed `#6B7079` at 3.13:1. So axe is
not blind to translucency by itself.

**Probe 2 — the real 008 layout (sheet overlapping a `<video>` inside a black ground)**: every text
node in the sheet came back as **`incomplete`**, not pass and not violation:

```
h1 | Element's background color could not be determined because element contains an image node
.meta | … contains an image node
.net | … contains an image node
```

The existing suites assert only that `violations` is empty, so **with the camera live, axe silently
stops checking sheet contrast altogether** — exactly the silent regression FR-013 exists to prevent.
Hiding just the `<video>` (`display:none`, ground stays `#000`) restores axe's ability to composite,
and it then reports the real worst-case numbers and catches a tint used at body size:

```
VIOLATION .tintsmall  3.49 (#0e8f6e on #eeeeee, 15px)   ← FR-015 breach, caught
VIOLATION .risky-small 3.5 (#b07000 on #eeeeee, 15px)   ← FR-015 breach, caught
PASS h1     17.05 (#0a0a0b on #eeeeee)
PASS .meta   4.82 (#636872 on #eeeeee)
PASS .net    3.49 (#0e8f6e on #eeeeee, 38px → large text, 3:1)
```

(These are axe's own strings. axe **truncates** to two decimals where
`contracts/color-contract.md` rounds, so its 3.49 and 17.05 are the contract's 3.50 and 17.06 — the
same pairs, and the same composited ground `#eeeeee` this plan derives.)

**Decision — a three-layer check, all inside the test suite**:

1. **Unit token test** (`web/src/styles/contrast.test.ts`, new): reads
   `web/src/styles/tokens.css` as text, parses the `:root` and dark-scheme blocks into token maps,
   composites the translucent grounds over black (light) and white (dark), and asserts every pair in
   `web/src/styles/contrast-contract.ts` (new, mirrors `contracts/color-contract.md`) meets its
   required ratio. This is the guard that survives a token edit; it needs no browser and runs in
   `vitest`. Failure message prints token, pair, measured ratio and requirement.
2. **e2e axe, video hidden** (`web/e2e/a11y.spec.ts`): in the camera-live states, run the matrix
   twice — once as rendered (`violations` empty) and once with the `<video>` hidden so axe composites
   the sheet over the black ground (`violations` empty **and** no `color-contrast` entry in
   `incomplete`). A new `fixtures.ts` helper (`withVideoHidden`) does the toggle.
3. **e2e incomplete guard**: for every non-camera state, assert `incomplete` has no `color-contrast`
   node — so a future "decorative" translucent layer cannot quietly disable the check.

Plus two small assertions that axe cannot make:

- **FR-016**: every chrome element over the video (`.chrome`, status pill, badge, chrome buttons) has
  a computed `background-color` with **alpha = 1** (probe 2 showed axe returns `incomplete` for
  chrome text with no ground, so this must be asserted directly).
- **FR-019**: `Emulation.setEmulatedMedia` with
  `features: [{ name: 'prefers-reduced-transparency', value: 'reduce' }]` over a CDP session —
  **verified working** in the pinned Chromium: the sheet's computed background flipped from
  `rgba(250, 250, 251, 0.95)` to `rgb(244, 244, 247)` and `backdrop-filter` to `none`; resetting with
  `features: []` restored it. Playwright 1.63's `emulateMedia` has no option for this feature
  (checked `playwright-core/types/types.d.ts`: only `colorScheme`, `media`, `reducedMotion`,
  `forcedColors`, `contrast`), so the CDP route is required — the same `context.newCDPSession(page)`
  pattern the existing `axNode` helper already uses.

**The parser is already proved.** A throwaway run inside `docker compose run --rm web` parsed the
*current* `tokens.css` with the planned technique — brace-matched `:root` block, brace-matched
`@media (prefers-color-scheme: dark)` block merged over it, `--name: value;` regex, hex/`rgba()`
reader — and reproduced 006's documented ratios exactly: `--text` on `--bg` **16.41 / 16.26**,
`--text-muted` on `--surface` **6.86 / 7.72**, `--focus` on `--bg` **6.24 / 9.13**. The implementer
should follow that shape rather than a CSS-parser dependency.

**Alternatives considered**: (a) trusting the e2e axe matrix alone — rejected, proved blind with a
video present; (b) a standalone node script run from `npm test` like `check-size.mjs` — workable, but
a vitest test gives a better failure message, runs with the unit suite the implementer already runs,
and keeps one command; (c) a design-token build pipeline emitting verified pairs — explicitly out of
scope in the spec.

---

## R6 — Token values: measured, with the gaps in the spec's table closed

All ratios below were computed in the container with the WCAG relative-luminance formula under the
rule now pinned in `contracts/color-contract.md`: **composite the glass over its backdrop, round each
channel to an integer 0–255, then compute luminance**, reporting two decimals rounded half-up. That
rule reproduces `spec.md` FR-014 to the digit; measuring from an unrounded composite lands 0.01–0.03
low, which is where an earlier draft of this file and of the contract disagreed with the spec (3.49 vs
3.50, 5.75 vs 5.78, 7.11 vs 7.14). axe-core *truncates* instead of rounding, so an axe transcript may
print 3.49 for the pair this table calls 3.50 — the same measurement, not a conflict. Worst-case
grounds: **light** `rgba(250,250,251,.95)` over `#000` = **`#EEEEEE`**; **dark** `rgba(28,28,30,.95)`
over `#FFF` = **`#272729`**. Both match the spec.

**Confirmed from the spec's normative table** (light, on `#EEEEEE`): ink `#0A0A0B` **17.06**;
secondary `#636872` **4.82** (and the rejected `#6B7079` **4.29** — fails, exactly as FR-014 states);
tint FLIP `#0E8F6E` **3.50**; tint FLIP_RISKY `#B07000` **3.51** (the rejected `#C07A00` **3.00** — no
headroom); tint RIP `#5F6672` **4.99**; tint UNCERTAIN `#4A4FBF` **5.72**; white on fills `#0C7F62`
**4.97**, `#965F00` **5.34**, `#5F6672` **5.78**, `#4A4FBF` **6.64**; chrome `#F5F5F7` on `#1C1C1E`
**15.63**; focus `#1D4ED8` **5.78** on the sheet and `#8AB4FF` **8.15** on chrome. Dark (on
`#272729`): ink `#F5F5F7` **13.69**; secondary `#A0A6B0` **6.09**; tints **7.78 / 8.02 / 6.84 /
6.45**. **Every value in FR-014 reproduces.** (`#B07000` at 3.51 has only 0.51 of headroom over the
required 3 — a standing risk: it must not be nudged lighter.)

**Capsule fills, computed exactly** (tint at 14% over `#F4F4F7` light, 18% over `#17171A` dark) —
these become explicit hex tokens so the contrast test never has to resolve `color-mix`:

| Verdict | Light capsule | ink on it | Dark capsule | ink on it |
|---|---|---|---|---|
| FLIP | `#D4E6E4` | 15.30:1 | `#1D3931` | 11.47:1 |
| FLIP_RISKY | `#EAE2D4` | 15.39:1 | `#3E3325` | 11.31:1 |
| RIP | `#DFE0E4` | 15.00:1 | `#313337` | 11.62:1 |
| UNCERTAIN | `#DCDDEF` | 14.73:1 | `#2F3041` | 11.91:1 |

(The spec's stated ranges — light 14.7–15.4, dark ≥ 11.3 — reproduce exactly, and its example
`#D4E6E4` matches. The capsule hexes are themselves integer-rounded composites, so the test can
re-derive them from tint + alpha + `--sheet-opaque`.)

**Gap 1 — secondary text on a light capsule fill fails.** `#636872` on the capsule fills measures
**4.16 / 4.24 / 4.33 / 4.35** (worst: UNCERTAIN `#DCDDEF`; all under 4.5). **Decision**: keep the spec's normative `#636872`
(FR-014 says MUST) and make the capsule structurally text-light: per FR-003 the capsule carries only
the dot and the **ink** label; the saved-result note (S12) and the test-data marker move out of the
capsule onto the sheet ground, where secondary measures 4.82:1. This is a change from 006, where
`.verdict__saved` and `.env-note` sit *inside* the tinted band. The e2e axe matrix catches a
regression here automatically, because a capsule fill is an opaque color that axe can composite.
*Fallback if a later design needs muted text inside a capsule*: `#5C616B` measures 5.36:1 on the
ground and 4.63:1 on the worst capsule — a one-token change, flagged rather than taken now.

**Gap 2 — the spec gives no dark-scheme fill values**, only the claim "fills carry ink labels
(≥ 8.5:1)". Measured candidates: a bright-tint fill with an ink label is impossible in dark
(`#F5F5F7` on `#38D39B` ≈ 1.8:1), and a deep fill has an invisible boundary against the sheet
(`#08503C` on `#272729` = **1.58:1**, under the 3:1 of SC 1.4.11). **Decision**: deep fill + ink label +
a 1 px border in the verdict tint:

| Verdict | Dark fill | `#F5F5F7` label | Border (tint) vs worst ground | Border vs own fill |
|---|---|---|---|---|
| FLIP | `#08503C` | 8.68:1 | `#38D39B` 7.78:1 | 4.93:1 |
| FLIP_RISKY | `#5E3C00` | 9.09:1 | `#F0B357` 8.02:1 | 5.32:1 |
| RIP | `#383D45` | 10.04:1 | `#A9B0BD` 6.84:1 | 5.01:1 |
| UNCERTAIN | `#343A96` | 8.80:1 | `#9EA4F5` 6.45:1 | 4.14:1 |

All four labels clear the spec's ≥ 8.5:1 claim. Light fills need no border (their own edges measure
4.28 / 4.60 / 4.99 / 5.72 against the worst ground), but they get the same 1 px tint border for visual
symmetry.

**Gap 3 — the dark focus ring.** The spec lists `focus ring #1D4ED8 on the sheet`, which measures
**2.22:1** on `#272729` — a fail. **Decision**: `--focus` is `#1D4ED8` in light (**5.78**, the value
FR-014 states) and `#8AB4FF` in dark (**7.14**); chrome focus is `#8AB4FF` in both (**8.15** on
`#1C1C1E`). This matches the 006 dark token, so nothing new is introduced.

**Gap 4 — control borders inside the resting sheet** (the lookup input, secondary buttons) are not in
the spec's table but are UI components needing 3:1. 006's `--border-ui` measures only **3.30** (light
`#7C838C`) and **3.20** (dark `#6E757D`) against the new grounds. **Decision**: sheet control border is
`#6B717A` light (**4.24** worst ground, **4.48** on the opaque fallback) and `#8A9099` dark (**4.64**).

**Gap 5 — error text on the sheet**: 006's `--danger` survives unchanged — `#B42318` **5.67** light,
`#FF8A7A` **6.51** dark on the worst grounds.

**Gap 6 — the neutral primary button** (Check, Try again, the clear-history confirm) has no verdict, so
it takes an ink fill with a `--sheet-opaque` label: **18.03** light / **16.43** dark, and its boundary
against the worst-case ground is the ink pair itself (17.06 / 13.69), so it needs no border. Recorded
as row `NB1` in the contract.

**Decorative, by declaration**: the hairline (`rgba(10,10,11,.12)` → 1.29:1) divides money rows but
never carries meaning (each row has its own `dt`); the corner-bracket reticle and the capsule dot are
decorative (the pill text and the capsule label carry the meaning). The contrast contract records
them as decorative so the test does not assert a ratio it would have to fake.

**Large-text threshold, precisely**: WCAG large text is ≥ 18 pt (24 px) at any weight below 700, or
≥ 14 pt (18.66 px) at weight ≥ 700. The net figure (38 px / 600) is large text, so its **3.50:1** tint
is compliant against the 3:1 requirement (axe agreed on the classification: "28.5pt", and printed the
truncated 3.49). At weight 600, **nothing below 24 px may use a tint** — FR-015 in numbers.

---

## R7 — Type and motion tokens

**Decision**: `--font: -apple-system, BlinkMacSystemFont, 'SF Pro Text', 'Helvetica Neue', system-ui,
sans-serif` (FR-017, replaces 006's `system-ui`-first stack). The new sizes are **fixed rem, not
`clamp()` with `vw`**: item name `1.3125rem` (21 px) / 600 / `letter-spacing: -0.01em`; net figure
`2.375rem` (38 px) / 600 / `font-variant-numeric: tabular-nums`; money rows body size, tabular,
right-aligned.

**Rationale**: `clamp(..., vw, ...)` responds to page zoom but *not* to text-only resize; rem honours
both, which is what "usable at 200% text resize" requires. The 006 fluid steps stay for the existing
body copy so nothing else shifts.

**Motion**: the sheet's rise is a single `transform: translateY()` + `opacity` transition (220 ms,
`cubic-bezier(.32,.72,0,1)`), inside `@media (prefers-reduced-motion: no-preference)`. base.css
already neutralises animations under `reduce`, and `e2e/layout.spec.ts` already asserts nothing
animates longer than 1 ms under `reduce` — that test covers FR-020 once it points at the sheet.

---

## R8 — The on-screen keyboard must not cover the input (FR-006)

**Decision**: two complementary measures.

1. `web/index.html` viewport meta gains `interactive-widget=resizes-content` (Chromium 108+;
   ignored elsewhere), so on Android the layout viewport shrinks and the bottom-anchored sheet sits
   above the keyboard.
2. A 12-line hook, `web/src/lib/use-viewport-inset.ts` (new), subscribes to
   `visualViewport` `resize`/`scroll` (verified present in the probe; Baseline since Safari 13) and
   writes `--kb-inset: <px>` on `:root`, computed as
   `layoutHeight - (visualViewport.height + visualViewport.offsetTop)`, clamped at 0. The sheet uses
   `padding-block-end: max(env(safe-area-inset-bottom), var(--kb-inset))` and
   `max-block-size: calc(100dvh - var(--kb-inset))`.

**Rationale**: iOS Safari does not resize the layout viewport for the keyboard and does not implement
`interactive-widget`, so a `position: fixed` bottom sheet would be covered. `visualViewport` is the
only cross-browser signal. No dependency, and the hook is a no-op where `visualViewport` is absent.

**Alternatives considered**: `env(keyboard-inset-height)` — needs
`navigator.virtualKeyboard.overlaysContent`, absent in the probe and Chromium-only; rejected.
Putting the input outside the sheet (a fixed top bar) — rejected, it contradicts FR-002 and the
thumb-zone argument in the spec's Assumptions.

---

## R9 — Recent: a modal sheet below 1024 px, a pane at and above it

**Decision**: `RecentList` keeps ownership of the list, the empty state, the clear-history confirm and
the accessible names, and gains a `presentation: 'sheet' | 'pane'` prop. Below 1024 px it renders as
a full-height modal `<dialog class="sheet sheet--full">` (reusing `use-modal.ts` for Escape, focus
trap, inertness and focus return); at ≥ 1024 px it renders exactly as today, a `<section id="recent">`
in the third column. App picks the presentation with a new `web/src/lib/use-media-query.ts`
(`matchMedia` + `change` listener, SSR-safe default `false`).

The S8 rate-limit line "Your recent lookups are still here." becomes a `<button class="btn-text">`
with the identical visible text that opens the Recent sheet (FR-026) below 1024 px; at ≥ 1024 px,
where `#recent` is a visible column, it keeps today's anchor behaviour so the existing
"link lands on a labelled region" assertion still has a home. The close control reuses the existing
string **"Close"** (already in the settings dialog) — no new copy.

**Rationale**: FR-026 plus the existing WCAG 2.5.3 label-in-name test: changing the element from `a`
to `button` keeps the name identical, and `button` already inherits the 44 px min-height from
base.css so the target-size check keeps passing. Two DOM shapes by breakpoint need a JS media query
because a `<dialog>` cannot be un-modal by CSS.

**Test consequence (intentional, per the spec)**: `web/e2e/errors.spec.ts`'s
"`#recent` reaches Recent" test is rewritten for narrow viewports to assert the button opens the
Recent sheet, that focus lands inside it, and that closing restores focus to the button.

---

## R10 — Desktop keeps the three-pane layout; the viewfinder becomes a pane card

**Decision**: at ≥ 1024 px `layout.css` keeps the existing grid
(`minmax(18rem,22rem) minmax(0,1fr) minmax(16rem,20rem)`), restyled with the new tokens, radii and
type scale (FR-027), and the existing three-pane **markup** is kept too: `<main id="main"
class="layout">` with `.col-lookup` / `.col-result` / `.col-recent`. The pinned tree is in
`contracts/sheet-states.md` "Document structure (desktop)"; in summary:

- The **lookup group** — `Viewfinder` card (while scanning), the camera-unavailable notice,
  `<LookupForm>`, the minimum-profit line — is the only thing that changes parent by breakpoint:
  resting sheet below 1024 px, `.col-lookup` at and above it. One
  `use-media-query('(min-width: 1024px)')` value drives that and `RecentList`'s presentation.
- `.col-result` holds the sheet, which at this width is a **static pane**: `view` is permanently
  `'expanded'`, so the middle column always shows the result area (S0 → loading → result/error), which
  is what `ResultPanel` already does. `Sheet` therefore needs one extra optional prop,
  `presentation?: 'bottom' | 'pane'` (default `'bottom'`): the pane variant renders no grabber, pushes
  **no** history entry and installs **no** Escape listener — otherwise a desktop load would leave a
  history entry the user can never step back out of, and Escape would look broken.
- `.col-recent` holds `<RecentList presentation="pane">` (today's `<section id="recent">`); the chrome
  Recent button and the Recent dialog do not exist at this width, and S8's recent button focuses
  `#recent` (R9). There is no dismissal control at all, so "Check another" stays the primary action.
- `#result-heading` stays unique because the S0 explainer is one shared component rendered by exactly
  one surface per width — `ResultPanel`'s idle branch at desktop, the resting sheet at narrow widths.
- When scanning is active at desktop, the **same** `Viewfinder` component renders as a rounded card at
  the top of `.col-lookup` instead of a full-bleed ground — one camera implementation, one lifecycle,
  two placements by media query.

**The draft query is App state (founder decision, 2026-09-27 — this reverses the original note).**
Re-parenting remounts `<LookupForm>`, so App owns the query string and passes it down as a controlled
value.
  - *Superseded position*: the first version of this section accepted losing unsubmitted text and
    rejected hoisting as disproportionate, because it reasoned only about a **resize** across 1024 px.
    That was the rare path. The routine one is that below 1024 px the lookup group unmounts on **every
    sheet collapse** — after a validation error (S7 collapses to rest), after a dismissal, after a
    Recent selection — so a phone user lost the query they had just been asked to correct.
  - Holding one string in App also removes the `pendingFormAction` race between "set the scanned
    value" and "submit", which could fire a submit with an empty query.
  - Still rejected: two form instances or duplicate `#lookup-input` ids. Out of scope: the optional
    "What I paid" text (cleared on every submit) and the desktop autofocus re-running on remount,
    which matches S0's documented desktop behaviour.

**Rationale**: 006 US5 must keep holding (side-by-side panes, full keyboard loop, no horizontal
scroll), and a phone sheet centred in a 1440 px window was rejected by the founder. Keeping one
`Viewfinder` avoids a second camera code path, which is where lifecycle bugs live.

---

## R11 — Copy: what is added, and how the two dismiss controls are labelled

**Decision**: the strings the new layout needs are added to
`specs/006-web-client/contracts/ui-states.md` (FR-021) and mirrored in
`web/src/lib/verdict-copy.ts`; the exact text is in `contracts/copy-additions.md`. Summary:

- Net-figure captions: profit ≥ 0 → **"in your pocket"**; profit < 0 → **"out of pocket — a loss"**
  (FR-022 requires the loss to be stated in words as well as by the minus sign).
- Money rows: **"Sells for"**, **"eBay fees"**, **"Shipping"**, **"What you paid"**. This renames
  006's "Est. sale value" row and removes its "Profit" row, whose fact the hero figure plus caption
  now carries — both amendments are written into ui-states.md S2.
- Status pill: **"Point at a barcode"** (already `SCANNER_COPY.prompt`) and **"Barcode found · {code}"**.
- Dismiss control: **"Scan the next one"**.

**The one interpretation worth flagging**: FR-003 lists "primary button, dismiss link" for every
result, and FR-021 names the dismiss link "Scan the next one" — which is wrong copy on a device that
never opened the camera. **Decision**: the sheet always shows exactly one primary action and one
dismissal, chosen by ground:

| Ground | Primary button | Dismissal beneath it |
|---|---|---|
| Live viewfinder | "Scan the next one" (dismiss → viewfinder, decoding resumed) | "Check another" (text button: collapse to rest, clear and focus the input) |
| Static (typed / no camera) | "Check another" (existing S2 copy; collapses to rest, clears, focuses the input) | none needed — the primary *is* the dismissal; Escape and back still work (FR-004) |

Rationale: it invents exactly one string, keeps every existing string's meaning (FR-022), and never
offers a camera action on a device with no camera (US2-4). The alternative — always showing
"Scan the next one" — would put a camera instruction in front of laptop and blocked-camera users;
rejected. *Founder may overrule the labelling; nothing else in the plan depends on it.*

---

## R12 — Budget and performance (FR-028, SC-004, SC-007)

**Measured now** (`docker compose run --rm web sh -c "npx vite build && node scripts/check-size.mjs"`):
`index.html` 0.5 KB + JS 15.7 KB + CSS 4.4 KB = **20.6 KB gzip of a 100 KB budget**; the decoder wasm
is emitted as a hashed, self-hosted asset, and the scanner chunk stays out of the initial download.
Headroom is ~79 KB, so the redesign (CSS growth plus one small sheet component and two small hooks)
cannot plausibly threaten the budget; `check-size.mjs` continues to enforce it, including its
"initial chunk must not contain zxing/barcode-detector" assertion, which is what actually protects
SC-004.

**Performance**: blur is applied only to the sheet element and is not animated (the rise animates
`transform`/`opacity`, both compositor-only); the decode loop stays at the existing ≈8 fps
(`FRAME_INTERVAL_MS = 125`). SC-007 (no submit→verdict regression) is a render-path property — the
same fetch and the same state machine — and is checked in e2e with a fixture timing assertion rather
than a benchmark.

---

## R13 — Sheet visibility versus lookup state (stale results, focus theft)

**Decision**: App owns `sheetView: 'resting' | 'expanded'`. A submit or a Recent selection sets
`expanded`; dismissal sets `resting` **without aborting an in-flight lookup**. `ResultPanel` gains a
`visible` prop and only moves focus to the verdict heading when it is `true`, so a result that lands
after dismissal is written to history (Recent keeps it) but neither re-opens the sheet nor steals
focus. The same gate covers the narrow-width S1 focus move onto the `aria-busy` loading region
(`contracts/sheet-states.md` behaviour 11): it happens only while the sheet is visible, and the later
move to `#result-heading` supersedes it inside the same region. `use-lookup.ts` is unchanged — its
sequence-number guard already handles ordering.

**Rationale**: the spec's edge case "a result arrives after the user has already dismissed the sheet:
the stale result does not re-open the sheet". Aborting instead would waste a lookup the server has
already counted against the daily cap (constitution III).

---

## R14 — Proving grayscale and forced-colors distinguishability (SC-006, FR-018)

**Decision**: three cheap, deterministic assertions in the e2e matrix rather than an image diff:

1. Each verdict state exposes a **distinct label** (`#result-heading` text) and a **distinct icon**
   (`data-icon` attribute added to `Icon`, so the test reads a name, not a path).
2. The UNCERTAIN capsule's computed `border-style` is `dashed` while the other three are `solid`
   (the shape cue that survives grayscale).
3. The existing forced-colors runs for S2–S6 stay, extended to the new sheet states, and assert the
   capsule, rows and buttons keep a visible border (`border-width ≥ 1px`, colour `CanvasText`) — the
   006 forced-colors block already does this for `.verdict/.chip/.btn/.card`; it must be re-pointed
   at the new class names.

**Rationale**: a "grayscale" filter test would assert something no user setting produces; the real
requirement is redundancy of cue, which is structural and testable.

---

## R15 — How the "one tap, two verdicts" loop is tested without a real barcode (SC-003)

**Decision**: e2e feeds codes through a **stubbed native `BarcodeDetector`**, installed with
`page.addInitScript`, combined with the existing `fakeCamera` canvas stream:

```ts
// web/e2e/fixtures.ts — fakeDetector(page, ['9780345391803', '9780000000002'])
window.BarcodeDetector = class {
  static getSupportedFormats = async () => ['ean_13'];
  async detect() { return [{ rawValue: queue[Math.min(i, queue.length - 1)] }]; }
};
```

`detect.ts#createDetector` already prefers a native `BarcodeDetector` that reports `ean_13` support
and only falls back to the ponyfill otherwise, so this needs **no test hook in production code** —
the same trick `src/a11y.test.tsx` already uses in jsdom. A helper advances the queue on demand, so
one Scan tap can produce two verdicts with nothing between them but a dismissal, and the test can
assert `getUserMedia` was called exactly **once** across both scans (US1's independent test and
SC-003). Because the stub short-circuits the ponyfill, the wasm is never fetched and the e2e run
stays fast; the decoder's real absence from the initial download stays the job of `check-size.mjs`
(SC-004).

**Alternatives considered**: drawing a real EAN-13 bar pattern into the canvas so the ZXing ponyfill
decodes it — closer to production but fragile (module width, quiet zone, focus, frame timing) and
slow; rejected. A `window.__flipTestDetector` hook read by `detect.ts` — rejected, test-only code in
the shipped bundle.

---

## R16 — Which existing tests change (all rewrites, no deletions — SC-008)

| File | Change |
|---|---|
| `web/src/scanner/scanner.test.tsx` → `web/src/scanner/viewfinder.test.tsx` | rewritten for the new component: stream stays live on decode, released on hide / cancel / leaving the flow, `suspendFor`/`resume` behaviour, camera-failure notice |
| `web/src/scanner/detect.test.ts` | adds `ScanHandle` suspend/resume cases; the "stops tracks on decode" case becomes "stops tracks on abort" |
| `web/src/app.scanner.test.tsx` | drops the `.scan-dock` class assertion (the fixed dock is gone), asserts the viewfinder ground mounts on the first Scan tap and that the lazy chunk is still not loaded before it |
| `web/src/components/MoneyBreakdown.test.tsx` | new row labels ("Sells for" …), no "Profit" row, hero figure + caption incl. the loss caption |
| `web/src/components/ResultPanel.test.tsx`, `VerdictBanner.test.tsx`, `MatchDetails.test.tsx`, `RecentList.test.tsx`, `EnvBadge.test.tsx` | restructured markup: capsule vs item name vs meta line, saved note and test marker outside the capsule, Recent's two presentations |
| `web/src/a11y.test.tsx` | adds the new sheet states (resting over static, expanded, Recent sheet open over a result, camera-unavailable notice) |
| `web/src/app.test.tsx`, `app.env.test.tsx` | sheet-aware selectors; badge in the chrome |
| `web/e2e/a11y.spec.ts` | S15 states replaced by viewfinder/unavailable states; new sheet states; the video-hidden contrast pass; the `incomplete` guard; forced-colors on the new classes |
| `web/e2e/errors.spec.ts` | S8 recent reference is a button that opens the Recent sheet (< 1024 px) |
| `web/e2e/layout.spec.ts` | the "Scan bar never covers a focused control" walk becomes "the sheet never covers a focused control", including with the keyboard open; reduced-motion test re-pointed at the sheet |
| `web/e2e/core.spec.ts`, `env.spec.ts`, `offline.spec.ts` | selector and copy updates; Recent reached through its sheet below 1024 px |
| `web/e2e/fixtures.ts` | new helpers: `openRecent`, `withVideoHidden`, `emulateReducedTransparency` (CDP), `expectChromeOpaque`, `blackCamera`, `fakeDetector` (R15) |
| `web/src/styles/contrast.test.ts`, `web/src/styles/contrast-contract.ts` | **new** (R5) |

No test file is removed, and no assertion is dropped without an equivalent one in the surface that
replaced it.
