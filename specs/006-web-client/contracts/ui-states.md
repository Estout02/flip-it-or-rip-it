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
- **Hero number**: `describeProfit(profitCents)`, e.g. "+$22.07 profit" or "loses $3.20".
- **Breakdown** `<dl>`: "Est. sale value" `estimatedValueCents`; "eBay fees" −`feesCents`;
  "Shipping" −`shippingEstimateCents`; "What you paid" −cost (only when > 0); a rule; then
  "Profit" `profitCents`. Money is right-aligned, in tabular numerals.
- **Match details**: "Matched: {matchedTitle}" (clamped to 2 lines on < 1024 px, with a
  `<details>`/"Show full title" toggle; full on desktop). Confidence: HIGH → no badge; MEDIUM →
  badge "Likely match — check the title".
- **Competition**: `liquidityTier` + `competingSupplyCount`:
  - STRONG → "Low competition · {n} similar listings"
  - MODERATE → "Some competition · {n} similar listings"
  - WEAK → "Crowded market · {n} similar listings"
  - UNPROVEN → "No other sellers listing this right now"
- Actions: **Check another** (primary; clears and focuses the input).
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
  local time, e.g. "8:00 PM".) Second line: "Your recent lookups are still here." (links to #recent).
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
  plus short label), a 1-line title, the profit, and the time.
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
- A full-screen modal `<dialog>` with a `<video>` (`playsinline`, `muted`, `aria-hidden="true"`),
  a target frame, and the visible text "Point at a barcode". The Cancel button is focused first.
- Detected: the dialog closes, the input is filled, a polite announcement says "Scanned {code}",
  vibrate(50), and the lookup auto-submits.
- Unsupported / denied / no camera: the dialog shows the heading "Camera not available" and the
  body — denied: "Camera access was blocked. You can allow it in your browser settings, or type
  the number under the barcode." / unsupported: "This browser can't scan barcodes. Type the number
  under the barcode instead." Button **Type it instead** closes the dialog and focuses the input.
- The Scan button is rendered only when `navigator.mediaDevices?.getUserMedia` exists. If a later
  failure proves scanning is unusable, the unsupported state explains it.

## Global

- A skip link "Skip to lookup" is the first focusable element and targets the form input.
- The document title updates to "{Verdict label} · Flip it or Rip it" on a result, and "Flip it or
  Rip it" otherwise.
- There are two visually hidden live regions (`role="status"` polite, `role="alert"` assertive),
  mounted at load and never re-created.

## Accessibility checks per state (tests)

For every state S0–S15, at widths 320/390/1280 px, in light and dark (and forced-colors for
S2–S6):

1. axe-core: 0 violations (tags `wcag2a`, `wcag2aa`, `wcag21aa`, `wcag22aa`).
2. `document.documentElement.scrollWidth <= clientWidth` (no horizontal scroll).
3. The focus target listed for the state is `document.activeElement`.
4. Every interactive element's bounding box is ≥ 44×44 px (inline text links inside prose are
   exempt under WCAG 2.5.8).
