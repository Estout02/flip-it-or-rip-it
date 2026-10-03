# Copy additions and amendments to `specs/006-web-client/contracts/ui-states.md` (FR-021)

Every string below must be **added to the 006 contract as part of this feature** and then consumed
from `web/src/lib/verdict-copy.ts`. No component may contain a literal user-facing string. Existing
copy keeps its exact wording and meaning (FR-022).

## 1. New strings

| Key (`verdict-copy.ts`) | Text (verbatim) | Where |
|---|---|---|
| `NET_CAPTION_PROFIT` | `in your pocket` | under the net figure when `profitCents >= 0` |
| `NET_CAPTION_LOSS` | `out of pocket — a loss` | under the net figure when `profitCents < 0` (the figure also carries a true minus sign, so the loss is stated twice — FR-022, US4-4) |
| `DISMISS_SCAN_NEXT` | `Scan the next one` | the sheet's camera-path action (see §3) |
| `MONEY_ROWS.value` | `Sells for` | money row 1 — **renames** 006's "Est. sale value" |
| `MONEY_ROWS.fees` | `eBay fees` | money row 2 (unchanged wording) |
| `MONEY_ROWS.shipping` | `Shipping` | money row 3 (unchanged wording) |
| `MONEY_ROWS.cost` | `What you paid` | money row 4, only when cost > 0 (unchanged wording) |
| `SCANNER_COPY.found` | `Barcode found · {code}` | status pill after a successful decode (FR-007). `{code}` is the raw digits; the separator is `·` U+00B7 with spaces, matching the Recent row separator |

`SCANNER_COPY.prompt` (`Point at a barcode`) already exists and is reused verbatim as the searching
state of the pill. `Cancel`, `Close`, `Settings`, `Recent`, `Check another`, `Try again`,
`Try the item name instead`, `Type it instead` and all verdict, reason, badge, error, settings and
spec-007 strings are reused unchanged.

## 2. Amendments to existing 006 sections

**S2/S3/S4 — Breakdown.** Replace the `<dl>` description with:

> **Net figure (hero)**: `formatCents(profitCents)` in the verdict tint at 38 px/600, with the caption
> "in your pocket" (profit ≥ 0) or "out of pocket — a loss" (profit < 0) in muted text beneath it.
> **Breakdown `<dl>`**: "Sells for" `estimatedValueCents`; "eBay fees" −`feesCents`; "Shipping"
> −`shippingEstimateCents`; "What you paid" −cost (only when > 0). Rows are separated by hairlines;
> money is right-aligned in tabular numerals. There is no separate "Profit" row — the hero figure and
> its caption carry that fact (008 FR-022).

**S8 — limit.** Replace "Second line: 'Your recent lookups are still here.' (links to #recent)" with:

> Second line: "Your recent lookups are still here." — a **button** with that exact visible text. On
> narrow viewports it opens the Recent sheet; at ≥ 1024 px, where Recent is a visible column, it moves
> focus to the `#recent` region as before (008 FR-026).

**S15 — scanner.** Replace the "full-screen modal `<dialog>`" description with:

> The viewfinder is the **ground** behind the sheet, not a dialog: a `<video>` (`playsinline`,
> `muted`, `aria-hidden="true"`), a corner-bracket reticle, and a status pill reading "Point at a
> barcode" while searching and "Barcode found · {code}" on a decode. The chrome "Cancel" control
> releases the camera and returns the ground to a static tone. The camera stays live behind an open
> result sheet and is released on page hide, on Cancel, and on leaving the scanning flow
> (008 FR-011, which supersedes 006 FR-009's stop-on-decode). Camera failure shows the existing
> "Camera not available" heading and body inside the resting sheet, with "Type it instead" focused.

**Global.** Add:

> **Sheet (spec 008)**: below 1024 px every state is presented in one bottom sheet over a persistent
> ground. The sheet is dismissible by its visible control, Escape and the back gesture; it is never a
> modal, so the chrome (Recent, Settings, the badge) stays reachable while a result is shown. Recent
> opens as its own full-height modal sheet with a "Close" control. At ≥ 1024 px the three-pane layout
> is kept and restyled.

## 3. The two dismissal labels (planning decision, flagged for the founder)

FR-003 asks for "primary button, dismiss link"; FR-021 names the dismiss link "Scan the next one",
which would be wrong copy on a device that never opened the camera (US2). The plan therefore binds the
pair to the ground:

| Ground | Primary button | Second control beneath it |
|---|---|---|
| live viewfinder | `Scan the next one` (dismiss → viewfinder, decoding resumes) | `Check another` as a text button — collapses to rest, clears the input, focuses it |
| static (typed, or no camera) | `Check another` (existing S2 copy) — collapses to rest, clears, focuses the input | none; Escape and the back gesture still dismiss (FR-004) |

This adds exactly one new string and never offers a camera action to a device without a camera. If the
founder prefers a literal reading of FR-003 (both controls always present), only this table and the
two components that render it change.
