# Implementation Plan: Environment Badge

**Branch**: `007-environment-badge` | **Date**: 2026-09-26 | **Spec**: [spec.md](./spec.md)

## Summary

`/api/meta` gains `ebayEnv`. The client shows a header pill ("Test data", or "Test data — eBay
sandbox" at ≥ 480 px) when `ebayEnv === 'sandbox'`. It adds a sandbox sentence to no-market results
and stamps each history entry with the environment it came from. The pill lives *inside* the
existing fixed-height header row, so its late arrival can't shift the form. There are no new eBay
calls and no change to the lookup route.

## Technical Context

Same stack as 006 (Fastify API; `web/` Preact + TypeScript + Vite). No new dependencies. Tests use
Vitest (API and web) and Playwright + axe (e2e), all in Docker.

## Constitution Check

| Principle | Assessment | Status |
|---|---|---|
| I. eBay Compliance | Nothing changes about how eBay is reached. This adds honesty about *which* eBay. | ✅ |
| II. Latency First | `/api/lookup` is untouched. Meta is a constant object, and the client adds < 1 KB. | ✅ |
| III. Cost Discipline | Zero new calls. | ✅ |
| IV. Spec-Driven | Spec 007. | ✅ |
| V. Sandbox-First Testing | Docker only. E2E mocks meta for both environments. | ✅ |
| VI. Money in cents | No money changes. | ✅ |
| VII. Pipeline | No pipeline changes. | ✅ |
| VIII. Accessible (WCAG 2.2 AA) | Contrast-verified token pair (below); text plus icon plus border, never color alone; forced-colors rule; axe e2e in both schemes. | ✅ |

## Design Decisions

**D1: The meta field.** `ebayEnv: 'production' | 'sandbox'` comes straight from `config.ebayEnv`.
The client treats a missing or unrecognised value as *unknown* and shows nothing (spec assumption).
The `DEFAULT_META` fallback carries no `ebayEnv`.

**D2: Meta caching changes from `max-age=300` to `no-cache`.** Operators switch environments by
restarting with or without the production overlay. With a 5-minute browser cache, a restart from
production into sandbox would show sandbox answers *without* the badge for up to 5 minutes, which is
exactly the bug this spec exists to fix. The response is a few bytes from memory, so revalidating
costs nothing. This supersedes the 006 meta contract's `Cache-Control`. The service worker already
never caches `/api/*`.

**D3: Placement in the header row, not a strip.** The pill sits between the wordmark and the
Settings button in the existing header row, whose block size doesn't change. Width budget at
320 px (288 px usable): the wordmark row, a pill of about 90 px, and a 44 px Settings button. When
the badge is present **and** the viewport is under 360 px, the wordmark's text is visually hidden,
leaving the logo mark. The `h1`'s accessible text is unchanged, so this costs no accessibility. The
e2e suite asserts no header wrap and no horizontal overflow at 320 px. Semantics:
`<p class="env-badge">` inside `<header>`, with a flask icon (`aria-hidden`), the visible text
(`<span>Test data</span><span class="env-badge__wide"> — eBay sandbox</span>`, the wide part hidden
under 480 px **visually only**), and a visually hidden sentence ". Results come from eBay's test
environment, not real listings." It's static text, not a live region, and not focusable (it isn't
interactive).

**D4: Tokens** (verified by script on 2026-09-26):

| Token | Light | Dark | Ratios |
|---|---|---|---|
| `--test-fg` | `#1E3A8A` | `#A9C1FF` | on tint 8.73 / 8.81, on bg 9.65 / 10.68 |
| `--test-tint` | `#E4ECFB` | `#18223D` | `--text` on tint 14.84 / 13.42 |
| `--test-border` | `#3B5BCC` | `#6F8FE8` | on bg 5.50 / 6.15, on tint 4.98 / 5.07 |

This blue is distinct from all four verdict hues, so the badge never reads as a verdict. The border
is 1.5 px solid (the dashed style is reserved for UNCERTAIN). Under forced colors:
`border: 1px solid CanvasText; forced-color-adjust: auto`.

**D5: History origin.** `HistoryEntry.ebayEnv?: 'production' | 'sandbox'` is set when the entry is
saved, from the resolved meta (if unknown, it's omitted). The marker in Recent is a small "Test
data" chip after the verdict chip, and the entry's `aria-label` gains a leading "Test data: " so the
visible text still starts the accessible name (WCAG 2.5.3). The chip comes first in DOM order, which
keeps label-in-name valid. A reopened result shows the same pill-style note under the S12 "Saved
result" line: "Test data — eBay sandbox".

**D6: No-market copy.** In sandbox (the current meta env for a live result, or the entry's
`ebayEnv` for a history result), S6 appends the paragraph "You're using eBay's test environment,
which has very few listings. This item may well be for sale on real eBay."

## Project Structure

```text
src/server.ts, src/server.test.ts                # meta: ebayEnv + no-cache
web/src/lib/types.ts, api.ts (+test)              # Meta.ebayEnv?, isMeta accepts it, fallback unknown
web/src/lib/verdict-copy.ts (+test)               # badge + sandbox no-market strings
web/src/components/EnvBadge.tsx (+test)           # new
web/src/components/Header.tsx / app.tsx           # render badge; narrow-wordmark rule
web/src/components/ResultPanel.tsx (+test)        # S6 sandbox sentence; history test-data note
web/src/components/RecentList.tsx (+test)         # chip + aria-label prefix
web/src/lib/use-lookup.ts (+test)                 # stamp ebayEnv on saved entries
web/src/styles/tokens.css, app.css                # D4 tokens, badge styles
web/e2e/fixtures.ts, web/e2e/env.spec.ts          # new e2e: both envs × widths × schemes + axe
specs/007-environment-badge/contracts/meta-api.yaml
```

## Complexity Tracking

None.
