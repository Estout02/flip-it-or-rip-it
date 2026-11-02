// The normative contrast table as data (data-model.md §5). This is the single source
// `web/src/styles/contrast.test.ts` reads to prove SC-002/FR-013 — a token edit that drifts from
// specs/008-native-sheet-ui/contracts/color-contract.md fails that test, not a review.
//
// PAIRS has 60 entries covering the contract's 61 rows: L1-L30 (30), D1-D25 (25), C1-C4 (4), plus
// one scheme-independent NB1 entry that stands for both of its rows (light + dark).

export type Need = 4.5 | 3;

export type Treatment = 'flip' | 'risky' | 'rip' | 'unc';

export type GroundRef =
  | { kind: 'worst' }
  | { kind: 'opaque' }
  | { kind: 'chrome' }
  | { kind: 'capsule'; treatment: Treatment }
  | { kind: 'token'; name: string };

export type Pair = {
  /** The contract's row id: 'L1' … 'L30', 'D1' … 'D25', 'C1' … 'C4', 'NB1'. */
  id: string;
  /** CSS custom property name, resolved out of tokens.css at test time. */
  fg: string;
  on: GroundRef;
  need: Need;
  /** Omitted = scheme-independent, asserted once or in both per the C-rows/NB1 rules below. */
  scheme?: 'light' | 'dark';
  /** Documented as decorative: recorded, never asserted for a ratio. */
  decorative?: boolean;
  note?: string;
};

export const SCHEMES = ['light', 'dark'] as const;

export const GROUND_COMPOSITE = {
  light: { glass: '--sheet-glass', over: '#000000' },
  dark: { glass: '--sheet-glass', over: '#FFFFFF' },
} as const;

export const CAPSULE_ALPHA = { light: 0.14, dark: 0.18 } as const;

export const PAIRS: Pair[] = [
  // Light scheme
  {
    id: 'L1',
    fg: '--ink',
    on: { kind: 'worst' },
    need: 4.5,
    scheme: 'light',
    note: "headings, item name, money rows, capsule label; also the ink-filled button's boundary (see NB1)",
  },
  { id: 'L2', fg: '--ink', on: { kind: 'opaque' }, need: 4.5, scheme: 'light', note: 'same, reduced-transparency path' },
  { id: 'L3', fg: '--secondary', on: { kind: 'worst' }, need: 4.5, scheme: 'light', note: 'meta line, captions, basis note, saved note' },
  { id: 'L4', fg: '--secondary', on: { kind: 'opaque' }, need: 4.5, scheme: 'light', note: 'same' },
  { id: 'L5', fg: '--tint-flip', on: { kind: 'worst' }, need: 3, scheme: 'light', note: 'net figure (38 px), capsule dot, borders' },
  { id: 'L6', fg: '--tint-risky', on: { kind: 'worst' }, need: 3, scheme: 'light', note: 'as above — 0.51 of headroom; do not lighten' },
  { id: 'L7', fg: '--tint-rip', on: { kind: 'worst' }, need: 3, scheme: 'light', note: 'as above' },
  { id: 'L8', fg: '--tint-unc', on: { kind: 'worst' }, need: 3, scheme: 'light', note: 'as above, plus the dashed capsule edge' },
  { id: 'L9', fg: '--fill-label', on: { kind: 'token', name: '--fill-flip' }, need: 4.5, scheme: 'light', note: 'verdict-tinted button label' },
  { id: 'L10', fg: '--fill-label', on: { kind: 'token', name: '--fill-risky' }, need: 4.5, scheme: 'light', note: '"' },
  { id: 'L11', fg: '--fill-label', on: { kind: 'token', name: '--fill-rip' }, need: 4.5, scheme: 'light', note: '"' },
  { id: 'L12', fg: '--fill-label', on: { kind: 'token', name: '--fill-unc' }, need: 4.5, scheme: 'light', note: '"' },
  { id: 'L13', fg: '--fill-flip', on: { kind: 'worst' }, need: 3, scheme: 'light', note: 'button boundary' },
  { id: 'L14', fg: '--fill-risky', on: { kind: 'worst' }, need: 3, scheme: 'light', note: '"' },
  { id: 'L15', fg: '--fill-rip', on: { kind: 'worst' }, need: 3, scheme: 'light', note: '"' },
  { id: 'L16', fg: '--fill-unc', on: { kind: 'worst' }, need: 3, scheme: 'light', note: '"' },
  { id: 'L17', fg: '--ink', on: { kind: 'capsule', treatment: 'flip' }, need: 4.5, scheme: 'light', note: 'capsule label' },
  { id: 'L18', fg: '--ink', on: { kind: 'capsule', treatment: 'risky' }, need: 4.5, scheme: 'light', note: '"' },
  { id: 'L19', fg: '--ink', on: { kind: 'capsule', treatment: 'rip' }, need: 4.5, scheme: 'light', note: '"' },
  { id: 'L20', fg: '--ink', on: { kind: 'capsule', treatment: 'unc' }, need: 4.5, scheme: 'light', note: '"' },
  { id: 'L21', fg: '--tint-flip', on: { kind: 'capsule', treatment: 'flip' }, need: 3, scheme: 'light', note: 'capsule dot / edge' },
  { id: 'L22', fg: '--tint-risky', on: { kind: 'capsule', treatment: 'risky' }, need: 3, scheme: 'light', note: '"' },
  { id: 'L23', fg: '--tint-rip', on: { kind: 'capsule', treatment: 'rip' }, need: 3, scheme: 'light', note: '"' },
  { id: 'L24', fg: '--tint-unc', on: { kind: 'capsule', treatment: 'unc' }, need: 3, scheme: 'light', note: 'dashed UNCERTAIN edge' },
  { id: 'L25', fg: '--control-border', on: { kind: 'worst' }, need: 3, scheme: 'light', note: 'input and secondary-button borders' },
  { id: 'L26', fg: '--control-border', on: { kind: 'opaque' }, need: 3, scheme: 'light', note: '"' },
  { id: 'L27', fg: '--focus', on: { kind: 'worst' }, need: 3, scheme: 'light', note: 'focus ring on the sheet' },
  { id: 'L28', fg: '--focus', on: { kind: 'capsule', treatment: 'unc' }, need: 3, scheme: 'light', note: 'focus ring inside a capsule (worst capsule)' },
  { id: 'L29', fg: '--danger', on: { kind: 'worst' }, need: 4.5, scheme: 'light', note: 'inline validation and error text' },
  {
    id: 'L30',
    fg: '--hairline',
    on: { kind: 'worst' },
    need: 3,
    scheme: 'light',
    decorative: true,
    note: 'decorative: row dividers and the sheet edge only',
  },

  // Dark scheme
  {
    id: 'D1',
    fg: '--ink',
    on: { kind: 'worst' },
    need: 4.5,
    scheme: 'dark',
    note: "headings, item name, money rows, capsule label; also the ink-filled button's boundary (NB1)",
  },
  { id: 'D2', fg: '--ink', on: { kind: 'opaque' }, need: 4.5, scheme: 'dark', note: 'reduced-transparency path' },
  { id: 'D3', fg: '--secondary', on: { kind: 'worst' }, need: 4.5, scheme: 'dark', note: 'meta line, captions, basis note' },
  { id: 'D4', fg: '--secondary', on: { kind: 'opaque' }, need: 4.5, scheme: 'dark', note: '"' },
  { id: 'D5', fg: '--tint-flip', on: { kind: 'worst' }, need: 3, scheme: 'dark', note: 'net figure, dot, and the button border (D13)' },
  { id: 'D6', fg: '--tint-risky', on: { kind: 'worst' }, need: 3, scheme: 'dark', note: '" (and D14)' },
  { id: 'D7', fg: '--tint-rip', on: { kind: 'worst' }, need: 3, scheme: 'dark', note: '" (and D15)' },
  { id: 'D8', fg: '--tint-unc', on: { kind: 'worst' }, need: 3, scheme: 'dark', note: '" (and D16)' },
  { id: 'D9', fg: '--fill-label', on: { kind: 'token', name: '--fill-flip' }, need: 4.5, scheme: 'dark', note: 'verdict-tinted button label' },
  { id: 'D10', fg: '--fill-label', on: { kind: 'token', name: '--fill-risky' }, need: 4.5, scheme: 'dark', note: '"' },
  { id: 'D11', fg: '--fill-label', on: { kind: 'token', name: '--fill-rip' }, need: 4.5, scheme: 'dark', note: '"' },
  { id: 'D12', fg: '--fill-label', on: { kind: 'token', name: '--fill-unc' }, need: 4.5, scheme: 'dark', note: '"' },
  {
    id: 'D13',
    fg: '--tint-flip',
    on: { kind: 'worst' },
    need: 3,
    scheme: 'dark',
    note:
      'the same physical pair as D5 — listed separately because the requirement is of a different kind ' +
      '(component boundary, not large text). The dark fills need it: #08503C against the worst ground is only 1.58:1',
  },
  { id: 'D14', fg: '--tint-risky', on: { kind: 'worst' }, need: 3, scheme: 'dark', note: 'same pair as D6' },
  { id: 'D15', fg: '--tint-rip', on: { kind: 'worst' }, need: 3, scheme: 'dark', note: 'same pair as D7' },
  { id: 'D16', fg: '--tint-unc', on: { kind: 'worst' }, need: 3, scheme: 'dark', note: 'same pair as D8' },
  { id: 'D17', fg: '--ink', on: { kind: 'capsule', treatment: 'flip' }, need: 4.5, scheme: 'dark', note: 'capsule label' },
  { id: 'D18', fg: '--ink', on: { kind: 'capsule', treatment: 'risky' }, need: 4.5, scheme: 'dark', note: '"' },
  { id: 'D19', fg: '--ink', on: { kind: 'capsule', treatment: 'rip' }, need: 4.5, scheme: 'dark', note: '"' },
  { id: 'D20', fg: '--ink', on: { kind: 'capsule', treatment: 'unc' }, need: 4.5, scheme: 'dark', note: '"' },
  {
    id: 'D21',
    fg: '--secondary',
    on: { kind: 'capsule', treatment: 'risky' },
    need: 4.5,
    scheme: 'dark',
    note: 'permitted in dark (fails in light — see rule 1)',
  },
  { id: 'D22', fg: '--control-border', on: { kind: 'worst' }, need: 3, scheme: 'dark', note: 'input and secondary-button borders' },
  {
    id: 'D23',
    fg: '--focus',
    on: { kind: 'worst' },
    need: 3,
    scheme: 'dark',
    note: 'focus ring on the sheet (not #1D4ED8, which is 2.22 here)',
  },
  { id: 'D24', fg: '--focus', on: { kind: 'capsule', treatment: 'risky' }, need: 3, scheme: 'dark', note: 'focus ring inside a capsule (worst dark capsule)' },
  { id: 'D25', fg: '--danger', on: { kind: 'worst' }, need: 4.5, scheme: 'dark', note: 'inline validation and error text' },

  // Chrome (both schemes, over live video) — scheme-independent: the chrome tokens are declared
  // once in :root and never redeclared in the dark block (FR-016), so these are asserted once.
  { id: 'C1', fg: '--chrome-fg', on: { kind: 'chrome' }, need: 4.5, note: 'status pill, wordmark, control labels, sandbox badge' },
  { id: 'C2', fg: '--chrome-secondary', on: { kind: 'chrome' }, need: 4.5, note: 'secondary chrome text' },
  { id: 'C3', fg: '--chrome-focus', on: { kind: 'chrome' }, need: 3, note: 'focus ring on chrome controls' },
  {
    id: 'C4',
    fg: '--chrome-bg',
    on: { kind: 'token', name: '--viewfinder-bg' },
    need: 3,
    decorative: true,
    note: 'decorative: the pill is identified by its text, not its edge; what matters is its opacity, asserted separately in e2e',
  },

  // Neutral primary button — scheme-independent, one entry standing for both scheme rows.
  { id: 'NB1', fg: '--sheet-opaque', on: { kind: 'token', name: '--ink' }, need: 4.5, note: 'neutral primary button label' },
];
