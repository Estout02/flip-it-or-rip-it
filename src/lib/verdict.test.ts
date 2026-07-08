import { describe, expect, it } from 'vitest';
import {
  computeVerdict,
  estimateValueCents,
  liquidityScore,
  supplySideLiquidity,
} from './verdict.js';

describe('estimateValueCents', () => {
  it('returns the median of an odd-length sample', () => {
    expect(estimateValueCents([1000, 5000, 3000])).toBe(3000);
  });

  it('averages the middle pair of an even-length sample', () => {
    expect(estimateValueCents([1000, 2000, 3000, 4000])).toBe(2500);
  });

  it('returns 0 with no sample', () => {
    expect(estimateValueCents([])).toBe(0);
  });
});

describe('supplySideLiquidity', () => {
  it('scores 0 when there are no active listings', () => {
    expect(supplySideLiquidity(0)).toBe(0);
  });

  it('scores 1 at or below the strong-supply cutoff', () => {
    expect(supplySideLiquidity(1)).toBe(1);
    expect(supplySideLiquidity(10)).toBe(1);
  });

  it('decays as active supply grows', () => {
    expect(supplySideLiquidity(100)).toBeCloseTo(0.1);
    expect(supplySideLiquidity(500)).toBeCloseTo(0.02);
  });

  it('honors a configurable strong-supply constant', () => {
    expect(supplySideLiquidity(40, 20)).toBeCloseTo(0.5);
  });
});

describe('liquidityScore (future sold-data formula)', () => {
  it('scores near zero for one sale against huge active supply', () => {
    expect(liquidityScore(1, 200)).toBeLessThan(0.01);
  });

  it('scores high when items sell faster than they are listed', () => {
    expect(liquidityScore(20, 5)).toBeGreaterThan(0.7);
  });
});

describe('computeVerdict', () => {
  const base = {
    pricingBasis: 'ASKING_PRICE' as const,
    activeListingCount: 10,
    shippingEstimateCents: 500,
    costBasisCents: 0,
    profitThresholdCents: 1000, // the founder's $10 rule
  };

  it('says FLIP when profit clears the threshold', () => {
    // median $40, fees ~$5.30, shipping $5 → profit ~$29.70
    const result = computeVerdict({ ...base, samplePricesCents: [3500, 4000, 4500] });
    expect(result.verdict).toBe('FLIP');
    expect(result.profitCents).toBeGreaterThanOrEqual(1000);
    expect(result.noMarketData).toBe(false);
  });

  it('says FLIP when profit lands exactly on the threshold', () => {
    // value 2000, fees 200 (10%), shipping 500 → profit exactly 1300 == threshold
    const result = computeVerdict({
      ...base,
      samplePricesCents: [2000],
      shippingEstimateCents: 500,
      feeRate: 0.1,
      profitThresholdCents: 1300, // 2000 − 200 − 500 = 1300 exactly
    });
    expect(result.profitCents).toBe(1300);
    expect(result.verdict).toBe('FLIP');
  });

  it('says RIP when profit is under the threshold', () => {
    // median $12, fees ~$1.59, shipping $5 → profit ~$5.41
    const result = computeVerdict({ ...base, samplePricesCents: [1100, 1200, 1300] });
    expect(result.verdict).toBe('RIP');
  });

  it('says RIP with noMarketData when the sample is empty', () => {
    const result = computeVerdict({ ...base, samplePricesCents: [] });
    expect(result.verdict).toBe('RIP');
    expect(result.estimatedValueCents).toBe(0);
    expect(result.noMarketData).toBe(true);
    expect(result.sampleSize).toBe(0);
    expect(result.liquidityScore).toBe(1); // 10 active listings → strong supply signal
  });

  it('subtracts cost basis from profit', () => {
    const withoutCost = computeVerdict({ ...base, samplePricesCents: [4000, 4000, 4000] });
    const withCost = computeVerdict({
      ...base,
      samplePricesCents: [4000, 4000, 4000],
      costBasisCents: 2500,
    });
    expect(withCost.profitCents).toBe(withoutCost.profitCents - 2500);
    expect(withCost.verdict).toBe('RIP');
  });

  it('always flags the pricing and liquidity bases', () => {
    const result = computeVerdict({ ...base, samplePricesCents: [4000] });
    expect(result.pricingBasis).toBe('ASKING_PRICE');
    expect(result.liquidityBasis).toBe('SUPPLY_SIDE_ONLY');
  });

  it('uses supply-side liquidity from the active-listing count', () => {
    const result = computeVerdict({
      ...base,
      samplePricesCents: [4000],
      activeListingCount: 200,
    });
    expect(result.liquidityScore).toBeCloseTo(0.05);
  });
});
