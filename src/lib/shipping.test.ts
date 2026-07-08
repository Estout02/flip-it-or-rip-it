import { describe, expect, it } from 'vitest';
import { estimateShipping } from './shipping.js';

describe('estimateShipping', () => {
  it('defaults to the $5.00 flat estimate', () => {
    expect(estimateShipping()).toEqual({
      shippingEstimateCents: 500,
      method: 'FLAT_DEFAULT',
    });
  });

  it('honors a configured flat rate', () => {
    expect(estimateShipping(750)).toEqual({
      shippingEstimateCents: 750,
      method: 'FLAT_DEFAULT',
    });
  });
});
