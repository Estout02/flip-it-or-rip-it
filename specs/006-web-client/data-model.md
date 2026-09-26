# Data Model: Web Client (006)

## Client types (`web/src/lib/types.ts`)

`VerdictResult` mirrors `specs/005-backend-hardening/contracts/lookup-api.yaml` 0.6.0 exactly.
Fields the UI reads:

| Field | UI use |
|---|---|
| `verdict` | banner treatment (FLIP / FLIP_RISKY / RIP / UNCERTAIN) |
| `reason`, `reasonCode` | banner sentence. `reasonCode` selects the special layouts (NO_MARKET_DATA, LOW_MATCH_CONFIDENCE) |
| `estimatedValueCents`, `feesCents`, `shippingEstimateCents`, `profitCents` | breakdown |
| `matchedTitle`, `matchConfidence`, `matchedCategoryName`, `matchFiltered` | match details |
| `liquidityTier`, `competingSupplyCount` | competition read |
| `noMarketData`, `sampleSize` | no-market layout; "based on N listings" |
| `cached` | not shown to users |
| `rawAskingMedianCents`, `realizationRate` | **never displayed** (FR-006) |

```ts
type LookupInput = { identifier?: string; title?: string; costBasisCents?: number; profitThresholdCents?: number };
type Meta = { defaultProfitThresholdCents: number; lookupDailyCap: number; marketplaceId: string };
type LookupError =
  | { kind: 'validation'; message: string }
  | { kind: 'limit' }
  | { kind: 'unavailable' }
  | { kind: 'offline' }
  | { kind: 'unexpected' };
type LookupState =
  | { status: 'idle' }
  | { status: 'loading'; input: LookupInput }
  | { status: 'success'; entry: HistoryEntry; fromHistory: boolean }
  | { status: 'error'; error: LookupError; input: LookupInput };
```

## Device storage

| Key | Shape | Rules |
|---|---|---|
| `flip-or-rip:settings:v1` | `{ profitThresholdCents: number \| null }` | `null` → omit from requests and display the `/api/meta` default |
| `flip-or-rip:history:v1` | `HistoryEntry[]` | newest first, max 50. Malformed JSON → treat as empty and overwrite on the next save |

```ts
type HistoryEntry = {
  id: string;              // crypto.randomUUID() (fallback: Date.now()+random)
  checkedAt: string;       // ISO
  query: { identifier: string | null; title: string | null };
  costBasisCents: number;  // 0 when not entered
  result: VerdictResult;
};
```

## Input classification (FR-001)

Strip spaces and hyphens. If the result matches `^\d{8}$|^\d{12,14}$|^\d{9}[\dXx]$`, it's an
**identifier** (send the original string; the server normalises it). Otherwise it's a **title**
(trimmed, 1–200 characters; longer input is a client-side validation error matching the server
message).

## Money (R7)

- `parseDollarsToCents(s)`: trim, strip a leading `$` and commas, then match
  `^(\d{1,6})(?:\.(\d{1,2}))?$`. The result is `int(whole)*100 + int(frac.padEnd(2,'0'))`.
  Anything else → error "Enter an amount like 12 or 12.50".
- `formatCents(c)`: `Intl.NumberFormat('en-US',{style:'currency',currency:'USD'})` of `c/100`;
  negative values use a true minus sign "−".
- `describeProfit(c)`: `c ≥ 0` → "+$X profit"; `c < 0` → "loses $X".

## Design tokens (`web/src/styles/tokens.css`)

All pairs were verified with the WCAG relative-luminance formula (script in the session scratchpad;
results in research R11). Minimums are 4.5:1 for text and 3:1 for UI and focus.

| Token | Light | Dark | Verified pairs |
|---|---|---|---|
| `--bg` | `#F7F7F4` | `#0E1012` | |
| `--surface` | `#FFFFFF` | `#171A1D` | |
| `--text` | `#17191C` | `#ECEDEE` | 16.4 / 16.3 on bg |
| `--text-muted` | `#555B63` | `#A7ADB4` | 6.4 / 8.4 on bg |
| `--border-ui` (inputs, controls) | `#7C838C` | `#6E757D` | 3.8 / 3.75 on surface |
| `--border-subtle` (decorative only) | `#E3E5E1` | `#2A2E33` | not relied on for meaning |
| `--focus` | `#1D4ED8` | `#8AB4FF` | 6.2 / 9.1 on bg |
| `--danger` | `#B42318` | `#FF8A7A` | 6.6 / 7.6 on surface |
| `--btn-bg` / `--btn-fg` | `#17191C` / `#FFFFFF` | `#ECEDEE` / `#0E1012` | 17.6 / 16.3 |
| `--flip-fg` / `--flip-tint` | `#0A6A3B` / `#E3F3EA` | `#5FD69C` / `#0E2A1C` | 5.8 / 8.5 |
| `--risky-fg` / `--risky-tint` | `#8A4700` / `#FDEFD9` | `#F4B860` / `#2D2110` | 6.2 / 8.9 |
| `--rip-fg` / `--rip-tint` | `#5335B5` / `#EEE9FB` | `#BBA9FF` / `#211A3B` | 7.0 / 8.0 |
| `--unc-fg` / `--unc-tint` | `#474D55` / `#ECEEF1` | `#C5CAD0` / `#23272B` | 7.3 / 9.1 |

`--text` on every tint is ≥ 12.8:1. Spacing uses a 4 px base (`--space-1` … `--space-8`), radii
are `--radius-sm` 8 px and `--radius-lg` 16 px, and the touch target is `--target` 44 px. Type is
`system-ui, -apple-system, "Segoe UI", Roboto, sans-serif`, with the fluid scale
`--step-0: clamp(1rem, 0.96rem + 0.2vw, 1.125rem)` through `--step-4` (verdict label,
`clamp(2.25rem, 1.8rem + 2.2vw, 3rem)`).

Forced colors: `@media (forced-colors: active)` sets verdict banners and buttons to
`border: 2px solid CanvasText`, icons to `fill: currentColor`, and focus to
`outline-color: Highlight`.
