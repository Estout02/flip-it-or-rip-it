// Wire types + injectable client interface for the eBay Browse integration.
// Tests fake EbayBrowseClient; only ebay/browse.ts talks to the real API.

export type EbayEnv = 'sandbox' | 'production';

export interface ListingSummary {
  title: string;
  /** Converted from eBay's price.value (USD string) at the client boundary. */
  priceCents: number;
  /** eBay product id when the listing is catalog-matched. */
  epid?: string;
  /** Leaf category, transported for product matching — never interpreted here. */
  leafCategoryId?: string;
  leafCategoryName?: string;
}

export interface SearchResult {
  listings: ListingSummary[];
  /** eBay's `total` for the query — active-listing supply, feeds liquidity. */
  totalActive: number;
}

export interface EbayBrowseClient {
  search(query: { gtin?: string; title?: string }): Promise<SearchResult>;
}

/**
 * eBay could not serve the request (429/5xx, network failure, timeout) or our
 * own guards refused it (cooldown, daily budget). Maps to HTTP 503 — distinct
 * from a legitimate no-market-data RIP verdict.
 *
 * `cooldown` defaults to true (a genuine outage signal — 429/5xx, unreachable
 * host — should trip the rate limiter's cooldown). A slow-but-alive
 * connection that merely tripped our own timeout guard is NOT an outage
 * signal (founder direction: speed is a goal, not a cutoff) and sets
 * `cooldown: false` so the caller skips `rateLimiter.startCooldown()`.
 */
export class EbayUnavailableError extends Error {
  readonly cooldown: boolean;

  constructor(message: string, options?: { cooldown?: boolean }) {
    super(message);
    this.name = 'EbayUnavailableError';
    this.cooldown = options?.cooldown ?? true;
  }
}

/**
 * True for the error `AbortSignal.timeout()` produces when it fires (a
 * DOMException named 'TimeoutError') and, defensively, for 'AbortError' —
 * some runtimes/polyfills surface an abort that way instead.
 */
export function isTimeoutError(err: unknown): boolean {
  return (
    err instanceof Error && (err.name === 'TimeoutError' || err.name === 'AbortError')
  );
}
