// Canned API responses for unit and component tests, drawn from the 0.6.0 contract examples.
import type { HistoryEntry, VerdictResult } from '../lib/types';

const base: VerdictResult = {
  verdict: 'FLIP',
  estimatedValueCents: 3120,
  rawAskingMedianCents: 3900,
  realizationRate: 0.8,
  feesCents: 413,
  shippingEstimateCents: 500,
  profitCents: 2207,
  liquidityScore: 1,
  liquidityTier: 'STRONG',
  liquidityBasis: 'SUPPLY_SIDE_ONLY',
  reasonCode: 'PROFITABLE',
  matchConfidence: 'HIGH',
  matchedCategoryName: 'Video Games',
  matchDominance: 0.82,
  matchFiltered: true,
  reason: 'Clears your profit threshold with little competing supply.',
  sampleSize: 10,
  pricingBasis: 'ADJUSTED_ASKING_PRICE',
  noMarketData: false,
  matchedTitle: 'Chrono Trigger (Super Nintendo, 1995) — Cart Only',
  rawActiveListingCount: 120,
  competingSupplyCount: 98,
  cached: false,
  query: { identifier: null, title: 'Chrono Trigger SNES' },
};

export const flip: VerdictResult = base;

export const risky: VerdictResult = {
  ...base,
  verdict: 'FLIP_RISKY',
  estimatedValueCents: 12000,
  rawAskingMedianCents: 15000,
  feesCents: 1590,
  profitCents: 9910,
  liquidityScore: 0.03,
  liquidityTier: 'WEAK',
  reasonCode: 'WEAK_LIQUIDITY_HIGH_VALUE',
  matchedCategoryName: 'Books',
  reason: 'Worth enough to be worth listing, but 340 sellers are competing — expect a slow sale.',
  matchedTitle: 'Rare Hardcover First Edition',
  rawActiveListingCount: 340,
  competingSupplyCount: 340,
  query: { identifier: '9780345391803', title: null },
};

export const rip: VerdictResult = {
  ...base,
  verdict: 'RIP',
  estimatedValueCents: 1760,
  rawAskingMedianCents: 2200,
  feesCents: 233,
  profitCents: 1027,
  liquidityScore: 0.05,
  liquidityTier: 'WEAK',
  reasonCode: 'WEAK_LIQUIDITY_THIN_MARGIN',
  matchConfidence: 'MEDIUM',
  matchedCategoryName: 'Books',
  matchDominance: 0.44,
  reason: 'Only a little over your threshold, and 200 sellers are competing — not worth the wait.',
  matchedTitle: 'Common Paperback',
  rawActiveListingCount: 450,
  competingSupplyCount: 200,
  cached: true,
  query: { identifier: null, title: 'Common Paperback' },
};

export const uncertain: VerdictResult = {
  ...base,
  verdict: 'UNCERTAIN',
  estimatedValueCents: 1200,
  rawAskingMedianCents: 1500,
  feesCents: 159,
  profitCents: 541,
  liquidityScore: 0.05,
  liquidityTier: 'WEAK',
  reasonCode: 'LOW_MATCH_CONFIDENCE',
  reason: 'Matching listings span too wide a range to identify one product — check the matched title.',
  matchConfidence: 'LOW',
  matchDominance: 0.73,
  sampleSize: 36,
  matchedTitle: 'Chrono Trigger Super Famicom SNES Japanese Version',
  rawActiveListingCount: 60,
  competingSupplyCount: 44,
};

export const noMarket: VerdictResult = {
  ...base,
  verdict: 'RIP',
  estimatedValueCents: 0,
  rawAskingMedianCents: 0,
  feesCents: 0,
  shippingEstimateCents: 500,
  profitCents: -500,
  liquidityScore: 0,
  liquidityTier: 'UNPROVEN',
  reasonCode: 'NO_MARKET_DATA',
  reason: 'No matching listings found.',
  matchedCategoryName: null,
  matchDominance: 0,
  matchFiltered: false,
  sampleSize: 0,
  noMarketData: true,
  matchedTitle: null,
  rawActiveListingCount: 0,
  competingSupplyCount: 0,
  query: { identifier: '9780000000002', title: null },
};

export function entryFor(result: VerdictResult, overrides: Partial<HistoryEntry> = {}): HistoryEntry {
  return {
    id: overrides.id ?? `id-${Math.random().toString(36).slice(2)}`,
    checkedAt: overrides.checkedAt ?? '2026-09-26T19:42:00.000Z',
    query: overrides.query ?? result.query,
    costBasisCents: overrides.costBasisCents ?? 0,
    result,
  };
}

export function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}
