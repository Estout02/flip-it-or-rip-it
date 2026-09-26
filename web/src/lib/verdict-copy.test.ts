import { describe, expect, it } from 'vitest';
import { noMarket, risky, uncertain, flip } from '../test/fixtures';
import {
  BASIS_NOTE,
  competitionPhrase,
  isTestEnv,
  NO_MARKET_REASON,
  nextUtcMidnightLocal,
  reasonFor,
  recentProfitPhrase,
  SANDBOX_NO_MARKET,
  TEST_DATA_EXPLAIN,
  TEST_DATA_LABEL,
  TEST_DATA_WIDE,
  UNCERTAIN_REASON,
  VERDICT_COPY,
} from './verdict-copy';

describe('verdict copy (verbatim from ui-states.md)', () => {
  it('labels and eyebrows', () => {
    expect(VERDICT_COPY.FLIP).toMatchObject({ label: 'Flip it', eyebrow: 'Worth selling' });
    expect(VERDICT_COPY.FLIP_RISKY).toMatchObject({
      label: 'Flip it — slow seller',
      eyebrow: 'Worth listing, expect to wait',
    });
    expect(VERDICT_COPY.RIP).toMatchObject({ label: 'Rip it', eyebrow: 'Not worth your time. Donate or recycle it.' });
    expect(VERDICT_COPY.UNCERTAIN).toMatchObject({ label: "Can't tell", eyebrow: "We couldn't identify this item" });
  });

  it('basis note', () => {
    expect(BASIS_NOTE).toBe(
      'Estimated from current eBay asking prices, adjusted toward typical sale prices. Competition counts similar active listings, not sales.',
    );
  });

  it('reason overrides for UNCERTAIN and NO_MARKET_DATA', () => {
    expect(reasonFor(flip)).toBe(flip.reason);
    expect(reasonFor(risky)).toBe(risky.reason);
    expect(reasonFor(uncertain)).toBe(UNCERTAIN_REASON);
    expect(reasonFor(noMarket)).toBe(NO_MARKET_REASON);
  });

  it('competition phrases per tier', () => {
    expect(competitionPhrase('STRONG', 98)).toBe('Low competition · 98 similar listings');
    expect(competitionPhrase('MODERATE', 30)).toBe('Some competition · 30 similar listings');
    expect(competitionPhrase('WEAK', 1200)).toBe('Crowded market · 1,200 similar listings');
    expect(competitionPhrase('UNPROVEN', 0)).toBe('No other sellers listing this right now');
    expect(competitionPhrase('STRONG', 1)).toBe('Low competition · 1 similar listing');
  });

  it('never phrases unmeasured values as profit in Recent', () => {
    expect(recentProfitPhrase(flip)).toBe('+$22.07 profit');
    expect(recentProfitPhrase(noMarket)).toBe('no listings found');
    expect(recentProfitPhrase(uncertain)).toBe('no reliable price');
  });
});

describe('nextUtcMidnightLocal', () => {
  it('formats the next 00:00 UTC as a local clock time', () => {
    const now = new Date('2026-09-26T15:00:00Z');
    const expected = new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit' }).format(
      new Date('2026-09-27T00:00:00Z'),
    );
    expect(nextUtcMidnightLocal(now)).toBe(expected);
  });

  it('rolls over at exactly midnight UTC to the following day', () => {
    const now = new Date('2026-09-27T00:00:00Z');
    const expected = new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit' }).format(
      new Date('2026-09-28T00:00:00Z'),
    );
    expect(nextUtcMidnightLocal(now)).toBe(expected);
  });
});

describe('environment copy (spec 007)', () => {
  it('the badge text assembles to the FR-002 sentence', () => {
    expect(TEST_DATA_LABEL + TEST_DATA_WIDE + TEST_DATA_EXPLAIN).toBe(
      "Test data — eBay sandbox. Results come from eBay's test environment, not real listings.",
    );
  });

  it('sandbox no-market sentence', () => {
    expect(SANDBOX_NO_MARKET).toBe(
      "You're using eBay's test environment, which has very few listings. This item may well be for sale on real eBay.",
    );
  });

  it('isTestEnv', () => {
    expect(isTestEnv('sandbox')).toBe(true);
    expect(isTestEnv('staging')).toBe(true);
    expect(isTestEnv('production')).toBe(false);
    expect(isTestEnv(undefined)).toBe(false);
  });
});
