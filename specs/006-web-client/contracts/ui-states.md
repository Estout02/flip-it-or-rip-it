# UI State Contract (006)

This contract fixes every screen state: its copy, where focus goes, what is announced, and what
the tests check. Copy is final unless a test proves it is confusing. Tone: plain, second person,
no exclamation marks, and no shaming for RIP.

**Common to every result**: an `<section aria-labelledby="result-heading">`. `result-heading` is
the verdict label (an `h2`, `tabIndex=-1`). Below the breakdown sits the **basis note** (FR-005),
in muted text:

> Estimated from current eBay asking prices, adjusted toward typical sale prices. Competition counts similar active listings, not sales.

## Verdict treatments

| Verdict | Label (h2) | Eyebrow above label | Icon | Token pair |
|---|---|---|---|---|
| FLIP | **Flip it** | Worth selling | tag, arrow up | flip |
| FLIP_RISKY | **Flip it — slow seller** | Worth listing, expect to wait | hourglass | risky |
| RIP | **Rip it** | Not worth your time. Donate or recycle it. | heart in hand | rip |
| UNCERTAIN | **Can't tell** | We couldn't identify this item | question mark in a dashed circle | unc, plus a dashed 2 px border |

The reason sentence is the API `reason`, shown beneath the label, except where overridden below.

## States

### S0: Empty (first load)
- The result area shows a short explainer. Heading "Scan or type an item". Body: "You'll get a
  verdict — flip it or rip it — with the numbers behind it." There is no live announcement.
- Focus: the browser default. The input has `autofocus` **only on ≥ 1024 px** (on mobile, autofocus
  would pop the keyboard over the Scan button).

### S1: Loading
- The Check button shows a spinner (hidden under reduced motion; the text stays "Checking…") and has
  `aria-disabled="true"`. The result area shows a skeleton with `aria-busy="true"`.
- Polite announcement: "Checking…". Focus stays put.

### S2: FLIP / S3: FLIP_RISKY / S4: RIP (normal results)
- Banner (label, eyebrow, reason).
- **Net figure (hero)**: `formatCents(profitCents)` in the verdict tint at 38 px/600, with the
  caption "in your pocket" (profit ≥ 0) or "out of pocket — a loss" (profit < 0) in muted text
  beneath it. (008)
- **Breakdown `<dl>`**: "Sells for" `estimatedValueCents`; "eBay fees" −`feesCents`; "Shipping"
  −`shippingEstimateCents`; "What you paid" −cost (only when > 0). Rows are separated by
  hairlines; money is right-aligned in tabular numerals. There is no separate "Profit" row — the
  hero figure and its caption carry that fact. (008)
- **Match details**: "Matched: {matchedTitle}" (clamped to 2 lines on < 1024 px, with a
  `<details>`/"Show full title" toggle; full on desktop). Confidence: HIGH → no badge; MEDIUM →
  badge "Likely match — check the title".
- **Competition**: `liquidityTier` + `competingSupplyCount`:
  - STRONG → "Low competition · {n} similar listings"
  - MODERATE → "Some competition · {n} similar listings"
  - WEAK → "Crowded market · {n} similar listings"
  - UNPROVEN → "No other sellers listing this right now"
- Actions: **Check another** (primary; clears and focuses the input).
- **Dismissal pair (008)**: the primary action and the control beneath it depend on the ground:

  | Ground | Primary button | Second control beneath it |
  |---|---|---|
  | live viewfinder | `Scan the next one` (dismiss → viewfinder, decoding resumes) | `Check another` as a text button — collapses to rest, clears the input, focuses it |
  | static (typed, or no camera) | `Check another` (existing S2 copy) — collapses to rest, clears, focuses the input | none; Escape and the back gesture still dismiss |

- Focus: the verdict heading. Announcement: none extra (the heading receives focus).

### S5: UNCERTAIN
- Banner with reason: "We found listings, but they don't agree on one product, so any price would
  be a guess."
- **Suggestions** list: "Scan the barcode if it has one" (a button that opens the scanner when
  supported) · "Add details: platform, edition, or year".
- "Closest match: {matchedTitle}".
- Figures go inside a closed `<details>` with the summary "Show rough figures (unreliable)". The
  breakdown inside carries the note "These figures may be for a different product."
- There are **no** donate or recycle words anywhere (FR-004).

### S6: No market data (`reasonCode === 'NO_MARKET_DATA'`)
- Uses the RIP treatment, with the reason overridden: "No one is selling this on eBay right now,
  so there's no price to go on." No breakdown and no $0 figures (spec US1-5).
- Actions: "Check another". If the query was a barcode: "Try the item name instead" (moves the
  text to the title flow by focusing the emptied input).

### S7: Error: validation (400)
- Inline under the input: an error icon plus the server `message` (or the client-side message).
  `aria-invalid="true"`, `aria-describedby` the message id. Assertive announcement: the message.
  Focus: the input. The result area keeps its previous content.

### S8: Error: limit (429)
- The result area is an error panel with heading "You've hit today's limit". Body: "This network
  has used all {cap} free lookups for today. They reset at {time}." ({time} is the next 00:00 UTC in
  local time, e.g. "8:00 PM".) Second line: "Your recent lookups are still here." — a **button**
  with that exact visible text. On narrow viewports it opens the Recent sheet; at ≥ 1024 px, where
  Recent is a visible column, it moves focus to the `#recent` region as before. (008)
- Focus: the error heading. No Retry button (retrying can't help).

### S9: Error: unavailable (503)
- Heading "eBay isn't answering". Body "This usually clears up in a few seconds." Button
  **Try again** (re-submits the same input). Focus: the heading.

### S10: Error: offline
- Heading "You're offline". Body "Lookups need a connection. Your recent lookups are still
  available." Button **Try again**. Focus: the heading.

### S11: Error: unexpected
- Heading "Something went wrong". Body "It's on our side, not yours." Button **Try again**.

### S12: Result from history
- As S2–S6, plus a muted line under the eyebrow: "Checked {relative or clock time}. Saved result,
  not refreshed." Focus: the verdict heading.

### S13: Recent list
- `h2` "Recent". Each entry is a `<button>` inside an `<li>`, with accessible name "{Verdict
  label}: {matchedTitle or query}, {profit phrase}, checked {time}". Visually: a verdict chip (icon
  plus short label), a 1-line title, the profit, and "· checked {time}". The word "checked" is
  visible so the accessible name contains the visible text in order (WCAG 2.5.3 label-in-name,
  a defect found by the 006 e2e pass).
- When a result comes from history, the verdict heading is `aria-describedby` the S12 "Saved
  result" note, because that note sits above the heading and would otherwise be skipped once
  focus lands on it.
- Empty: "Items you check will show up here."
- **Clear history** is a text button, which opens a confirm `<dialog>` ("Clear all recent lookups
  on this device?" with **Clear** / **Cancel**, Cancel focused by default).
- Storage unavailable: one polite notice: "Recent lookups can't be saved in this browser."

### S14: Settings dialog
- A native `<dialog>` with title "Your settings" and field "Minimum profit to flip ($)". The input
  has `inputmode="decimal"`. Help text: "Default: ${meta default}. Items below this come back as Rip
  it." Buttons: **Save**, **Use default**, **Close**. Escape closes it, and focus returns to the
  Settings button. Invalid input → inline error per S7 rules, scoped to the dialog.

### S15: Scanner
- The viewfinder is the **ground** behind the sheet, not a dialog: a `<video>` (`playsinline`,
  `muted`, `aria-hidden="true"`), a corner-bracket reticle, and a status pill reading "Point at a
  barcode" while searching and "Barcode found · {code}" on a decode. The chrome "Cancel" control
  releases the camera and returns the ground to a static tone. The camera stays live behind an open
  result sheet and is released on page hide, on Cancel, and on leaving the scanning flow (which
  supersedes the previous stop-on-decode behavior). Camera failure shows the existing "Camera not
  available" heading and body inside the resting sheet, with "Type it instead" focused. (008)
- Detected: the input is filled, a polite announcement says "Scanned {code}", vibrate(50), and the
  lookup auto-submits.
- Unsupported / denied / no camera: the sheet shows the heading "Camera not available" and the
  body — denied: "Camera access was blocked. You can allow it in your browser settings, or type
  the number under the barcode." / unsupported: "This browser can't scan barcodes. Type the number
  under the barcode instead." / no camera: "No camera was found. Type the number under the barcode
  instead." Button **Type it instead** returns to the resting sheet and focuses the input.
- The Scan button is rendered only when `navigator.mediaDevices?.getUserMedia` exists. If a later
  failure proves scanning is unusable, the unsupported state explains it.

## Global

- A skip link "Skip to lookup" is the first focusable element and targets the form input.
- The document title updates to "{Verdict label} · Flip it or Rip it" on a result, and "Flip it or
  Rip it" otherwise.
- There are two visually hidden live regions (`role="status"` polite, `role="alert"` assertive),
  mounted at load and never re-created.
- **Environment badge (spec 007)**: when `/api/meta` reports an `ebayEnv` other than `production`, the header shows a non-interactive "Test data" pill ("Test data — eBay sandbox" at ≥ 480 px; full text for assistive technology: "Test data — eBay sandbox. Results come from eBay's test environment, not real listings."). S6 then adds "You're using eBay's test environment, which has very few listings. This item may well be for sale on real eBay." Recent entries (name prefixed "Test data: ") and S12 results checked in sandbox carry a "Test data" marker. Unknown environment shows nothing. Details: `specs/007-environment-badge/`.
- **Sheet (spec 008)**: below 1024 px every state is presented in one bottom sheet over a
  persistent ground. The sheet is dismissible by its visible control, Escape and the back gesture;
  it is never a modal, so the chrome (Recent, Settings, the badge) stays reachable while a result
  is shown. Recent opens as its own full-height modal sheet with a "Close" control. At ≥ 1024 px
  the three-pane layout is kept and restyled. (008)

## Accessibility checks per state (tests)

For every state S0–S15, at widths 320/390/1280 px, in light and dark (and forced-colors for
S2–S6):

1. axe-core: 0 violations (tags `wcag2a`, `wcag2aa`, `wcag21aa`, `wcag22aa`).
2. `document.documentElement.scrollWidth <= clientWidth` (no horizontal scroll).
3. The focus target listed for the state is `document.activeElement`.
4. Every interactive element's bounding box is ≥ 44×44 px (inline text links inside prose are
   exempt under WCAG 2.5.8).
