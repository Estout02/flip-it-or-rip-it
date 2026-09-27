# Surface Contract (008): where every 006/007 state lives now

This relocates — never removes — the states contracted in
`specs/006-web-client/contracts/ui-states.md` (S0–S15) and `specs/007-environment-badge/`
(FR-024). Copy is unchanged unless `contracts/copy-additions.md` says otherwise. Focus targets,
announcements, document titles, accessible names, the skip link, the label-in-name rule (WCAG 2.5.3)
and the S12 `aria-describedby` relationship all carry over exactly.

## The one thing that moves between breakpoints

The whole layout difference is **where the lookup group lives**. The lookup group is one ordered
block — the `Viewfinder` card (desktop, while scanning), the camera-unavailable notice when there is
one, `<LookupForm>` (label, input, Check, Scan, the cost `<details>`), and the `<p class="threshold">`
minimum-profit line. It renders:

- **< 1024 px** — inside the **resting sheet**, under the S0 explainer (the sheet metaphor, FR-001/2);
- **≥ 1024 px** — inside **`.col-lookup`**, exactly where it is today (FR-027, 006 US5).

Everything else keeps one home at both widths. `<main id="main" class="layout">` and the
`.col-result` wrapper are always rendered; `.col-lookup` and `.col-recent` are rendered **only at
≥ 1024 px**, because below that their contents are relocated into the sheet and the Recent sheet
(FR-024: relocated, not removed). App picks the breakpoint from one `use-media-query
('(min-width: 1024px)')` value, which drives the column rendering and `RecentList`'s presentation
together.

**Accepted cost**: crossing 1024 px re-parents (and so remounts) `<LookupForm>`, losing text typed but
not yet submitted, and re-running its desktop autofocus. Hoisting the draft query into App state
would avoid it and is deliberately *not* done — a window resize across the breakpoint mid-typing is
rare, and the alternative (two form instances, or duplicate `#lookup-input` ids) is worse.

## Document structure (narrow viewports, < 1024 px)

```html
<a class="skip-link" href="#lookup-input">Skip to lookup</a>
<div class="ground ground--camera|ground--static">        <!-- spec: Ground -->
  <video class="viewfinder__video" aria-hidden="true" playsinline muted autoplay>   <!-- camera only -->
  <div class="viewfinder__reticle" aria-hidden="true">                              <!-- camera only -->
  <p class="pill">Point at a barcode | Barcode found · {code}</p>                   <!-- camera only -->
</div>
<header class="chrome">                                   <!-- spec: Chrome; opaque --chrome-bg -->
  <h1 class="wordmark">Flip it or Rip it</h1>
  <p class="env-badge">Test data — eBay sandbox</p>       <!-- spec 007, non-production only -->
  <button class="chrome__btn" aria-haspopup="dialog">Recent</button>
  <button class="chrome__btn" aria-haspopup="dialog">Settings</button>
  <button class="chrome__btn">Cancel</button>             <!-- camera only: release and go static -->
</header>
<main id="main" class="layout">
  <div class="col-result">
    <section class="sheet sheet--resting|sheet--expanded">   <!-- no aria-labelledby: see below -->
      <div class="sheet__grabber" aria-hidden="true"></div>
      <div class="sheet__body">
        <!-- resting: the S0 explainer (h2#result-heading + body) then the LOOKUP GROUP -->
        <!-- expanded: <ResultPanel> keeps its own
             <section class="result" aria-labelledby="result-heading" | aria-label="Result" aria-busy> -->
      </div>
    </section>
  </div>
</main>
<dialog class="sheet sheet--full recent-sheet">…Recent…</dialog>   <!-- modal, < 1024 px -->
<dialog class="dialog settings">…Settings…</dialog>                <!-- modal, unchanged -->
<div role="status" aria-live="polite" class="visually-hidden"></div>
<div role="alert" aria-live="assertive" class="visually-hidden"></div>
```

`.col-lookup` and `.col-recent` are not rendered at this width.

## Document structure (desktop, ≥ 1024 px) — normative

Today's three-pane tree, restyled. The sheet **is** the result pane; the lookup group is back in the
left column; Recent is back in the right column. `<Header>`/`.chrome` and the ground are shared with
the narrow tree.

```html
<a class="skip-link" href="#lookup-input">Skip to lookup</a>
<div class="ground ground--static"></div>                  <!-- always static at this width -->
<header class="chrome">
  <h1 class="wordmark">Flip it or Rip it</h1>
  <p class="env-badge">Test data — eBay sandbox</p>        <!-- spec 007, non-production only -->
  <button class="chrome__btn" aria-haspopup="dialog">Settings</button>
  <button class="chrome__btn">Cancel</button>              <!-- only while the camera card is live -->
  <!-- NO Recent button: Recent is a visible column here (FR-026 is narrow-viewport behaviour) -->
</header>
<main id="main" class="layout">
  <div class="col-lookup">                                 <!-- the LOOKUP GROUP -->
    <div class="ground ground--camera ground--card">…</div> <!-- Viewfinder, only while scanning -->
    <form class="lookup">…label, #lookup-input, Check, Scan, cost details…</form>
    <p class="threshold">Minimum profit: … <button>Edit</button></p>
  </div>
  <div class="col-result">
    <section class="sheet sheet--expanded">                  <!-- no aria-labelledby: see below -->
      <div class="sheet__body">
        <!-- <ResultPanel>: keeps its own <section class="result" …> — idle | loading | result | error -->
      </div>
    </section>
  </div>
  <div class="col-recent">
    <section id="recent" class="recent" aria-labelledby="recent-heading" tabindex="-1">…</section>
  </div>
</main>
<dialog class="dialog settings">…Settings…</dialog>
<!-- no Recent dialog at this width -->
```

**Pinned desktop rules** (rules 7–8 apply at both widths)

1. **No resting/expanded distinction at ≥ 1024 px.** The sheet is permanently `view="expanded"`, so
   the middle pane always shows the result area — S0 explainer → loading → result/error — which is
   exactly what `ResultPanel` does today. `sheetView` stays in App state but App passes
   `desktop ? 'expanded' : sheetView`.
2. **The sheet is a pane, not a bottom sheet.** It needs one extra optional prop,
   `presentation?: 'bottom' | 'pane'` (default `'bottom'`): `'pane'` renders no grabber, pushes **no**
   history entry, and installs **no** Escape listener. Without this a desktop page load would push a
   history entry the user can never "go back" out of, and Escape would appear to do nothing.
3. **S0 and `#result-heading`.** The S0 explainer block (`h2#result-heading` + body, existing copy) is
   one shared component exported from `ResultPanel.tsx` and rendered by exactly one surface at a time:
   `ResultPanel`'s idle branch at desktop, the resting sheet at narrow widths. Invariant:
   `document.querySelectorAll('#result-heading').length` is **≤ 1 always**, and **exactly 1** in every
   state whose focus target is `#result-heading` — S0 and all result/error states. It is **0 while
   loading**, at both widths, exactly as today (the skeleton has `aria-label="Result"` and
   `aria-busy`, no heading). At narrow widths `ResultPanel` is mounted only while the sheet is
   expanded; at desktop it is always mounted and the resting explainer is never rendered.
4. **Recent.** `<RecentList presentation="pane">` renders today's `<section id="recent">` in
   `.col-recent`; the chrome Recent button and the Recent `<dialog>` do not exist at this width, and
   S8's "Your recent lookups are still here." button moves focus to `#recent` instead of opening a
   sheet (R9). FR-026's "reachable from every state" is satisfied by the column being permanently
   visible.
5. **The viewfinder card.** `<Viewfinder presentation="card">` renders at the **top of
   `.col-lookup`**, above the form, as a rounded `.ground.ground--camera.ground--card` — the same
   component, the same lifecycle, the same release triggers as the full-bleed ground. The full-bleed
   `.ground` outside `<main>` stays `ground--static` at this width.
6. **No dismissal control at ≥ 1024 px.** The panes coexist, so there is nothing to dismiss: the
   primary button stays "Check another" (existing S2 copy) and the "Scan the next one" link is a
   narrow-only control. `suspendedCode` is cleared when the app returns to the lookup-ready state —
   on sheet dismissal at narrow widths, on "Check another" at both.
7. **The labelled result region stays inside `ResultPanel`, not on `.sheet`.** `.sheet` is a styled
   container with no `aria-labelledby` and no `aria-label`; `ResultPanel` keeps emitting today's
   `<section class="result" aria-labelledby="result-heading">`, switching to `aria-label="Result"` +
   `aria-busy="true"` while loading. Putting the label on the sheet would leave a **dangling idref
   during S1** (loading has no heading) and would nest one labelled region inside another; keeping it
   where it is also keeps `e2e`'s `.result[aria-busy="true"]` assertion valid. `Sheet`'s `labelledBy` /
   `label` props stay available and are simply unused by the result sheet — the Recent `<dialog>` uses
   its own labelling, as today.
8. **006 US5 keeps passing unchanged.** `layout.spec.ts`'s `desktop: form, result and Recent side by
   side in three columns` test needs no edit: `.col-lookup`, `.col-result` and `.col-recent` all exist,
   in that order, on the first screen. The *phones* half of that test is the one that gets rewritten
   (those columns no longer exist at narrow widths, and the fixed Scan dock is gone) — the sheet
   inherits its "never covers the focused element" walk.

## Expanded-sheet content order (FR-003)

1. verdict capsule — dot + label (`h2#result-heading`, `tabindex="-1"`, the focus target)
2. item name (`matchedTitle`, 21 px/600, clamped to 2 lines with the existing "Show full title")
3. meta line — category, confidence badge, competition phrase (all existing copy)
4. net figure (`formatCents(profitCents)`, 38 px/600, tint) + caption ("in your pocket" /
   "out of pocket — a loss")
5. money rows separated by hairlines — "Sells for", "eBay fees", "Shipping", "What you paid"
6. reason sentence (immediately after the heading block in reading order — see the note below)
7. basis note
8. primary button
9. dismissal control

**Reading-order constraint (carried from 006):** the reason must remain the element that *follows*
`#result-heading` in DOM order, because focus lands on the heading and the reason is what a screen
reader reads next (asserted in `e2e/core.spec.ts` and `e2e/a11y.spec.ts`). So the capsule block emits
`h2#result-heading` → `p.verdict__reason` → then the item name, meta, figure and rows; visual order
is restored with CSS `order`/grid placement, never by moving the reason in the DOM.

## State map

| 006/007 state | New surface | Focus target | Announcement / title |
|---|---|---|---|
| **S0 empty** | `h2#result-heading` "Scan or type an item" + body, from the shared explainer component: **< 1024 px** at the top of the resting sheet, above the lookup group; **≥ 1024 px** in the middle pane (`ResultPanel`'s idle branch, as today) with the lookup group in `.col-lookup` | browser default < 1024 px; `#lookup-input` at ≥ 1024 px | none; title "Flip it or Rip it" |
| **S1 loading** | sheet expands, skeleton, `aria-busy="true"`; Check shows the spinner and `aria-disabled` | unchanged (stays on the submitter) | polite "Checking…" |
| **S2 FLIP / S3 FLIP_RISKY / S4 RIP** | expanded sheet, order above | `#result-heading` | title "{label} · Flip it or Rip it" |
| **S5 UNCERTAIN** | expanded sheet: capsule (dashed edge) + reason, **no net figure and no caption**, suggestions list, "Closest match: …", collapsed `<details>` "Show rough figures (unreliable)" | `#result-heading` | as above; no donate/recycle words anywhere |
| **S6 no market data** | expanded sheet: RIP capsule, overridden reason, **no net figure, no money rows**, sandbox sentence when non-production, "Check another" + "Try the item name instead" for barcode queries | `#result-heading` | as above |
| **S7 validation** | inline at the input, wherever the lookup group is: in the **resting** sheet < 1024 px (the sheet collapses if a scan produced it), in `.col-lookup` at ≥ 1024 px (nothing collapses); `aria-invalid` + `aria-describedby` | `#lookup-input` (or `#cost-input`) | assertive: the message |
| **S8 limit** | expanded sheet error panel; the recent line becomes a `<button class="btn-text">` with the same text, which opens the Recent sheet (< 1024 px) or focuses `#recent` (≥ 1024 px) | `#result-heading` | title unchanged; no Try again |
| **S9 / S10 / S11** | expanded sheet error panel + "Try again" | `#result-heading` | — |
| **S12 from history** | expanded sheet; the saved note and the test-data marker sit **on the sheet ground above the capsule**, and `#result-heading` keeps `aria-describedby` pointing at them | `#result-heading` | as S2–S6 |
| **S13 Recent** | modal `<dialog class="sheet sheet--full">` opened from the chrome (< 1024 px) / third column (≥ 1024 px). Heading, entries, accessible names, empty state, storage notice and the Clear-history confirm are unchanged. Close control label: "Close" | on open: `#recent-heading`; on close: the chrome Recent button | polite storage notice unchanged |
| **S14 Settings** | unchanged modal `<dialog>`, restyled | `#threshold-input`; returns to the opener | "Saved" polite |
| **S15 scanner (viewfinder)** | the **ground**, not a dialog: video + reticle + status pill; chrome Cancel releases the camera. At ≥ 1024 px the same component is the `.ground--card` at the top of `.col-lookup` | on entering the camera flow: the chrome **Cancel** button (the first chrome control after the pill) | polite "Scanned {code}. Checking…" on a read, `vibrate(50)`, unchanged |
| **S15 scanner (unavailable)** | a notice at the top of the lookup group — the resting sheet < 1024 px, `.col-lookup` at ≥ 1024 px: `h2` "Camera not available" + the existing denied/unsupported/no-camera body + "Type it instead" | the "Type it instead" button | assertive, unchanged; ground falls back to static |
| **007 badge** | chrome pill, neutral `--chrome-*` treatment, visible in every state including with a result sheet open; reserves its space so its arrival does not shift sheet content | n/a (non-interactive) | unchanged hidden explainer text |

## New states (added to the accessibility matrix)

| id | Description | Focus target |
|---|---|---|
| **N1** resting over static | no camera ever started: static ground, no reticle, no pill, no `<video>` in the DOM | as S0 |
| **N2** resting over live viewfinder | camera live, sheet at rest | chrome Cancel |
| **N3** result over live viewfinder | the frosted composite: sheet expanded over the camera | `#result-heading` |
| **N4** Recent over a result | Recent sheet open while the result sheet is expanded | `#recent-heading` |
| **N5** opaque fallback | `prefers-reduced-transparency: reduce` (CDP) and the no-`backdrop-filter` path | as N3 |
| **N6** keyboard open | resting sheet with the on-screen keyboard (visual-viewport shrink emulated) | `#lookup-input`, not obscured |

At the 1280 px project these states are still run, but they render in the **pane** layout: N2/N3 mean
"viewfinder card live in `.col-lookup`, result in the middle pane", N4 does not exist (Recent is a
column, so there is no dialog to open over a result — assert the column instead), N5 applies to the
pane's ground, and N6 is not applicable (no on-screen keyboard). No assertion should expect a bottom
sheet, a grabber or a dismissal control at that width.

## Behaviour contract

1. **Dismissal** (FR-004): visible control, `Escape`, and the back gesture (one `history.pushState`
   entry per expansion). Dragging is not implemented in this feature; the grabber is decorative.
2. **Dismissal focus** (US1-3, US2-5): camera ground → the chrome Cancel button; static ground → the
   emptied `#lookup-input`. Never `document.body`.
3. **No double lookups** (FR-010): the code that produced the open sheet is suspended; dismissing
   resumes decoding. A *different* code decoded while the sheet is open starts a new lookup and
   replaces the sheet content.
4. **Camera lifecycle** (FR-011): live behind an open sheet; released on page hide, chrome Cancel,
   focusing the input / typing, opening Recent or Settings, and unmount; resumed on return to a
   visible page without a new permission prompt.
5. **Stale results** (edge case): a lookup that resolves after dismissal is stored in history,
   announced as usual, and does **not** re-expand the sheet or move focus.
6. **Skip link**: `href="#lookup-input"` is kept, with a click handler that first returns the sheet to
   rest and then focuses the input, so the target always exists.
7. **Sheet never obscures focus** (FR-006, WCAG 2.4.11): the sheet scrolls internally
   (`overflow-y: auto; overscroll-behavior: contain`), grows to `min(100dvh - var(--kb-inset), …)`,
   and the page below it gets matching `scroll-padding-block-end`.
8. **Reduced motion** (FR-020): no rise, slide or fade; the state simply exists.
9. **Zero horizontal scroll** from 320 px to 1920 px and at 400 % zoom, in every state (SC-005).

## Accessibility acceptance (per state)

For S0–S15 **and** N1–N6, at 320 / 390 / 1280 px, in light and dark, plus forced-colors for the
result states:

1. axe-core (`wcag2a`, `wcag2aa`, `wcag21aa`, `wcag22aa`) → **0 violations**;
2. **no `color-contrast` entry in axe's `incomplete`** for any state without a live `<video>`; for the
   camera states, a second axe run with the `<video>` hidden (the `#000` ground remains) must also be
   clean — this is what makes the worst-case composite an *asserted* fact and not a comment
   (see research R5);
3. `document.documentElement.scrollWidth <= clientWidth`;
4. the state's focus target is `document.activeElement`, before and after axe runs;
5. every visible interactive element ≥ 44 × 44 CSS px (inline prose links exempt at 24 px height);
6. every chrome element's computed `background-color` has alpha = 1;
7. the four verdicts differ by label text **and** `data-icon`, and the UNCERTAIN capsule's computed
   `border-style` is `dashed` while the others are `solid`.
