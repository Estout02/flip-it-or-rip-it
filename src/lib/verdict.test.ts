import { describe, expect, it } from 'vitest';
import {
  computeVerdict,
  estimateValueCents,
  liquidityScore,
  applyRealizationRate,
  liquidityTier,
  resolveLiquidityConfig,
  supplySideLiquidity,
  verdictReasonText,
  LIQUIDITY_DEFAULTS,
  VERDICT_REASON_CODES,
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

describe('liquidityTier', () => {
  it('reports UNPROVEN when nobody else is listing the item', () => {
    // Never STRONG: zero competition is unassessable, not proven-liquid.
    expect(liquidityTier(0)).toBe('UNPROVEN');
  });

  it('bands active supply into strong / moderate / weak', () => {
    expect(liquidityTier(1)).toBe('STRONG');
    expect(liquidityTier(9)).toBe('STRONG');
    expect(liquidityTier(11)).toBe('MODERATE');
    expect(liquidityTier(200)).toBe('WEAK');
  });

  it('resolves boundary counts to the more-liquid side', () => {
    expect(liquidityTier(LIQUIDITY_DEFAULTS.strongMaxListings)).toBe('STRONG');
    expect(liquidityTier(LIQUIDITY_DEFAULTS.moderateMaxListings)).toBe('MODERATE');
    expect(liquidityTier(LIQUIDITY_DEFAULTS.moderateMaxListings + 1)).toBe('WEAK');
  });

  it('honors configured cutoffs', () => {
    const config = resolveLiquidityConfig({ strongMaxListings: 2, moderateMaxListings: 4 });
    expect(liquidityTier(2, config)).toBe('STRONG');
    expect(liquidityTier(4, config)).toBe('MODERATE');
    expect(liquidityTier(5, config)).toBe('WEAK');
  });
});

describe('applyRealizationRate', () => {
  it('haircuts the median by the given rate', () => {
    expect(applyRealizationRate(4000, 0.8)).toBe(3200);
  });

  it('is the identity at a rate of 1', () => {
    expect(applyRealizationRate(3937, 1)).toBe(3937);
  });

  it('rounds to whole cents', () => {
    // 1875 * 0.8 = 1500 exactly; 1874 * 0.8 = 1499.2 → 1499
    expect(applyRealizationRate(1875, 0.8)).toBe(1500);
    expect(applyRealizationRate(1874, 0.8)).toBe(1499);
    expect(Number.isInteger(applyRealizationRate(3333, 0.8))).toBe(true);
  });

  it('leaves a zero value at zero', () => {
    expect(applyRealizationRate(0, 0.8)).toBe(0);
  });
});

describe('computeVerdict', () => {
  const base = {
    pricingBasis: 'ADJUSTED_ASKING_PRICE' as const,
    activeListingCount: 10,
    shippingEstimateCents: 500,
    costBasisCents: 0,
    profitThresholdCents: 1000, // the founder's $10 rule
    realizationRate: 1,
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
    expect(result.pricingBasis).toBe('ADJUSTED_ASKING_PRICE');
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

describe('computeVerdict — liquidity gate (US1)', () => {
  const base = {
    pricingBasis: 'ADJUSTED_ASKING_PRICE' as const,
    shippingEstimateCents: 500,
    costBasisCents: 0,
    profitThresholdCents: 1000,
    realizationRate: 1,
  };
  const FLOODED = 200; // > moderateMaxListings → WEAK
  /** value 4000 → fees 530 → profit 2970, comfortably past 2x the $10 threshold. */
  const VALUABLE = [4000];
  /** value 2400 → fees 318 → profit 1582: over threshold, under the 2x line. */
  const THIN = [2400];

  it('RIPs a flooded market when the margin is thin', () => {
    const result = computeVerdict({
      ...base,
      samplePricesCents: THIN,
      activeListingCount: FLOODED,
    });
    expect(result.profitCents).toBeGreaterThan(base.profitThresholdCents);
    expect(result.verdict).toBe('RIP');
  });

  it('FLIP_RISKYs a flooded market when the item is genuinely valuable', () => {
    const result = computeVerdict({
      ...base,
      samplePricesCents: VALUABLE,
      activeListingCount: FLOODED,
    });
    expect(result.verdict).toBe('FLIP_RISKY');
  });

  it.each([
    ['strong', 5],
    ['moderate', 40],
    ['unproven', 0],
  ])('leaves a plain FLIP alone for %s liquidity', (_tier, activeListingCount) => {
    const result = computeVerdict({ ...base, samplePricesCents: VALUABLE, activeListingCount });
    expect(result.verdict).toBe('FLIP');
  });

  it('never fires the margin split outside the weak tier', () => {
    // Moderate supply with a comfortable margin is a plain FLIP, not FLIP_RISKY.
    const result = computeVerdict({ ...base, samplePricesCents: VALUABLE, activeListingCount: 40 });
    expect(result.profitCents).toBeGreaterThanOrEqual(base.profitThresholdCents * 2);
    expect(result.verdict).toBe('FLIP');
  });

  it('is downgrade-only — an unprofitable flooded item is never promoted', () => {
    const result = computeVerdict({
      ...base,
      samplePricesCents: [1200],
      activeListingCount: FLOODED,
    });
    expect(result.profitCents).toBeLessThan(base.profitThresholdCents);
    expect(result.verdict).toBe('RIP');
  });

  it('lets no-market-data outrank the gate', () => {
    const result = computeVerdict({
      ...base,
      samplePricesCents: [],
      activeListingCount: FLOODED,
    });
    expect(result.verdict).toBe('RIP');
    expect(result.noMarketData).toBe(true);
  });

  it('treats profit exactly at the risky-margin cutoff as the favorable side', () => {
    const result = computeVerdict({
      ...base,
      samplePricesCents: [2000],
      feeRate: 0,
      shippingEstimateCents: 0,
      activeListingCount: FLOODED,
    });
    expect(result.profitCents).toBe(2000); // exactly 2x the threshold
    expect(result.verdict).toBe('FLIP_RISKY');
  });

  it('still signals risk when the user sets a zero threshold', () => {
    // threshold 0 → every profitable item clears the "comfortable" line; the
    // user gets FLIP_RISKY rather than a silent plain FLIP (research R4).
    const result = computeVerdict({
      ...base,
      samplePricesCents: [1000],
      activeListingCount: FLOODED,
      profitThresholdCents: 0,
    });
    expect(result.verdict).toBe('FLIP_RISKY');
  });

  it('shifts every boundary with configured cutoffs', () => {
    const tightened = computeVerdict({
      ...base,
      samplePricesCents: VALUABLE,
      activeListingCount: 3,
      liquidity: { strongMaxListings: 1, moderateMaxListings: 2 },
    });
    expect(tightened.verdict).toBe('FLIP_RISKY');
    const defaults = computeVerdict({ ...base, samplePricesCents: VALUABLE, activeListingCount: 3 });
    expect(defaults.verdict).toBe('FLIP');
  });
});

describe('verdict reasons (US2)', () => {
  const base = {
    pricingBasis: 'ADJUSTED_ASKING_PRICE' as const,
    shippingEstimateCents: 500,
    costBasisCents: 0,
    profitThresholdCents: 1000,
    realizationRate: 1,
  };

  it.each([
    ['NO_MARKET_DATA', { samplePricesCents: [], activeListingCount: 0 }],
    ['BELOW_THRESHOLD', { samplePricesCents: [1200], activeListingCount: 5 }],
    ['WEAK_LIQUIDITY_THIN_MARGIN', { samplePricesCents: [2400], activeListingCount: 200 }],
    ['WEAK_LIQUIDITY_HIGH_VALUE', { samplePricesCents: [4000], activeListingCount: 200 }],
    ['PROFITABLE', { samplePricesCents: [4000], activeListingCount: 5 }],
  ])('emits %s with non-empty copy', (expected, input) => {
    const result = computeVerdict({ ...base, ...input });
    expect(result.reasonCode).toBe(expected);
    expect(result.reason.length).toBeGreaterThan(0);
  });

  it('distinguishes a liquidity RIP from a below-threshold RIP', () => {
    const thinMargin = computeVerdict({
      ...base,
      samplePricesCents: [2400],
      activeListingCount: 200,
    });
    const belowThreshold = computeVerdict({
      ...base,
      samplePricesCents: [1200],
      activeListingCount: 5,
    });
    expect(thinMargin.verdict).toBe('RIP');
    expect(belowThreshold.verdict).toBe('RIP');
    expect(thinMargin.reason).not.toBe(belowThreshold.reason);
  });

  it('names the competing supply in both weak-tier reasons', () => {
    for (const samplePricesCents of [[2400], [4000]]) {
      const result = computeVerdict({ ...base, samplePricesCents, activeListingCount: 340 });
      expect(result.reason).toContain('340');
    }
  });

  it('has copy for every reason code', () => {
    for (const code of VERDICT_REASON_CODES) {
      const text = verdictReasonText(code, { activeListingCount: 42, tier: 'MODERATE' });
      expect(text.length).toBeGreaterThan(0);
    }
  });
});

describe('liquidity honesty (US3)', () => {
  const base = {
    pricingBasis: 'ADJUSTED_ASKING_PRICE' as const,
    shippingEstimateCents: 500,
    costBasisCents: 0,
    profitThresholdCents: 1000,
    realizationRate: 1,
  };

  it('reports the tier alongside the degraded-signal marker', () => {
    const result = computeVerdict({ ...base, samplePricesCents: [4000], activeListingCount: 200 });
    expect(result.liquidityTier).toBe('WEAK');
    expect(result.liquidityBasis).toBe('SUPPLY_SIDE_ONLY');
  });

  it.each([
    ['profitable', [4000], 'FLIP'],
    ['unprofitable', [1200], 'RIP'],
  ])('leaves an unproven item (%s) to profit alone', (_label, samplePricesCents, expected) => {
    // Zero competing listings must never read as STRONG, and must never gate.
    const result = computeVerdict({ ...base, samplePricesCents, activeListingCount: 0 });
    expect(result.liquidityTier).toBe('UNPROVEN');
    expect(result.verdict).toBe(expected);
  });

  it('never claims knowledge of actual sales in weak-tier copy', () => {
    for (const samplePricesCents of [[2400], [4000]]) {
      const result = computeVerdict({ ...base, samplePricesCents, activeListingCount: 340 });
      expect(result.reason).not.toMatch(/\bsold\b|sell-through|sold-through|\bsales\b/i);
    }
  });
});

describe('computeVerdict — realization rate correction (US1)', () => {
  // No realizationRate here on purpose: these exercise the production default.
  const base = {
    pricingBasis: 'ADJUSTED_ASKING_PRICE' as const,
    activeListingCount: 10,
    shippingEstimateCents: 500,
    costBasisCents: 0,
    profitThresholdCents: 1000,
  };

  it('RIPs an item that only cleared the threshold on the uncorrected median', () => {
    // 1800 ask → FLIP uncorrected (profit 1061); 1440 corrected → RIP (profit 749).
    const corrected = computeVerdict({ ...base, samplePricesCents: [1800] });
    const uncorrected = computeVerdict({ ...base, samplePricesCents: [1800], realizationRate: 1 });
    expect(uncorrected.verdict).toBe('FLIP');
    expect(corrected.verdict).toBe('RIP');
    expect(corrected.estimatedValueCents).toBeLessThan(uncorrected.estimatedValueCents);
  });

  it('leaves a comfortably profitable item as FLIP', () => {
    const result = computeVerdict({ ...base, samplePricesCents: [4000] });
    expect(result.estimatedValueCents).toBe(3200);
    expect(result.verdict).toBe('FLIP');
  });

  it('computes fees from the corrected value, never the raw median', () => {
    const result = computeVerdict({ ...base, samplePricesCents: [4000] });
    expect(result.feesCents).toBe(Math.round(3200 * 0.1325));
    expect(result.feesCents).not.toBe(Math.round(4000 * 0.1325));
  });

  it('derives profit from the corrected value', () => {
    const result = computeVerdict({ ...base, samplePricesCents: [4000] });
    expect(result.profitCents).toBe(
      result.estimatedValueCents - result.feesCents - base.shippingEstimateCents,
    );
  });

  it('leaves the no-market-data outcome untouched', () => {
    const result = computeVerdict({ ...base, samplePricesCents: [] });
    expect(result.estimatedValueCents).toBe(0);
    expect(result.verdict).toBe('RIP');
    expect(result.reasonCode).toBe('NO_MARKET_DATA');
    expect(result.noMarketData).toBe(true);
  });

  it('keeps the corrected value a whole number of cents', () => {
    const result = computeVerdict({ ...base, samplePricesCents: [3333] });
    expect(Number.isInteger(result.estimatedValueCents)).toBe(true);
    expect(result.estimatedValueCents).toBe(Math.round(3333 * 0.8));
  });
});

describe('valuation honesty and auditability (US2)', () => {
  const base = {
    pricingBasis: 'ADJUSTED_ASKING_PRICE' as const,
    activeListingCount: 10,
    shippingEstimateCents: 500,
    costBasisCents: 0,
    profitThresholdCents: 1000,
  };

  it.each([
    ['the default rate', undefined],
    ['a rate of exactly 1', 1],
  ])('labels the basis ADJUSTED_ASKING_PRICE at %s', (_label, realizationRate) => {
    // Constant by design: at rate 1 the value has still passed through the
    // correction step, so the label does not flicker with configuration.
    const result = computeVerdict({
      ...base,
      samplePricesCents: [4000],
      ...(realizationRate === undefined ? {} : { realizationRate }),
    });
    expect(result.pricingBasis).toBe('ADJUSTED_ASKING_PRICE');
  });

  it('exposes the raw median and the applied rate on every result', () => {
    const result = computeVerdict({ ...base, samplePricesCents: [3500, 4000, 4500] });
    expect(result.rawAskingMedianCents).toBe(4000);
    expect(result.realizationRate).toBe(0.8);
  });

  it.each([[4000], [1875], [3333], [99], [0]])(
    'stays reconstructable from raw median and rate (sample %i)',
    (price) => {
      const result = computeVerdict({ ...base, samplePricesCents: price === 0 ? [] : [price] });
      expect(Math.round(result.rawAskingMedianCents * result.realizationRate)).toBe(
        result.estimatedValueCents,
      );
    },
  );

  it('reports equal raw and corrected values at a rate of 1', () => {
    const result = computeVerdict({ ...base, samplePricesCents: [3937], realizationRate: 1 });
    expect(result.rawAskingMedianCents).toBe(3937);
    expect(result.estimatedValueCents).toBe(3937);
  });
});

describe('computeVerdict — uncertain match (US3)', () => {
  const base = {
    pricingBasis: 'ADJUSTED_ASKING_PRICE' as const,
    shippingEstimateCents: 500,
    costBasisCents: 0,
    profitThresholdCents: 1000,
    realizationRate: 1,
  };

  it('returns UNCERTAIN when the product match is low confidence', () => {
    const result = computeVerdict({
      ...base,
      samplePricesCents: [4000],
      activeListingCount: 5,
      matchConfidence: 'LOW',
    });
    expect(result.verdict).toBe('UNCERTAIN');
    expect(result.reasonCode).toBe('LOW_MATCH_CONFIDENCE');
    expect(result.reason.length).toBeGreaterThan(0);
  });

  it('still returns figures alongside UNCERTAIN for transparency', () => {
    const result = computeVerdict({
      ...base,
      samplePricesCents: [4000],
      activeListingCount: 5,
      matchConfidence: 'LOW',
    });
    expect(result.estimatedValueCents).toBe(4000);
    expect(result.profitCents).toBeGreaterThan(0);
  });

  it('lets no-market-data outrank low confidence', () => {
    const result = computeVerdict({
      ...base,
      samplePricesCents: [],
      activeListingCount: 5,
      matchConfidence: 'LOW',
    });
    expect(result.verdict).toBe('RIP');
    expect(result.reasonCode).toBe('NO_MARKET_DATA');
  });

  it('outranks the liquidity gate', () => {
    // Weak liquidity AND low confidence: reasoning about supply for an item we
    // could not identify would dress up a guess.
    const result = computeVerdict({
      ...base,
      samplePricesCents: [4000],
      activeListingCount: 300,
      matchConfidence: 'LOW',
    });
    expect(result.verdict).toBe('UNCERTAIN');
    expect(result.reasonCode).toBe('LOW_MATCH_CONFIDENCE');
  });

  it.each([['HIGH'], ['MEDIUM']] as const)(
    'leaves every existing path untouched at %s confidence',
    (matchConfidence) => {
      const flip = computeVerdict({ ...base, samplePricesCents: [4000], activeListingCount: 5, matchConfidence });
      const rip = computeVerdict({ ...base, samplePricesCents: [1200], activeListingCount: 5, matchConfidence });
      expect(flip.verdict).toBe('FLIP');
      expect(rip.verdict).toBe('RIP');
    },
  );

  it('defaults to HIGH when no confidence is supplied', () => {
    const result = computeVerdict({ ...base, samplePricesCents: [4000], activeListingCount: 5 });
    expect(result.matchConfidence).toBe('HIGH');
    expect(result.verdict).toBe('FLIP');
  });
});
