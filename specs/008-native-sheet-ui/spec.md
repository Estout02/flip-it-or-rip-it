# Feature Specification: Native Sheet UI

**Feature Branch**: `008-native-sheet-ui`

**Created**: 2026-09-26

**Status**: Draft

**Input**: User description: "Restyle the existing web client to the 'native sheet' design direction the founder selected from a design lookbook … the camera never leaves; the result rises as a frosted sheet over the live viewfinder, so the next scan is a dismiss away … It should read as a well-made native iOS app rather than a themed web page. No API changes, no new runtime dependencies, no web fonts; the 100 KB gzip budget and WCAG 2.2 AA still bind."

## Background

The web client shipped in spec 006 works and is accessible, but it looks like a form: a header, a
card with an input, a card with the result, a card with Recent. Every scan is a round trip through a
modal camera dialog that opens, closes, and hands you back to the page you were already on. The
founder reviewed a design lookbook on 2026-09-26 and chose **"the native sheet"**: the viewfinder
owns the screen, and the verdict rises over it as a frosted bottom sheet. Dismissing the sheet is
the same gesture as asking for the next item, so a stack of twenty books never leaves the camera.

Nothing about the valuation changes. This feature changes only what the client looks like, how the
result arrives, and where the secondary surfaces (Recent, settings, the sandbox badge) live. The API,
the verdict math, the lookup rules, the device-local storage and the honesty duties from 006 and 007
are untouched.

Two things make this harder than a repaint:

1. **Legibility over a picture we do not control.** A translucent sheet is only as legible as
   whatever the camera happens to be pointing at. Contrast against a "frosted light" ground is not a
   fixed number unless the design pins it down, so this spec pins it down (see *Color contract*) and
   states adjusted values where the lookbook's colors do not survive measurement. The gating risk in
   this feature is accessibility, not styling.
2. **The typing path must not pay for the camera.** Today the barcode decoder and the camera start
   only on the first Scan tap (constitution II, 006 FR-019). A design whose hero is a live
   viewfinder must not quietly make the camera the price of admission for someone who types an ISBN
   or who has no camera at all.

## Clarifications

### Session 2026-09-26

- Q: The chosen tints cannot meet AA over a `.82` frosted ground — which trade do we take? → A: Raise the sheet ground to `.95` and keep the chosen tints (worst-case composite `#EEEEEE`); the camera reads as a faint blur through the sheet and stays fully visible around it.
- Q: Does the native sheet ship a dark counterpart, or force a light appearance? → A: Ship the dark counterpart — dark glass `rgba(28,28,30,.95)` with tints `#38D39B` / `#F0B357` / `#A9B0BD` / `#9EA4F5`. 006 FR-017 stands and the dark half of the axe matrix stays.
- Q: While a result sheet is open, what happens to the camera? → A: It stays live so the next scan is instant and permission is never re-prompted; released on tab hide and on leaving the flow. Battery drain and the recording indicator are accepted trades.
- Q: At 1024 px and wider, does the sheet metaphor apply or does the multi-pane layout stay? → A: Restyle the existing three-pane desktop layout; the sheet metaphor stays a narrow-viewport behavior.
- Q: Where does Recent live now that the sheet owns the bottom of the screen? → A: Its own full-height sheet, opened from a control in the viewfinder chrome, reachable even behind an open result; the daily-limit error's recent line opens it.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Scan, read, dismiss, scan again (Priority: P1) 🎯 MVP

A reseller with a crate of books taps Scan once. The viewfinder fills the screen with a
corner-bracket reticle and a small status pill. They hold a book up; the pill confirms the code, and
the verdict rises from the bottom as a frosted sheet: verdict capsule, item name, the money, the
reason, one primary action. They read it, flick the sheet away (or tap "Scan the next one"), and the
viewfinder is already there for the next book. No page transitions, no back button, no camera
restart between items.

**Why this priority**: This is the direction the founder chose, and the loop it creates — one tap in,
then dismiss-and-scan — is the speed promise from the project brief made visible.

**Independent Test**: With a fake camera feeding two different barcodes in sequence, one Scan tap
produces two verdicts with no further taps other than dismissing the first sheet, and the camera is
never re-authorized.

**Acceptance Scenarios**:

1. **Given** the camera is running, **When** a barcode is decoded, **Then** the status pill reads
   "Barcode found · {code}", the lookup starts immediately, and the sheet appears carrying the
   loading state and then the result — the viewfinder is never replaced by a full-page result.
2. **Given** a result sheet, **When** it is shown, **Then** its content appears in this order:
   verdict capsule (dot plus label), item name, meta line, the net figure with its caption, the
   money rows, the reason, the primary button, and the dismiss link beneath it.
3. **Given** a result sheet, **When** the user dismisses it (the "Scan the next one" control, the
   Escape key, or the back gesture — drag is deferred, see FR-004 and the Assumptions), **Then** the sheet leaves, the
   viewfinder is live and decoding again, and focus lands on a control on the viewfinder — never on
   nothing.
4. **Given** a result sheet, **When** the user has a keyboard or switch access only, **Then** every
   action including dismissal is reachable without a drag gesture.
5. **Given** the sheet is open, **When** the same code stays in front of the camera, **Then** no
   second lookup fires for it while the sheet for it is still shown.
6. **Given** a result arrives, **When** it is announced, **Then** the verdict reaches assistive
   technology exactly as it does today (focus moves to the verdict heading inside the sheet).

---

### User Story 2 - I never turn the camera on (Priority: P1)

A seller on a laptop, on a phone with the camera blocked, or on a phone they simply do not want to
point at anything, types an ISBN and taps Check. They get the same sheet, the same numbers and the
same legibility, and nothing ever asks for the camera.

**Why this priority**: Typing is the path that works on every device and the path assistive-technology
users rely on (006 US1). A camera-first redesign that degrades it would be a regression in the
product's most important flow.

**Independent Test**: With `getUserMedia` absent and with the barcode decoder chunk blocked, the full
loop (type → verdict → check another) completes; no camera permission is requested; the initial
download still contains no decoder.

**Acceptance Scenarios**:

1. **Given** a cold load, **When** the app becomes interactive, **Then** no camera permission is
   requested and no decoder is downloaded; the space behind the sheet is a static neutral ground
   (a flat tone, no image, no video element), and no reticle and no status pill are shown.
2. **Given** the camera has never been started, **When** the user looks at the resting state,
   **Then** the sheet is at its resting height and holds the lookup input, the Check action, the
   optional "What I paid" field, the minimum-profit line, and the Scan action where scanning is
   possible.
3. **Given** a typed lookup, **When** the result arrives, **Then** the sheet expands to the result
   with the same content and behavior as US1, over the static ground.
4. **Given** the device cannot scan (no camera, blocked, or no decoder), **When** the user is in the
   resting state, **Then** the Scan action is absent or explains itself exactly as it does today, and
   the ground stays static. There is never a dead end.
5. **Given** the user dismisses a result on the typed path, **When** the sheet returns to rest,
   **Then** focus is in the emptied input, ready for the next item.

---

### User Story 3 - Legible on the worst day (Priority: P1)

Someone who prefers reduced transparency, someone whose browser does not support backdrop blur,
someone in forced-colors mode, someone at 400% zoom, and someone whose camera is pointed at a black
sofa all read the same verdict with the same ease.

**Why this priority**: Constitution VIII gates this feature. A frosted sheet is the single riskiest
accessibility decision in the product so far, because its background is user-supplied.

**Independent Test**: The axe matrix from 006 passes with zero violations across every screen state,
at 320/390/1280 px, in both color schemes, plus forced-colors for the result states — and a contrast
check over the *worst-case* sheet ground passes for every token pair in the color contract.

**Acceptance Scenarios**:

1. **Given** a browser without backdrop-filter support, or a user who prefers reduced transparency,
   **When** the sheet is shown, **Then** its ground is fully opaque and every ratio in the color
   contract still holds. The ground is never transparent.
2. **Given** a user who prefers reduced motion, **When** the sheet arrives or leaves, **Then** there
   is no rise, slide or blur transition — it is simply there, and no information depends on the
   animation.
3. **Given** forced-colors mode, **When** any state is shown, **Then** the sheet, the capsule, the
   rows and the buttons keep visible edges, and the verdict is still carried by text plus icon.
4. **Given** 400% zoom on a 1280 px viewport, or a 320 px phone, **When** a result is shown,
   **Then** the sheet can occupy the full height, scrolls internally without loss of content, and
   there is no horizontal scrolling.
5. **Given** the camera points at a dark scene, **When** a result sheet is over it, **Then** all
   sheet text meets its required ratio (measured against the darkest ground the sheet can composite
   to), and no text is rendered in a tint at body size.
6. **Given** any state, **When** the user tabs through it, **Then** the focus indicator is visible
   against both the sheet and the viewfinder, and the sheet never obscures the control that has
   focus.

---

### User Story 4 - "Can't tell" and "nothing for sale" are not "rip it" (Priority: P2)

An ambiguous query returns UNCERTAIN. The sheet says the app could not identify the item, in its own
color and with its own shape, and never suggests donating or recycling. A no-market result likewise
explains itself rather than showing a confident zero.

**Why this priority**: The honesty duty from 006 (FR-004) is easy to lose in a redesign that reduces
every result to one tint token and one big number.

**Independent Test**: The UNCERTAIN state shows its own tint and dashed capsule, no net figure in the
hero position, no donate or recycle wording, and the figures only inside a collapsed disclosure.

**Acceptance Scenarios**:

1. **Given** an UNCERTAIN result, **When** the sheet is shown, **Then** the capsule uses the
   UNCERTAIN tint and a dashed edge, distinct from the RIP slate at a glance and in grayscale, and
   the label and reason are the existing verbatim copy.
2. **Given** an UNCERTAIN result, **When** the hero area is rendered, **Then** no net figure and no
   "in your pocket" caption appear; the suggestions list and closest-match line appear instead, and
   the figures stay inside the collapsed "Show rough figures (unreliable)" disclosure.
3. **Given** a no-market result, **When** the sheet is shown, **Then** there is no net figure and no
   money rows, the overridden reason is shown, and in a non-production environment the sandbox
   sentence from spec 007 is shown with it.
4. **Given** a result whose net figure is negative, **When** the hero is rendered, **Then** the
   figure carries a minus sign and its caption states the loss in words, so the sign is never the
   only signal.

---

### User Story 5 - Recent and the test-data badge still have a home (Priority: P2)

The sheet owns the bottom of the screen, so Recent cannot live under it. A control on the viewfinder
chrome opens Recent as its own full-height sheet; settings open the same way they do today; and the
sandbox badge sits in the chrome where it is legible over any camera image.

**Why this priority**: Both were delivered features (006 US4, 007). Losing either to the redesign
would be a regression, and the sandbox badge exists precisely to stop someone misreading test data.

**Independent Test**: From a result, the user opens Recent, selects a saved entry, sees it in full
with its saved-result note, closes it and is back where they started, with focus restored — keyboard
only. In sandbox mode the badge is visible in every state, including with a result sheet open.

**Acceptance Scenarios**:

1. **Given** any state, **When** the user activates the Recent control, **Then** Recent opens as a
   sheet over the ground with the existing heading, entries, accessible names, empty state, and
   Clear-history confirmation, and closing it restores focus to the control that opened it.
2. **Given** a saved entry, **When** it is selected, **Then** its full result is shown in the result
   sheet with the "Saved result, not refreshed." note and the test-data marker where applicable, and
   no lookup is spent.
3. **Given** a non-production environment, **When** any state is shown, **Then** the test-data pill
   is visible in the chrome at every width with the copy and assistive text from spec 007, legible
   over the live viewfinder, and it does not shift the sheet content when it arrives.
4. **Given** the daily-limit error, **When** the "Your recent lookups are still here." line is
   shown, **Then** it opens Recent directly (there is no longer an in-page anchor to scroll to).
5. **Given** the settings control, **When** it is activated, **Then** the existing settings dialog
   opens with its existing copy and focus behavior, restyled to the new tokens.

---

### User Story 6 - Desktop still uses the screen (Priority: P3)

A seller at a laptop sees the same visual language — the same tints, type and rounded surfaces —
without a phone-sized sheet stranded at the bottom of a 1440 px window.

**Why this priority**: 006 US5 committed to a real desktop layout, and desktop users are a minority
of the scanning flow but a real share of the typing flow.

**Independent Test**: At 1280 px the full loop works with the keyboard alone, nothing is
horizontally scrollable, and the axe matrix passes at desktop width.

**Acceptance Scenarios**:

1. **Given** a viewport ≥ 1024 px, **When** the app loads, **Then** the layout uses the width rather
   than a single bottom sheet, and the restyled surfaces keep the new tokens, radii and type scale.
2. **Given** a wide viewport, **When** a result arrives, **Then** focus and announcement behavior are
   unchanged from mobile.

### Edge Cases

- **The camera is pointed at something bright white, then something black**, while the sheet is open:
  the sheet's text contrast is verified against both composites, so nothing becomes unreadable
  mid-scan.
- **Backdrop blur is supported but slow** (low-end phone): the blurred region is limited to the
  sheet, is not animated continuously, and the viewfinder stays responsive enough to decode. If the
  device cannot sustain it, the opaque ground is an acceptable degradation.
- **The sheet is dragged**: dragging is an enhancement only; a single-pointer, non-path alternative
  exists for every sheet action (WCAG 2.5.7).
- **The on-screen keyboard opens** while the resting sheet holds the input: the input and the Check
  action stay visible and are not covered by the sheet's own chrome.
- **A very long item name**: clamped to two lines with the existing disclosure to reveal the rest;
  the net figure and rows never shift off-screen.
- **The tab is backgrounded with the camera live behind an open sheet**: the camera is released, and
  it resumes when the user returns, without re-prompting.
- **Permission is denied after the first Scan tap**: the existing "Camera not available" copy is
  shown, the ground falls back to static, and the typing path continues to work.
- **A result arrives after the user has already dismissed the sheet**: the stale result does not
  re-open the sheet.
- **An error (limit, unavailable, offline, unexpected) arrives**: it is presented inside the sheet
  with its existing copy, heading and focus target; validation errors stay inline at the input in
  the resting sheet.
- **Text spacing overrides** (WCAG 1.4.12) applied to the sheet: the capsule, rows and caption
  reflow without clipping.
- **Grayscale printing / color-blind viewing**: all four verdicts are distinguishable without hue,
  by label, icon and capsule shape.

## Requirements *(mandatory)*

### Functional Requirements

**Sheet and layout**

- **FR-001**: The result MUST be presented in a bottom sheet over a persistent ground, with rounded
  top corners (~22 px), a grabber affordance, a soft upward shadow, and no page-level navigation
  between the ground and the result.
- **FR-002**: The sheet MUST have a resting presentation that carries the lookup controls (input,
  Check, the optional cost field, the minimum-profit line, and Scan where available) and an expanded
  presentation that carries the result, loading state or error. Moving between them MUST NOT unmount
  the ground or restart the camera.
- **FR-003**: Sheet content order for a normal result MUST be: verdict capsule (dot + label), item
  name, meta line, net figure with caption, money rows separated by hairlines, reason, primary
  button, dismiss link.
- **FR-004**: The sheet MUST be dismissible by at least: a visible text link, the Escape key, and
  the back gesture. A drag gesture MAY be offered in addition but MUST NOT be the only means
  (WCAG 2.5.7).
- **FR-005**: When sheet content exceeds the available height (small screens, 400% zoom, 200% text),
  the sheet MUST grow up to the full viewport height and scroll internally, with no content loss and
  no horizontal scrolling at any width from 320 px.
- **FR-006**: The sheet MUST NOT obscure a focused control (WCAG 2.4.11), including when the
  on-screen keyboard is open.

**Viewfinder and camera**

- **FR-007**: The viewfinder MUST show a corner-bracket reticle and a status pill. The pill reads
  "Point at a barcode" while searching and "Barcode found · {code}" on a successful decode.
- **FR-008**: When the camera has never been started, is unavailable, or has been released, the
  ground MUST be a static neutral tone with no reticle and no status pill, and the app MUST NOT start
  the camera or download the decoder to render it.
- **FR-009**: The camera and the decoder MUST continue to load only on an explicit Scan action; the
  initial download MUST NOT include the decoder (unchanged from 006 FR-019).
- **FR-010**: While a result sheet is open over a live viewfinder, decoding MUST be suspended for
  the code that produced the open sheet, so dismissing and re-pointing cannot double-charge a lookup.
- **FR-011**: Behind an open result sheet the camera stream MUST stay live, so dismissing the sheet
  returns to a viewfinder that is already decoding and no permission is re-requested. It MUST be
  released when the page is hidden, when the user leaves the scanning flow (typing, Recent, settings
  or an explicit cancel), and when the tab is closed; returning to a released stream MUST resume it
  without a new permission prompt where the browser allows it.
  - **This amends 006 FR-009**, which requires the camera to stop as soon as a code is read. That
    requirement is superseded for the read-a-code case only: the camera now stops on page hide,
    cancel, or leaving the flow, not on a successful decode. The 006 unit and e2e assertions that
    the stream stops on decode MUST be updated to assert the new lifecycle rather than deleted.
  - **Accepted trade**: battery drain while a verdict is being read, and the platform recording
    indicator stays on for the life of the sheet. The founder accepted both for an instant next
    scan (2026-09-26).
- **FR-012**: Camera imagery MUST never leave the device (unchanged from 006 FR-010), and no frame
  may be stored in history or settings.

**Color, contrast and type**

- **FR-013**: All sheet color tokens MUST be verified against the **worst-case composited ground** —
  the sheet's translucent ground over a fully black backdrop — not against its nominal color, and the
  verification MUST be automated in the test suite so a later token edit cannot silently break it.
  Required ratios: 4.5:1 for text below the large-text threshold, 3:1 for large text (≥ 24 px at
  weight 600) and for UI component boundaries and focus indicators.
- **FR-014**: The color contract below is normative. Values adjusted from the lookbook are marked;
  implementation MUST use the adjusted values.

  *Light scheme — sheet ground `rgba(250,250,251,.95)` with `blur(26px) saturate(1.5)`; worst-case
  composite `#EEEEEE`; opaque fallback ground `#F4F4F7`.* The ground is `.95` rather than the
  lookbook's `.82` because `.82` cannot carry the chosen tints at AA (founder decision,
  2026-09-26): the camera reads as a faint blur through the sheet and stays fully visible around it.

  | Token | Value | Used for | Measured (worst-case ground) |
  |---|---|---|---|
  | ink | `#0A0A0B` | headings, item name, money rows, capsule label | 17.06:1 |
  | secondary | `#636872` *(adjusted from `#6B7079`, 4.29:1 — fails)* | meta line, captions, basis note | 4.82:1 |
  | hairline | `rgba(10,10,11,.12)` | row dividers, sheet edge — decorative only, never the sole carrier of meaning | 1.29:1 (decorative) |
  | tint FLIP | `#0E8F6E` | net figure, capsule dot, accents (large text / UI only) | 3.50:1 |
  | tint FLIP_RISKY | `#B07000` *(adjusted from `#C07A00`, 3.00:1 — no headroom)* | as above | 3.51:1 |
  | tint RIP | `#5F6672` | as above | 4.99:1 |
  | tint UNCERTAIN | `#4A4FBF` | as above | 5.72:1 |
  | fill FLIP | `#0C7F62` | primary button (white label) | 4.97:1 vs `#FFFFFF` |
  | fill FLIP_RISKY | `#965F00` | as above | 5.34:1 vs `#FFFFFF` |
  | fill RIP | `#5F6672` | as above | 5.78:1 vs `#FFFFFF` |
  | fill UNCERTAIN | `#4A4FBF` | as above | 6.64:1 vs `#FFFFFF` |
  | capsule fill | tint at 14% over the opaque ground (e.g. FLIP `#D4E6E4`) | verdict capsule background; label is ink | ink 14.7–15.4:1 |
  | focus ring | `#1D4ED8` on the sheet, `#8AB4FF` on viewfinder chrome | focus indicator | 5.78:1 / 8.15:1 |
  | chrome ground | opaque `#1C1C1E` with `#F5F5F7` text | status pill, header controls, badge over live video | 15.63:1 |

  *Dark scheme — ground `rgba(28,28,30,.95)`; worst-case composite `#272729`; opaque fallback
  `#17171A`; ink `#F5F5F7` (13.69:1); secondary `#A0A6B0` (6.09:1); tints FLIP `#38D39B` (7.78:1),
  FLIP_RISKY `#F0B357` (8.02:1), RIP `#A9B0BD` (6.84:1), UNCERTAIN `#9EA4F5` (6.45:1); fills carry
  ink labels (≥ 8.5:1); capsule fill = tint at 18% over the opaque ground (ink ≥ 11.3:1).* The dark
  scheme ships (founder decision, 2026-09-26): the lookbook is light-only, but 006 FR-017 stands, so
  both schemes follow the device preference and both halves of the accessibility matrix remain.

- **FR-015**: Text below the large-text threshold MUST NOT be rendered in a verdict tint anywhere.
  Tints appear as large text (the net figure), as opaque fills, and as non-informational accents
  only.
- **FR-016**: Chrome that sits over live video (status pill, header controls, sandbox badge) MUST
  have its own opaque ground; it MUST NOT rely on the video for contrast.
- **FR-017**: Typography MUST use the system stack only —
  `-apple-system, BlinkMacSystemFont, "SF Pro Text", "Helvetica Neue", system-ui, sans-serif` — with
  no web font and no icon font. The item name is 21 px / 600 with tight tracking; the net figure is
  38 px / 600 with tabular numerals; money in the rows is tabular and right-aligned. All sizes MUST
  remain usable at 200% text resize.
- **FR-018**: Verdict meaning MUST continue to be carried by label text and icon as well as color
  (constitution VIII), and the four verdicts MUST remain distinguishable in grayscale and in
  forced-colors mode. UNCERTAIN keeps a dashed capsule edge in addition to its own tint.

**Transparency and motion**

- **FR-019**: When `prefers-reduced-transparency: reduce` is set, or backdrop blur is unsupported,
  the sheet ground MUST be the opaque fallback color. A transparent or unspecified ground is never
  acceptable.
- **FR-020**: When `prefers-reduced-motion: reduce` is set, the sheet MUST appear and disappear with
  no rise, slide or fade, and no state MUST depend on animation to be understood.

**Copy**

- **FR-021**: All UI copy MUST come from `specs/006-web-client/contracts/ui-states.md`. Strings the
  new layout needs and that file lacks — the net-figure captions ("in your pocket" and its loss
  counterpart), the dismiss link ("Scan the next one"), the money row labels ("Sells for", "eBay
  fees", "Shipping", "What you paid"), and the status pill strings — MUST be added to that contract
  as part of this feature. No string may be invented inside a component.
- **FR-022**: Existing verbatim copy MUST NOT change meaning: the verdict labels and eyebrows, the
  UNCERTAIN and no-market reasons, the basis note, the competition phrases, the confidence badge, the
  error copy, the settings and Recent copy, and the spec 007 sandbox strings all carry over. Where
  the new layout replaces the old "Profit" row with the hero figure, the figure's caption MUST state
  the same fact in words (including for a loss).

**Preserved behavior (non-regression)**

- **FR-023**: There MUST be no change to the API, its request or response shape, the lookup rules,
  the verdict math, the device-local settings or the 50-entry history.
- **FR-024**: Every state and behavior contracted in 006 (S0–S15) and 007 MUST still exist with its
  focus target, its live-region announcement, its document-title update, the skip link, and its
  accessible names — relocated into the new surfaces, not removed. Recent's label-in-name rule
  (WCAG 2.5.3) and the saved-result `aria-describedby` relationship MUST survive.
- **FR-025**: There MUST be no new runtime dependency and no new external request; the redesign is
  markup, styles and component structure only.
- **FR-026**: Recent MUST be reachable from every state through a control in the viewfinder chrome,
  opening as its own full-height sheet — including while a result sheet is open — and the
  daily-limit error's recent reference MUST open that sheet rather than scroll to an anchor. Closing
  it MUST restore focus to the control that opened it.

**Desktop**

- **FR-027**: At viewports ≥ 1024 px the existing three-pane layout (lookup, result, Recent) MUST be
  retained and restyled with the new tokens, radii and type scale; the bottom-sheet metaphor is a
  behavior of narrower viewports only. 006 US5 (side-by-side panes, full keyboard loop, no
  horizontal scrolling) MUST continue to hold.

**Budget**

- **FR-028**: The initial download MUST stay ≤ 100 KB gzip as measured by the existing budget check,
  and the decoder MUST stay out of it.

### Key Entities

- **Ground**: what is behind the sheet — either the live viewfinder (with reticle and status pill) or
  the static neutral tone. One at a time; the sheet is unaware which.
- **Sheet**: the single surface that carries the resting lookup controls, the loading state, a
  result, or an error. Has a presentation (resting / expanded), a ground treatment (glass / opaque)
  and a dismissal.
- **Verdict tint set**: per verdict, a display tint, an opaque fill, a capsule fill and an icon.
  Selected by verdict, never by profit sign.
- **Chrome**: the overlay controls that sit on the ground — status pill, Recent, settings, sandbox
  badge — each on its own opaque ground.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: Automated accessibility audits report **0 violations** on every screen state from the
  006 contract (S0–S15, including each verdict, no-market, each error, settings, Recent, scanner
  fallback, and the new resting/expanded sheet states), at 320/390/1280 px, in both color schemes,
  and in forced-colors for the result states — in both the unit suite and the Playwright matrix.
- **SC-002**: Every token pair in the color contract passes its required ratio against the
  worst-case composited ground, verified by a check that runs in the test suite (not by hand).
- **SC-003**: Once the camera is open, a user completes a scan-to-verdict-to-next-scan cycle without
  any tap other than dismissing the sheet, and the second scan needs no new permission.
- **SC-004**: The typed path costs no camera: on a load where the user never taps Scan, zero camera
  permission prompts and zero decoder bytes are requested, and the initial download stays ≤ 100 KB
  gzip.
- **SC-005**: No horizontal scrolling at any width from 320 px to 1920 px, or at 400% zoom on a
  1280 px viewport, in any state.
- **SC-006**: All four verdicts remain distinguishable in grayscale and forced-colors (100% of
  states).
- **SC-007**: Time from submit to verdict on screen does not regress against the current client on
  the same fixture data.
- **SC-008**: The existing unit suite, the e2e matrix, the size budget and typecheck all pass in
  Docker, with no test deleted to accommodate the redesign (tests may be rewritten where a surface
  moved).

## Assumptions

- **Opacity versus palette (decided, see Clarifications).** Measured against the worst case, the
  lookbook's `rgba(250,250,251,.82)` ground cannot carry `#0E8F6E` (2.56:1) or `#C07A00` (2.19:1)
  even as large text, and its `#6B7079` secondary text reaches only 3.13:1. The ground is therefore
  `.95` (worst case `#EEEEEE`) and the palette is kept; the rejected alternative — holding `.82` —
  would have forced a much darker palette (green ≈ `#08543F`, amber ≈ `#7E5000`).
- **Dark scheme ships (decided, see Clarifications).** 006 FR-017 and the axe matrix both cover a
  dark scheme, so the sheet has a dark counterpart rather than a forced light appearance.
- **UNCERTAIN gets indigo `#4A4FBF`** (light) / `#9EA4F5` (dark) plus its dashed capsule edge — its
  own identity, adjacent to neither the RIP slate nor the FLIP green, and reading as
  "informational" rather than "worthless".
- **The sandbox badge becomes a neutral chrome pill** rather than the current blue one, so it cannot
  be confused with the UNCERTAIN indigo. Its meaning already rests on its text and icon, so nothing
  is lost.
- **The status pill is camera-only.** On the typed path there is no pill at all; the static ground
  carries the existing S0 explainer copy. Inventing a "camera off" pill would add a string and a
  worry where neither is needed.
- **Recent becomes its own sheet (decided, see Clarifications)**, opened from a chrome control,
  because the result sheet owns the bottom of the screen and an inline list beneath it would be
  unreachable without dismissing the result. On desktop it stays a visible column.
- **The resting sheet is where typing lives.** The lookbook shows only the result sheet; the input
  has to live somewhere, and putting it in the sheet at rest keeps one screen, keeps the thumb zone,
  and makes "expand to result / collapse to input" the only state change.
- **Desktop keeps a multi-pane layout (decided, see Clarifications)**, restyled with the new tokens,
  rather than a phone sheet centered in a wide window. 006 US5's keyboard loop and side-by-side
  Recent are preserved (FR-027).
- **This feature amends one earlier requirement**: 006 FR-009 ("the camera MUST stop when a code is
  read") is superseded by FR-011's lifecycle. Everything else in 006 and 007 is preserved as written.
- **Sheet drag is optional.** If the drag interaction costs more than it earns, the text link,
  Escape and back gesture are sufficient (FR-004).
- **English (US) only, US-dollar marketplace**, as in 006. No internationalization work here.
- **No API, no new dependency, no web font, no icon library** — the existing hand-written CSS and
  inline SVG icons carry the whole redesign.
- Out of scope: any change to valuation, liquidity, matching or caps; native apps; new screens
  (accounts, inventory, gamification); photo identification; animation libraries; a design-token
  build pipeline.
