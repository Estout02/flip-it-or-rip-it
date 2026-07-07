import { describe, expect, it } from 'vitest';
import { computeVerdict, estimateValueCents, liquidityScore } from './verdict.js';

describe('estimateValueCents', () => {
  it('returns the median of an odd-length sample', () => {
    expect(estimateValueCents([1000, 5000, 3000])).toBe(3000);
  });

  it('averages the middle pair of an even-length sample', () => {
    expect(estimateValueCents([1000, 2000, 3000, 4000])).toBe(2500);
  });

  it('returns 0 with no sold history', () => {
    expect(estimateValueCents([])).toBe(0);
  });
});

describe('liquidityScore', () => {
  it('scores near zero for one sale against huge active supply', () => {
    expect(liquidityScore(1, 200)).toBeLessThan(0.01);
  });

  it('scores high when items sell faster than they are listed', () => {
    expect(liquidityScore(20, 5)).toBeGreaterThan(0.7);
  });
});

describe('computeVerdict', () => {
  const base = {
    activeListingCount: 10,
    shippingEstimateCents: 500,
    costBasisCents: 0,
    profitThresholdCents: 1000, // the founder's $10 rule
  };

  it('says FLIP when profit clears the threshold', () => {
    // median $40, fees ~$5.30, shipping $5 → profit ~$29.70
    const result = computeVerdict({ ...base, soldPricesCents: [3500, 4000, 4500] });
    expect(result.verdict).toBe('FLIP');
    expect(result.profitCents).toBeGreaterThanOrEqual(1000);
  });

  it('says RIP when profit is under the threshold', () => {
    // median $12, fees ~$1.59, shipping $5 → profit ~$5.41
    const result = computeVerdict({ ...base, soldPricesCents: [1100, 1200, 1300] });
    expect(result.verdict).toBe('RIP');
  });

  it('says RIP when there is no sold history at all', () => {
    const result = computeVerdict({ ...base, soldPricesCents: [] });
    expect(result.verdict).toBe('RIP');
    expect(result.estimatedValueCents).toBe(0);
  });

  it('subtracts cost basis from profit', () => {
    const withoutCost = computeVerdict({ ...base, soldPricesCents: [4000, 4000, 4000] });
    const withCost = computeVerdict({
      ...base,
      soldPricesCents: [4000, 4000, 4000],
      costBasisCents: 2500,
    });
    expect(withCost.profitCents).toBe(withoutCost.profitCents - 2500);
    expect(withCost.verdict).toBe('RIP');
  });
});
