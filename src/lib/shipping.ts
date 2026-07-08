// Pipeline step 3: shipping estimate. Flat rate for MVP; the method
// discriminator lets weight/category estimators land without a shape change.

export interface ShippingEstimate {
  shippingEstimateCents: number;
  method: 'FLAT_DEFAULT';
}

export const DEFAULT_SHIPPING_FLAT_CENTS = 500;

export function estimateShipping(
  flatCents: number = DEFAULT_SHIPPING_FLAT_CENTS,
): ShippingEstimate {
  return { shippingEstimateCents: flatCents, method: 'FLAT_DEFAULT' };
}
