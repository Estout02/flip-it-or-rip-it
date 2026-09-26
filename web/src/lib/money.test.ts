import { describe, expect, it } from 'vitest';
import { centsToDollarInput, describeProfit, formatCents, MONEY_INPUT_ERROR, parseDollarsToCents } from './money';

describe('parseDollarsToCents', () => {
  it.each([
    ['12', 1200],
    ['12.5', 1250],
    ['12.50', 1250],
    ['$1,234.05', 123405],
    ['0', 0],
    [' 8 ', 800],
    ['0.07', 7],
    ['999999.99', 99999999],
  ])('%j → %d cents', (input, cents) => {
    expect(parseDollarsToCents(input)).toEqual({ ok: true, cents });
  });

  it.each(['-1', '1.234', 'abc', '', '1234567', '1.', '.5', '1e3'])('rejects %j', (input) => {
    expect(parseDollarsToCents(input)).toEqual({ ok: false, error: MONEY_INPUT_ERROR });
  });

  it('avoids float error (0.29 × 100 = 28.999…)', () => {
    expect(parseDollarsToCents('0.29')).toEqual({ ok: true, cents: 29 });
    expect(parseDollarsToCents('4.35')).toEqual({ ok: true, cents: 435 });
  });
});

describe('formatCents', () => {
  it('formats zero, positive and negative with a true minus sign', () => {
    expect(formatCents(0)).toBe('$0.00');
    expect(formatCents(2207)).toBe('$22.07');
    expect(formatCents(-320)).toBe('−$3.20');
    expect(formatCents(123405)).toBe('$1,234.05');
  });
});

describe('describeProfit', () => {
  it('reads a gain as profit and a loss in words', () => {
    expect(describeProfit(2207)).toBe('+$22.07 profit');
    expect(describeProfit(0)).toBe('+$0.00 profit');
    expect(describeProfit(-320)).toBe('loses $3.20');
  });
});

describe('centsToDollarInput', () => {
  it('round-trips through parseDollarsToCents', () => {
    for (const c of [0, 5, 2500, 2550, 99999999]) {
      expect(parseDollarsToCents(centsToDollarInput(c))).toEqual({ ok: true, cents: c });
    }
    expect(centsToDollarInput(2550)).toBe('25.50');
    expect(centsToDollarInput(2500)).toBe('25');
  });
});
