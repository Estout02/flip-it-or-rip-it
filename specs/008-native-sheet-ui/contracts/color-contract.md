# Color Contract (008) — normative

This file is the source of truth for `web/src/styles/contrast-contract.ts`, which
`web/src/styles/contrast.test.ts` asserts on every run (FR-013, SC-002). If a token value changes,
change it here and in `tokens.css` together; the test fails otherwise.

**Required ratios** (WCAG 2.2 AA): **4.5:1** for text below the large-text threshold; **3:1** for
large text and for UI component boundaries, borders and focus indicators. Large text = ≥ 24 px at
weight < 700, or ≥ 18.66 px at weight ≥ 700. At the weights this design uses (600), **24 px is the
threshold**.

**Measurement rule (pinned).** Composite the translucent ground over its backdrop in floating point,
**round each channel to an integer 0–255**, and only then compute relative luminance and the ratio.
Ratios are reported to two decimals, rounded half-up. This is the rule
`web/src/styles/contrast.test.ts` implements (tasks T005), and it is what makes every value below
reproduce `spec.md` FR-014 exactly. Ratios computed from an *unrounded* composite land 0.01–0.03
lower and must not be used. axe-core reports the same pairs truncated rather than rounded (it prints
3.49 where this table says 3.50), so an axe transcript and this table can differ in the last digit
without disagreeing.

**Grounds.** Every sheet pair is measured against the *worst case the sheet can composite to*, not
its nominal colour:

| Ground id | Light | Dark | Derivation |
|---|---|---|---|
| `worst` | `#EEEEEE` | `#272729` | `--sheet-glass` over `#000` (light) / over `#FFF` (dark), rounded |
| `opaque` | `#F4F4F7` | `#17171A` | `--sheet-opaque`, the FR-019 fallback |
| `chrome` | `#1C1C1E` | `#1C1C1E` | `--chrome-bg`, opaque in both schemes |
| `capsule:*` | `#D4E6E4` `#EAE2D4` `#DFE0E4` `#DCDDEF` | `#1D3931` `#3E3325` `#313337` `#2F3041` | tint at 14 % (light) / 18 % (dark) over `opaque`, rounded |

For reference, the *best* case (light glass over white `#FAFAFB`, dark glass over black `#1B1B1D`)
is never the binding case: light ink reaches 18.97 there and dark ink 15.79.

## Light scheme

| # | Foreground | Ground | Need | Measured | Used for |
|---|---|---|---|---|---|
| L1 | `--ink` `#0A0A0B` | worst | 4.5 | **17.06** | headings, item name, money rows, capsule label; also the ink-filled button's boundary (see NB1) |
| L2 | `--ink` | opaque | 4.5 | **18.03** | same, reduced-transparency path |
| L3 | `--secondary` `#636872` | worst | 4.5 | **4.82** | meta line, captions, basis note, saved note |
| L4 | `--secondary` | opaque | 4.5 | **5.10** | same |
| L5 | `--tint-flip` `#0E8F6E` | worst | 3 | **3.50** | net figure (38 px), capsule dot, borders |
| L6 | `--tint-risky` `#B07000` | worst | 3 | **3.51** | as above — **0.51 of headroom; do not lighten** |
| L7 | `--tint-rip` `#5F6672` | worst | 3 | **4.99** | as above |
| L8 | `--tint-unc` `#4A4FBF` | worst | 3 | **5.72** | as above, plus the dashed capsule edge |
| L9 | `--fill-label` `#FFFFFF` | `--fill-flip` `#0C7F62` | 4.5 | **4.97** | verdict-tinted button label |
| L10 | `--fill-label` | `--fill-risky` `#965F00` | 4.5 | **5.34** | " |
| L11 | `--fill-label` | `--fill-rip` `#5F6672` | 4.5 | **5.78** | " |
| L12 | `--fill-label` | `--fill-unc` `#4A4FBF` | 4.5 | **6.64** | " |
| L13 | `--fill-flip` | worst | 3 | **4.28** | button boundary |
| L14 | `--fill-risky` | worst | 3 | **4.60** | " |
| L15 | `--fill-rip` | worst | 3 | **4.99** | " |
| L16 | `--fill-unc` | worst | 3 | **5.72** | " |
| L17 | `--ink` | capsule:flip | 4.5 | **15.30** | capsule label |
| L18 | `--ink` | capsule:risky | 4.5 | **15.39** | " |
| L19 | `--ink` | capsule:rip | 4.5 | **15.00** | " |
| L20 | `--ink` | capsule:unc | 4.5 | **14.73** | " |
| L21 | `--tint-flip` | capsule:flip | 3 | **3.14** | capsule dot / edge |
| L22 | `--tint-risky` | capsule:risky | 3 | **3.16** | " |
| L23 | `--tint-rip` | capsule:rip | 3 | **4.39** | " |
| L24 | `--tint-unc` | capsule:unc | 3 | **4.94** | dashed UNCERTAIN edge |
| L25 | `--control-border` `#6B717A` | worst | 3 | **4.24** | input and secondary-button borders |
| L26 | `--control-border` | opaque | 3 | **4.48** | " |
| L27 | `--focus` `#1D4ED8` | worst | 3 | **5.78** | focus ring on the sheet |
| L28 | `--focus` | capsule:unc | 3 | **4.99** | focus ring inside a capsule (worst capsule) |
| L29 | `--danger` `#B42318` | worst | 4.5 | **5.67** | inline validation and error text |
| L30 | `--hairline` over worst | worst | — | 1.29 | **decorative**: row dividers and the sheet edge only |
| NB1 | `--sheet-opaque` `#F4F4F7` | `--ink` `#0A0A0B` | 4.5 | **18.03** | neutral primary button (Check, Try again, confirm): ink fill, sheet-opaque label. Its boundary against the worst-case ground is the same pair as **L1** (17.06), so no extra border is needed |

## Dark scheme

| # | Foreground | Ground | Need | Measured | Used for |
|---|---|---|---|---|---|
| D1 | `--ink` `#F5F5F7` | worst | 4.5 | **13.69** | headings, item name, money rows, capsule label; also the ink-filled button's boundary (NB1) |
| D2 | `--ink` | opaque | 4.5 | **16.43** | reduced-transparency path |
| D3 | `--secondary` `#A0A6B0` | worst | 4.5 | **6.09** | meta line, captions, basis note |
| D4 | `--secondary` | opaque | 4.5 | **7.31** | " |
| D5 | `--tint-flip` `#38D39B` | worst | 3 | **7.78** | net figure, dot, **and the button border (D13)** |
| D6 | `--tint-risky` `#F0B357` | worst | 3 | **8.02** | " (and D14) |
| D7 | `--tint-rip` `#A9B0BD` | worst | 3 | **6.84** | " (and D15) |
| D8 | `--tint-unc` `#9EA4F5` | worst | 3 | **6.45** | " (and D16) |
| D9 | `--fill-label` `#F5F5F7` | `--fill-flip` `#08503C` | 4.5 | **8.68** | verdict-tinted button label |
| D10 | `--fill-label` | `--fill-risky` `#5E3C00` | 4.5 | **9.09** | " |
| D11 | `--fill-label` | `--fill-rip` `#383D45` | 4.5 | **10.04** | " |
| D12 | `--fill-label` | `--fill-unc` `#343A96` | 4.5 | **8.80** | " |
| D13 | `--tint-flip` as the button border | worst | 3 | **7.78** | **the same physical pair as D5** — listed separately because the requirement is of a different kind (component boundary, not large text). The dark fills need it: `#08503C` against the worst ground is only **1.58:1** |
| D14 | `--tint-risky` as the button border | worst | 3 | **8.02** | same pair as D6 |
| D15 | `--tint-rip` as the button border | worst | 3 | **6.84** | same pair as D7 |
| D16 | `--tint-unc` as the button border | worst | 3 | **6.45** | same pair as D8 |
| D17 | `--ink` | capsule:flip | 4.5 | **11.47** | capsule label |
| D18 | `--ink` | capsule:risky | 4.5 | **11.31** | " |
| D19 | `--ink` | capsule:rip | 4.5 | **11.62** | " |
| D20 | `--ink` | capsule:unc | 4.5 | **11.91** | " |
| D21 | `--secondary` | capsule:risky | 4.5 | **5.03** | permitted in dark (fails in light — see rule 1) |
| D22 | `--control-border` `#8A9099` | worst | 3 | **4.64** | input and secondary-button borders |
| D23 | `--focus` `#8AB4FF` | worst | 3 | **7.14** | focus ring on the sheet (**not** `#1D4ED8`, which is 2.22 here) |
| D24 | `--focus` | capsule:risky | 3 | **5.90** | focus ring inside a capsule (worst dark capsule) |
| D25 | `--danger` `#FF8A7A` | worst | 4.5 | **6.51** | inline validation and error text |
| NB1 | `--sheet-opaque` `#17171A` | `--ink` `#F5F5F7` | 4.5 | **16.43** | neutral primary button: ink fill, sheet-opaque label. Boundary = **D1** (13.69), so no extra border |

The tint borders also stay visible against their own fills: 4.93 (flip), 5.32 (risky), 5.01 (rip),
4.14 (unc).

## Chrome (both schemes, over live video)

| # | Foreground | Ground | Need | Measured | Used for |
|---|---|---|---|---|---|
| C1 | `--chrome-fg` `#F5F5F7` | chrome | 4.5 | **15.63** | status pill, wordmark, control labels, sandbox badge |
| C2 | `--chrome-secondary` `#A0A6B0` | chrome | 4.5 | **6.95** | secondary chrome text |
| C3 | `--chrome-focus` `#8AB4FF` | chrome | 3 | **8.15** | focus ring on chrome controls |
| C4 | `--chrome-bg` | `--viewfinder-bg` `#000` | — | 1.23 | **decorative**: the pill is identified by its text, not its edge; what matters is its opacity, asserted separately in e2e |

## Rules the numbers depend on

1. **`--secondary` never sits on a light capsule fill.** Measured 4.16 (capsule:unc), 4.24
   (capsule:rip), 4.33 (capsule:flip), 4.35 (capsule:risky) — all under 4.5. The capsule carries only
   the dot and the ink label; the S12 saved-result note and the spec-007 test-data marker sit on the
   sheet ground (L3, 4.82). In dark the same pair passes (D21, 5.03), so the rule is a light-scheme
   constraint enforced structurally. (If a future design needs muted text in a light capsule,
   `#5C616B` measures 4.63 there and 5.36 on the ground.)
2. **No tint below 24 px.** Verified in a Chromium probe: axe reports a real violation for
   `#0E8F6E`/`#B07000` at 15 px on the `.95` ground (3.49/3.50 as axe prints them, against the 4.5
   required). The net figure (38 px / 600) is the only tinted text.
3. **Chrome never relies on the video for contrast.** Every chrome element's computed
   `background-color` must have alpha = 1; asserted in e2e because axe returns *incomplete*, not a
   violation, for text over a video.
4. **The hairline carries nothing.** Row meaning comes from each `dt`; the sheet edge is also carried
   by the shadow and the radius.
5. **Forced colors wins.** In `forced-colors: active`, capsules, buttons, rows and the sheet take
   `CanvasText` borders and system button colours; the verdict is still carried by label plus icon.

## Reproducing this table

The values above were derived in the container
(`docker compose run --rm --no-deps web node < script`) under the pinned measurement rule, and every
row that also appears in `spec.md` FR-014 matches it to the digit: 17.06, 4.82, 3.50, 3.51, 4.99,
5.72, 4.97, 5.34, 5.78, 6.64, 14.73–15.39, 5.78 / 8.15, 15.63, 13.69, 6.09, 7.78, 8.02, 6.84, 6.45,
dark labels ≥ 8.5, dark capsule ink ≥ 11.3. The rejected lookbook values reproduce too:
`#6B7079` 4.29 and `#C07A00` 3.00.
