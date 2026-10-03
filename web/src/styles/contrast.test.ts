// SC-002 / FR-013 gate (research R5): reads tokens.css from disk (no CSS-parser dependency,
// FR-025), brace-matches the :root block and the prefers-color-scheme: dark block, and checks
// every pair in contrast-contract.ts meets its WCAG 2.2 requirement under the measurement rule
// pinned in specs/008-native-sheet-ui/contracts/color-contract.md: composite in floating point,
// round each channel to an integer 0-255, then compute relative luminance and the ratio.
import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { CAPSULE_ALPHA, GROUND_COMPOSITE, PAIRS, type Pair, type Treatment } from './contrast-contract';

const cssPath = path.join(__dirname, 'tokens.css');
const css = fs.readFileSync(cssPath, 'utf-8');

function findMatchingBrace(text: string, openIndex: number): number {
  let depth = 0;
  for (let i = openIndex; i < text.length; i += 1) {
    if (text[i] === '{') depth += 1;
    else if (text[i] === '}') {
      depth -= 1;
      if (depth === 0) return i;
    }
  }
  throw new Error(`unbalanced braces from index ${openIndex}`);
}

function extractBlock(text: string, marker: string): string {
  const markerIndex = text.indexOf(marker);
  if (markerIndex === -1) throw new Error(`marker not found: ${marker}`);
  const openIndex = text.indexOf('{', markerIndex);
  const closeIndex = findMatchingBrace(text, openIndex);
  return text.slice(openIndex + 1, closeIndex);
}

function parseVars(block: string): Record<string, string> {
  const vars: Record<string, string> = {};
  const re = /--([a-zA-Z0-9-]+)\s*:\s*([^;]+);/g;
  let match: RegExpExecArray | null;
  // eslint-disable-next-line no-cond-assign
  while ((match = re.exec(block))) {
    vars[`--${match[1]!}`] = match[2]!.trim();
  }
  return vars;
}

const rootBlock = extractBlock(css, ':root {');
const darkMediaBlock = extractBlock(css, '@media (prefers-color-scheme: dark) {');
const darkRootBlock = extractBlock(darkMediaBlock, ':root {');

const rootVars = parseVars(rootBlock);
const darkOverrideVars = parseVars(darkRootBlock);

// Token-resolution rule (pinned): light = :root alone; dark = :root merged with the dark block's
// overrides (dark wins) — exactly how the cascade behaves. This is what lets the scheme-independent
// chrome/NB1 pairs resolve in both schemes even though they are declared only in :root (FR-016).
const varsByScheme = {
  light: rootVars,
  dark: { ...rootVars, ...darkOverrideVars },
} as const;

type Scheme = 'light' | 'dark';
type RGB = { r: number; g: number; b: number };
type RGBA = RGB & { a: number };

function parseColor(raw: string): RGBA {
  const value = raw.trim();
  const hexMatch = /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.exec(value);
  if (hexMatch) {
    const hex = hexMatch[1]!;
    const full = hex.length === 3 ? hex.split('').map((c) => c + c).join('') : hex;
    const num = parseInt(full, 16);
    return { r: (num >> 16) & 255, g: (num >> 8) & 255, b: num & 255, a: 1 };
  }
  const rgbaMatch = /^rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)\s*(?:,\s*([\d.]+)\s*)?\)$/.exec(value);
  if (rgbaMatch) {
    return {
      r: Number(rgbaMatch[1]!),
      g: Number(rgbaMatch[2]!),
      b: Number(rgbaMatch[3]!),
      a: rgbaMatch[4] !== undefined ? Number(rgbaMatch[4]) : 1,
    };
  }
  throw new Error(`unparseable color: ${raw}`);
}

function req(vars: Record<string, string>, name: string): string {
  const value = vars[name];
  if (value === undefined) throw new Error(`token not found: ${name}`);
  return value;
}

function roundToOpaque(c: RGBA): RGB {
  return { r: Math.round(c.r), g: Math.round(c.g), b: Math.round(c.b) };
}

/** Alpha-composites `top` (translucent) over an already-opaque `bottom`, rounding each channel. */
function roundComposite(top: RGBA, bottom: RGB): RGB {
  const a = top.a;
  return {
    r: Math.round(top.r * a + bottom.r * (1 - a)),
    g: Math.round(top.g * a + bottom.g * (1 - a)),
    b: Math.round(top.b * a + bottom.b * (1 - a)),
  };
}

function toHex({ r, g, b }: RGB): string {
  return `#${[r, g, b].map((c) => c.toString(16).padStart(2, '0')).join('')}`.toUpperCase();
}

function srgbToLinear(c: number): number {
  const v = c / 255;
  return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
}

function relativeLuminance({ r, g, b }: RGB): number {
  return 0.2126 * srgbToLinear(r) + 0.7152 * srgbToLinear(g) + 0.0722 * srgbToLinear(b);
}

function contrastRatio(a: RGB, b: RGB): number {
  const la = relativeLuminance(a);
  const lb = relativeLuminance(b);
  const lighter = Math.max(la, lb);
  const darker = Math.min(la, lb);
  return (lighter + 0.05) / (darker + 0.05);
}

/** Ratios are reported to two decimals, rounded half-up (color-contract.md). */
function round2(x: number): number {
  return Math.round((x + Number.EPSILON) * 100) / 100;
}

function resolveGround(on: Pair['on'], scheme: Scheme, vars: Record<string, string>): RGB {
  switch (on.kind) {
    case 'worst': {
      const glass = parseColor(req(vars, '--sheet-glass'));
      const over = parseColor(GROUND_COMPOSITE[scheme].over);
      return roundComposite(glass, over);
    }
    case 'opaque':
      return roundToOpaque(parseColor(req(vars, '--sheet-opaque')));
    case 'chrome':
      return roundToOpaque(parseColor(req(vars, '--chrome-bg')));
    case 'capsule': {
      const tint = parseColor(req(vars, `--tint-${on.treatment}`));
      const opaque = roundToOpaque(parseColor(req(vars, '--sheet-opaque')));
      return roundComposite({ ...tint, a: CAPSULE_ALPHA[scheme] }, opaque);
    }
    case 'token':
      return roundToOpaque(parseColor(req(vars, on.name)));
    default:
      throw new Error(`unhandled ground kind: ${JSON.stringify(on)}`);
  }
}

function resolveFg(fg: string, vars: Record<string, string>): RGB {
  return roundToOpaque(parseColor(req(vars, fg)));
}

function groundLabel(on: Pair['on']): string {
  switch (on.kind) {
    case 'worst':
      return 'worst';
    case 'opaque':
      return 'opaque';
    case 'chrome':
      return 'chrome';
    case 'capsule':
      return `capsule:${on.treatment}`;
    case 'token':
      return on.name;
    default:
      return 'unknown';
  }
}

/** Schemes a pair is checked in: its own, both for NB1, or 'light' alone for the other
 *  scheme-independent (chrome) rows — the underlying tokens are identical in both schemes anyway. */
function schemesFor(pair: Pair): Scheme[] {
  if (pair.scheme) return [pair.scheme];
  if (pair.id === 'NB1') return ['light', 'dark'];
  return ['light'];
}

function ratioFor(pair: Pair, scheme: Scheme): number {
  const vars = varsByScheme[scheme];
  const fgColor = resolveFg(pair.fg, vars);
  const groundColor = resolveGround(pair.on, scheme, vars);
  return round2(contrastRatio(fgColor, groundColor));
}

describe('contrast contract (SC-002, FR-013)', () => {
  it('each non-decorative pair meets its requirement', () => {
    for (const pair of PAIRS) {
      if (pair.decorative) continue;
      for (const scheme of schemesFor(pair)) {
        const ratio = ratioFor(pair, scheme);
        expect(
          ratio,
          `${pair.id} ${pair.fg} on ${groundLabel(pair.on)} (${scheme}): ${ratio} < ${pair.need}`,
        ).toBeGreaterThanOrEqual(pair.need);
      }
    }
  });

  it('the worst-case grounds are the documented composites', () => {
    expect(toHex(resolveGround({ kind: 'worst' }, 'light', varsByScheme.light))).toBe('#EEEEEE');
    expect(toHex(resolveGround({ kind: 'worst' }, 'dark', varsByScheme.dark))).toBe('#272729');
  });

  it('every --caps-* equals its tint composited at the scheme alpha over --sheet-opaque', () => {
    const lightExpected: Record<Treatment, string> = {
      flip: '#D4E6E4',
      risky: '#EAE2D4',
      rip: '#DFE0E4',
      unc: '#DCDDEF',
    };
    const darkExpected: Record<Treatment, string> = {
      flip: '#1D3931',
      risky: '#3E3325',
      rip: '#313337',
      unc: '#2F3041',
    };
    for (const treatment of ['flip', 'risky', 'rip', 'unc'] as const) {
      expect(toHex(resolveGround({ kind: 'capsule', treatment }, 'light', varsByScheme.light))).toBe(
        lightExpected[treatment],
      );
      expect(toHex(roundToOpaque(parseColor(req(varsByScheme.light, `--caps-${treatment}`))))).toBe(
        lightExpected[treatment],
      );
      expect(toHex(resolveGround({ kind: 'capsule', treatment }, 'dark', varsByScheme.dark))).toBe(
        darkExpected[treatment],
      );
      expect(toHex(roundToOpaque(parseColor(req(varsByScheme.dark, `--caps-${treatment}`))))).toBe(
        darkExpected[treatment],
      );
    }
  });

  it('every token named in a scheme-specific pair exists in both blocks', () => {
    // Scheme-specific pairs (L*/D*): a renamed token must not silently drop out of either block.
    for (const pair of PAIRS) {
      if (!pair.scheme) continue;
      const names = [pair.fg, ...(pair.on.kind === 'token' ? [pair.on.name] : [])];
      for (const name of names) {
        expect(Object.prototype.hasOwnProperty.call(rootVars, name), `${pair.id}: ${name} missing from :root`).toBe(
          true,
        );
        expect(
          Object.prototype.hasOwnProperty.call(darkOverrideVars, name),
          `${pair.id}: ${name} missing from the dark block`,
        ).toBe(true);
      }
    }
    // Scheme-independent pairs (C1-C4, NB1) are asserted to exist in :root only: T002 deliberately
    // declares the chrome tokens once and never redeclares them in the dark block (FR-016), so
    // requiring them in both here would fail this package's own verify.
    for (const pair of PAIRS) {
      if (pair.scheme) continue;
      const names = [pair.fg, ...(pair.on.kind === 'token' ? [pair.on.name] : [])];
      for (const name of names) {
        expect(Object.prototype.hasOwnProperty.call(rootVars, name), `${pair.id}: ${name} missing from :root`).toBe(
          true,
        );
      }
    }
  });

  it('parser anchors', () => {
    const anchors: Array<{ id: string; scheme: Scheme; expected: number }> = [
      { id: 'L1', scheme: 'light', expected: 17.06 },
      { id: 'L3', scheme: 'light', expected: 4.82 },
      { id: 'L5', scheme: 'light', expected: 3.5 },
      { id: 'L6', scheme: 'light', expected: 3.51 },
      { id: 'L21', scheme: 'light', expected: 3.14 },
      { id: 'D1', scheme: 'dark', expected: 13.69 },
      { id: 'D23', scheme: 'dark', expected: 7.14 },
      { id: 'C1', scheme: 'light', expected: 15.63 },
    ];
    for (const { id, scheme, expected } of anchors) {
      const pair = PAIRS.find((p) => p.id === id);
      if (!pair) throw new Error(`no such pair: ${id}`);
      const ratio = ratioFor(pair, scheme);
      expect(Math.abs(ratio - expected), `${id} (${scheme}): ${ratio} vs anchor ${expected}`).toBeLessThanOrEqual(
        0.02,
      );
    }
  });
});
