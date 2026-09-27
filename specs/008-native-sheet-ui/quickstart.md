# Quickstart: validating the Native Sheet UI (008)

Everything runs in Docker (constitution V). Nothing here touches the eBay API: the unit suite stubs
`fetch` and the e2e matrix answers every `/api/**` request from `web/e2e/fixtures.ts`.

## 1. Automated gates

```bash
# Web unit suite (vitest + jsdom + axe) → production build → 100 KB gzip budget check
docker compose run --rm web npm test

# Types only (fast loop)
docker compose run --rm web npm run typecheck

# End-to-end + accessibility matrix (Chromium, 320 / 390 / 1280 px, light + dark, forced-colors)
docker compose --profile e2e run --rm e2e

# API untouched by this feature — prove it
docker compose run --rm api npm test
docker compose run --rm api npm run typecheck
```

**Expected:**

| Gate | Expected outcome |
|---|---|
| `web npm test` | all suites pass, including the new `src/styles/contrast.test.ts`; `check-size` prints `initial: < 100 KB gzip` (baseline before this feature: **20.6 KB**) and lists the lazy, self-hosted `zxing_reader-*.wasm` |
| `contrast.test.ts` | one assertion per row of `contracts/color-contract.md`, in both schemes; a failure names the token, the ground, the measured ratio and the requirement |
| e2e matrix | 0 axe violations **and** no `color-contrast` entry in axe's `incomplete` for every state S0–S15 and N1–N6, in both schemes; focus target correct before and after each axe run; no horizontal scroll; all targets ≥ 44 × 44 |
| `api npm test` | unchanged and green — this feature edits nothing under `src/` |

A red `contrast.test.ts` is never fixed by relaxing the requirement column. Fix the token.

## 2. Live look (sandbox data)

```bash
docker compose up --build          # API :3000, Vite dev :5173, Postgres :5432
# then open http://localhost:5173
```

The header shows the **"Test data — eBay sandbox"** pill because `.env` stays on `EBAY_ENV=sandbox`
(spec 007). Try both paths:

- **Typed**: enter `Chrono Trigger SNES`, press Enter. The sheet expands over the *static* ground —
  no camera prompt, no `<video>` in the DOM, no decoder request in the Network panel.
- **Scanned**: tap **Scan**, allow the camera. The ground becomes the viewfinder with the
  corner-bracket reticle and the pill "Point at a barcode"; hold up a barcode, and the pill switches
  to "Barcode found · {code}" while the sheet rises with the verdict. Dismiss it — the viewfinder is
  already decoding, and the browser does not ask for the camera again.

## 3. The five things most likely to be wrong — check them by hand

1. **Legibility over the worst image.** With a result sheet open, point the camera at something black,
   then something white. Every line stays readable. Then turn on the OS setting
   (macOS: System Settings → Accessibility → Display → Reduce transparency; Chrome honours it, Safari
   does not expose it) and confirm the sheet becomes fully opaque.
2. **Keyboard only, whole loop.** Tab from the skip link → resting sheet input → Check → result
   heading → primary action → dismiss → Recent → an entry → Close. Focus is always visible, never
   behind the sheet, and never lands on nothing.
3. **On-screen keyboard.** On a phone (or Chrome device emulation with a soft keyboard), focus the
   input in the resting sheet: the input and Check stay visible above the keyboard.
4. **400 % zoom / 320 px.** At 1280 px set browser zoom to 400 %, show a result: the sheet takes the
   full height and scrolls internally; nothing is cut off and nothing scrolls sideways.
5. **Screen reader.** VoiceOver (iOS/macOS) or NVDA: submit a lookup — "Checking…" is announced, then
   focus lands on the verdict label and the reason is read next. Open a saved result: the
   "Saved result, not refreshed." note is read as the heading's description.

## 4. Camera lifecycle spot-checks (FR-011, the amended 006 FR-009)

| Action | Expected |
|---|---|
| decode a code | stream stays live; the recording indicator stays on; decoding of *that* code is suspended |
| dismiss the sheet | decoding resumes immediately; no permission prompt |
| switch browser tabs | stream released (indicator off); returning resumes it silently |
| chrome **Cancel** | stream released, ground returns to the static tone, Scan is still offered |
| focus the input / open Recent or Settings | stream released (leaving the scanning flow) |
| deny permission | "Camera not available" notice in the resting sheet, ground static, typing still works |

## 5. Reference

- Surfaces, focus targets and the per-state acceptance bar: `contracts/sheet-states.md`
- Token values and every measured ratio: `contracts/color-contract.md`
- Copy to add to the 006 contract: `contracts/copy-additions.md`
- Why each decision was taken, with the platform facts behind it: `research.md`
- View state, scanner handle and token model: `data-model.md`
