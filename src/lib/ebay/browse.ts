// Browse API client — the only module that talks to eBay for search.
// One item_summary/search call serves both lookup paths (gtin= or q=);
// sort=price ascending means the first usable items are the lowest-priced.

import { EBAY_API_BASE, type EbayTokenManager } from './auth.js';
import {
  EbayUnavailableError,
  type EbayBrowseClient,
  type EbayEnv,
  type ListingSummary,
  type SearchResult,
} from './types.js';

export interface BrowseClientOptions {
  env: EbayEnv;
  marketplaceId: string;
  tokenManager: EbayTokenManager;
  fetchFn?: typeof fetch;
  timeoutMs?: number;
}

const DEFAULT_TIMEOUT_MS = 2000;
const SEARCH_LIMIT = 50;

/** eBay prices arrive as USD decimal strings; convert to cents at the boundary. */
function toCents(value: unknown): number {
  const parsed = typeof value === 'string' || typeof value === 'number' ? Number(value) : NaN;
  if (!Number.isFinite(parsed) || parsed <= 0) return 0;
  return Math.round(parsed * 100);
}

interface WireItemSummary {
  title?: unknown;
  price?: { value?: unknown };
  epid?: unknown;
}

export class BrowseApiClient implements EbayBrowseClient {
  private readonly searchUrl: string;
  private readonly marketplaceId: string;
  private readonly tokenManager: EbayTokenManager;
  private readonly fetchFn: typeof fetch;
  private readonly timeoutMs: number;

  constructor(options: BrowseClientOptions) {
    this.searchUrl = `${EBAY_API_BASE[options.env]}/buy/browse/v1/item_summary/search`;
    this.marketplaceId = options.marketplaceId;
    this.tokenManager = options.tokenManager;
    this.fetchFn = options.fetchFn ?? fetch;
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  }

  async search(query: { gtin?: string; title?: string }): Promise<SearchResult> {
    const params = new URLSearchParams({
      filter: 'buyingOptions:{FIXED_PRICE}',
      sort: 'price',
      limit: String(SEARCH_LIMIT),
    });
    if (query.gtin) {
      params.set('gtin', query.gtin);
    } else if (query.title) {
      params.set('q', query.title);
    } else {
      throw new Error('search requires a gtin or a title');
    }
    const url = `${this.searchUrl}?${params.toString()}`;

    let response = await this.fetchWithNetworkRetry(url);
    if (response.status === 401) {
      // Stale app token: refresh once and retry once.
      this.tokenManager.invalidate();
      response = await this.fetchWithNetworkRetry(url);
    }

    if (response.status === 400) {
      // Malformed query per eBay — local validation should have caught it; a
      // definitive "no" from eBay reads as zero results, not an outage.
      return { listings: [], totalActive: 0 };
    }
    if (!response.ok) {
      // 429/5xx (and any other refusal): let the caller enter cooldown.
      throw new EbayUnavailableError(`eBay Browse search failed with HTTP ${response.status}`);
    }

    const data = (await response.json().catch(() => ({}))) as {
      itemSummaries?: unknown;
      total?: unknown;
    };
    const items: WireItemSummary[] = Array.isArray(data.itemSummaries)
      ? (data.itemSummaries as WireItemSummary[])
      : [];
    const listings: ListingSummary[] = items.map((item) => ({
      title: typeof item.title === 'string' ? item.title : '',
      priceCents: toCents(item.price?.value),
      ...(item.epid != null ? { epid: String(item.epid) } : {}),
    }));
    const totalActive =
      typeof data.total === 'number' && Number.isFinite(data.total)
        ? data.total
        : listings.length;

    return { listings, totalActive };
  }

  /** One retry for network-level failures only (never for HTTP error statuses). */
  private async fetchWithNetworkRetry(url: string): Promise<Response> {
    try {
      return await this.doFetch(url);
    } catch (err) {
      if (err instanceof EbayUnavailableError) throw err;
      try {
        return await this.doFetch(url);
      } catch (retryErr) {
        throw new EbayUnavailableError(
          `eBay unreachable: ${retryErr instanceof Error ? retryErr.message : String(retryErr)}`,
        );
      }
    }
  }

  private async doFetch(url: string): Promise<Response> {
    const token = await this.tokenManager.getToken();
    return this.fetchFn(url, {
      headers: {
        authorization: `Bearer ${token}`,
        'X-EBAY-C-MARKETPLACE-ID': this.marketplaceId,
      },
      signal: AbortSignal.timeout(this.timeoutMs),
    });
  }
}
