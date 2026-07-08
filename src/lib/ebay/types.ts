// Wire types + injectable client interface for the eBay Browse integration.
// Tests fake EbayBrowseClient; only ebay/browse.ts talks to the real API.

export type EbayEnv = 'sandbox' | 'production';

export interface ListingSummary {
  title: string;
  /** Converted from eBay's price.value (USD string) at the client boundary. */
  priceCents: number;
  /** eBay product id when the listing is catalog-matched. */
  epid?: string;
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
 */
export class EbayUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'EbayUnavailableError';
  }
}
