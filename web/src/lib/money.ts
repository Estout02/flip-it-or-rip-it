// Money helpers (constitution VI, research R7). Cents are integers end to end; dollar input
// is parsed by composing integers — never `parseFloat(s) * 100`.

export const MONEY_INPUT_ERROR = 'Enter an amount like 12 or 12.50';

export type ParseResult = { ok: true; cents: number } | { ok: false; error: string };

const DOLLARS = /^(\d{1,6})(?:\.(\d{1,2}))?$/;

export function parseDollarsToCents(input: string): ParseResult {
  const cleaned = input.trim().replace(/^\$/, '').replace(/,/g, '');
  const m = DOLLARS.exec(cleaned);
  if (!m) return { ok: false, error: MONEY_INPUT_ERROR };
  const whole = Number.parseInt(m[1]!, 10);
  const frac = m[2] === undefined ? 0 : Number.parseInt(m[2].padEnd(2, '0'), 10);
  return { ok: true, cents: whole * 100 + frac };
}

const usd = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' });
const MINUS = '−'; // true minus sign, not a hyphen

/** "$22.07", "−$3.20". Division happens only here, at the display edge. */
export function formatCents(cents: number): string {
  const abs = usd.format(Math.abs(cents) / 100);
  return cents < 0 ? `${MINUS}${abs}` : abs;
}

/** Hero phrase: "+$22.07 profit" or "loses $3.20" (words, not color alone). */
export function describeProfit(cents: number): string {
  return cents >= 0 ? `+${formatCents(cents)} profit` : `loses ${formatCents(-cents)}`;
}

/** Pre-fills a dollar input from cents: 2500 → "25", 2550 → "25.50". Integer math only. */
export function centsToDollarInput(cents: number): string {
  const whole = Math.trunc(cents / 100);
  const frac = cents % 100;
  return frac === 0 ? String(whole) : `${whole}.${String(frac).padStart(2, '0')}`;
}
