// Every user-facing string for results and errors, verbatim from
// specs/006-web-client/contracts/ui-states.md. Change copy there first.
import { describeProfit } from './money';
import type { HistoryEntry, LiquidityTier, Verdict, VerdictResult } from './types';

export type IconName =
  | 'tag'
  | 'hourglass'
  | 'heart-hand'
  | 'question'
  | 'scan'
  | 'settings'
  | 'alert'
  | 'check'
  | 'clock'
  | 'trash'
  | 'close';

export type Treatment = 'flip' | 'risky' | 'rip' | 'unc';

export const VERDICT_COPY: Record<Verdict, { label: string; eyebrow: string; icon: IconName; treatment: Treatment }> = {
  FLIP: { label: 'Flip it', eyebrow: 'Worth selling', icon: 'tag', treatment: 'flip' },
  FLIP_RISKY: {
    label: 'Flip it — slow seller',
    eyebrow: 'Worth listing, expect to wait',
    icon: 'hourglass',
    treatment: 'risky',
  },
  RIP: { label: 'Rip it', eyebrow: 'Not worth your time. Donate or recycle it.', icon: 'heart-hand', treatment: 'rip' },
  UNCERTAIN: { label: "Can't tell", eyebrow: "We couldn't identify this item", icon: 'question', treatment: 'unc' },
};

export const BASIS_NOTE =
  'Estimated from current eBay asking prices, adjusted toward typical sale prices. Competition counts similar active listings, not sales.';

export const UNCERTAIN_REASON =
  "We found listings, but they don't agree on one product, so any price would be a guess.";
export const NO_MARKET_REASON = "No one is selling this on eBay right now, so there's no price to go on.";

export const UNCERTAIN_SUGGEST_SCAN = 'Scan the barcode if it has one';
export const UNCERTAIN_SUGGEST_DETAILS = 'Add details: platform, edition, or year';
export const ROUGH_FIGURES_SUMMARY = 'Show rough figures (unreliable)';
export const ROUGH_FIGURES_NOTE = 'These figures may be for a different product.';
export const MEDIUM_MATCH_BADGE = 'Likely match — check the title';

export const EMPTY_HEADING = 'Scan or type an item';
export const EMPTY_BODY = "You'll get a verdict — flip it or rip it — with the numbers behind it.";
export const CHECKING = 'Checking…';

export function isNoMarket(r: VerdictResult): boolean {
  return r.reasonCode === 'NO_MARKET_DATA' || r.noMarketData;
}

/** The sentence under the verdict label (API `reason`, except the S5/S6 overrides). */
export function reasonFor(r: VerdictResult): string {
  if (isNoMarket(r)) return NO_MARKET_REASON;
  if (r.verdict === 'UNCERTAIN') return UNCERTAIN_REASON;
  return r.reason;
}

const count = new Intl.NumberFormat('en-US');

export function competitionPhrase(tier: LiquidityTier, n: number): string {
  // "1 similar listings" would read as a typo; pluralise (a grammatical tweak to the contract copy).
  const listings = `${count.format(n)} similar ${n === 1 ? 'listing' : 'listings'}`;
  switch (tier) {
    case 'STRONG':
      return `Low competition · ${listings}`;
    case 'MODERATE':
      return `Some competition · ${listings}`;
    case 'WEAK':
      return `Crowded market · ${listings}`;
    case 'UNPROVEN':
      return 'No other sellers listing this right now';
  }
}

/** Profit phrase for the Recent list. Unmeasured values are never shown as a profit. */
export function recentProfitPhrase(r: VerdictResult): string {
  if (isNoMarket(r)) return 'no listings found';
  if (r.verdict === 'UNCERTAIN') return 'no reliable price';
  return describeProfit(r.profitCents);
}

export function entryTitle(e: HistoryEntry): string {
  return e.result.matchedTitle ?? e.query.title ?? e.query.identifier ?? 'Unknown item';
}

const clock = new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit' });
const dayAndClock = new Intl.DateTimeFormat(undefined, {
  month: 'short',
  day: 'numeric',
  hour: 'numeric',
  minute: '2-digit',
});

/** "3:42 PM" today, "Sep 24, 3:42 PM" otherwise. */
export function formatCheckedAt(iso: string, now: Date = new Date()): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const sameDay =
    d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth() && d.getDate() === now.getDate();
  return (sameDay ? clock : dayAndClock).format(d);
}

export function historyNote(iso: string, now: Date = new Date()): string {
  return `Checked ${formatCheckedAt(iso, now)}. Saved result, not refreshed.`;
}

/** S8: the next 00:00 UTC, as a local clock time (e.g. "8:00 PM"). */
export function nextUtcMidnightLocal(now: Date = new Date()): string {
  const next = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1));
  return new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit' }).format(next);
}

export const ERROR_COPY = {
  limit: {
    heading: "You've hit today's limit",
    body: (cap: number, time: string) =>
      `This network has used all ${cap} free lookups for today. They reset at ${time}.`,
    recent: 'Your recent lookups are still here.',
  },
  unavailable: { heading: "eBay isn't answering", body: 'This usually clears up in a few seconds.' },
  offline: { heading: "You're offline", body: 'Lookups need a connection. Your recent lookups are still available.' },
  unexpected: { heading: 'Something went wrong', body: "It's on our side, not yours." },
  retry: 'Try again',
} as const;

export const SCANNER_COPY = {
  prompt: 'Point at a barcode',
  unavailableHeading: 'Camera not available',
  denied: 'Camera access was blocked. You can allow it in your browser settings, or type the number under the barcode.',
  unsupported: "This browser can't scan barcodes. Type the number under the barcode instead.",
  typeInstead: 'Type it instead',
  cancel: 'Cancel',
} as const;

export const STORAGE_UNAVAILABLE = "Recent lookups can't be saved in this browser.";
