import { describe, expect, it, vi } from 'vitest';
import { BrowseApiClient } from './browse.js';
import { EbayTokenManager } from './auth.js';
import { EbayUnavailableError } from './types.js';

function searchResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

function tokenResponse(token: string) {
  return new Response(JSON.stringify({ access_token: token, expires_in: 7200 }), {
    status: 200,
  });
}

const isTokenCall = (url: unknown) => String(url).includes('/identity/v1/oauth2/token');

/** fetch stub routing token mints and search calls to separate handlers. */
function makeFetch(searchHandler: (url: string, init: RequestInit) => Promise<Response>) {
  const tokens: string[] = [];
  let mintCount = 0;
  const fetchFn = vi.fn(async (url: unknown, init: unknown) => {
    if (isTokenCall(url)) {
      mintCount += 1;
      const token = `tok-${mintCount}`;
      tokens.push(token);
      return tokenResponse(token);
    }
    return searchHandler(String(url), init as RequestInit);
  }) as unknown as typeof fetch;
  return { fetchFn, tokens, searchCalls: () => (fetchFn as ReturnType<typeof vi.fn>).mock.calls.filter(([u]) => !isTokenCall(u)) };
}

function makeClient(fetchFn: typeof fetch) {
  const tokenManager = new EbayTokenManager({
    env: 'sandbox',
    clientId: 'id',
    clientSecret: 'secret',
    fetchFn,
  });
  return new BrowseApiClient({
    env: 'sandbox',
    marketplaceId: 'EBAY_US',
    tokenManager,
    fetchFn,
  });
}

describe('BrowseApiClient', () => {
  it('searches by gtin with the required params/headers and converts prices to cents', async () => {
    const { fetchFn, searchCalls } = makeFetch(async () =>
      searchResponse({
        itemSummaries: [
          { title: 'Hitchhiker paperback', price: { value: '7.99' }, epid: 12345 },
          { title: 'No price listing' },
        ],
        total: 42,
      }),
    );
    const client = makeClient(fetchFn);

    const result = await client.search({ gtin: '9780345391803' });

    expect(result.totalActive).toBe(42);
    expect(result.listings).toEqual([
      { title: 'Hitchhiker paperback', priceCents: 799, epid: '12345' },
      { title: 'No price listing', priceCents: 0 },
    ]);

    const [url, init] = searchCalls()[0]!;
    const parsed = new URL(String(url));
    expect(parsed.pathname).toBe('/buy/browse/v1/item_summary/search');
    expect(parsed.hostname).toBe('api.sandbox.ebay.com');
    expect(parsed.searchParams.get('gtin')).toBe('9780345391803');
    expect(parsed.searchParams.get('filter')).toBe('buyingOptions:{FIXED_PRICE}');
    expect(parsed.searchParams.get('sort')).toBe('price');
    expect(parsed.searchParams.get('limit')).toBe('50');
    const headers = (init as RequestInit).headers as Record<string, string>;
    expect(headers.authorization).toBe('Bearer tok-1');
    expect(headers['X-EBAY-C-MARKETPLACE-ID']).toBe('EBAY_US');
  });

  it('searches by title via q=', async () => {
    const { fetchFn, searchCalls } = makeFetch(async () =>
      searchResponse({ itemSummaries: [], total: 0 }),
    );
    const client = makeClient(fetchFn);

    await client.search({ title: 'Chrono Trigger SNES' });

    const [url] = searchCalls()[0]!;
    expect(new URL(String(url)).searchParams.get('q')).toBe('Chrono Trigger SNES');
  });

  it('treats HTTP 400 as zero results, not an outage', async () => {
    const { fetchFn } = makeFetch(async () => searchResponse({ errors: [] }, 400));
    const client = makeClient(fetchFn);

    await expect(client.search({ gtin: '9780345391803' })).resolves.toEqual({
      listings: [],
      totalActive: 0,
    });
  });

  it.each([429, 500, 503])('throws EbayUnavailableError on HTTP %i', async (status) => {
    const { fetchFn } = makeFetch(async () => searchResponse({}, status));
    const client = makeClient(fetchFn);

    await expect(client.search({ gtin: '9780345391803' })).rejects.toBeInstanceOf(
      EbayUnavailableError,
    );
  });

  it('retries exactly once on a network error, then succeeds', async () => {
    let attempt = 0;
    const { fetchFn, searchCalls } = makeFetch(async () => {
      attempt += 1;
      if (attempt === 1) throw new TypeError('fetch failed');
      return searchResponse({ itemSummaries: [], total: 0 });
    });
    const client = makeClient(fetchFn);

    await expect(client.search({ gtin: '9780345391803' })).resolves.toEqual({
      listings: [],
      totalActive: 0,
    });
    expect(searchCalls()).toHaveLength(2);
  });

  it('gives up after the single network retry', async () => {
    const { fetchFn, searchCalls } = makeFetch(async () => {
      throw new TypeError('fetch failed');
    });
    const client = makeClient(fetchFn);

    await expect(client.search({ gtin: '9780345391803' })).rejects.toBeInstanceOf(
      EbayUnavailableError,
    );
    expect(searchCalls()).toHaveLength(2);
  });

  it('refreshes the token and retries once on HTTP 401', async () => {
    let call = 0;
    const { fetchFn, searchCalls } = makeFetch(async () => {
      call += 1;
      if (call === 1) return searchResponse({}, 401);
      return searchResponse({ itemSummaries: [], total: 3 });
    });
    const client = makeClient(fetchFn);

    await expect(client.search({ gtin: '9780345391803' })).resolves.toEqual({
      listings: [],
      totalActive: 3,
    });
    const calls = searchCalls();
    expect(calls).toHaveLength(2);
    const firstAuth = (calls[0]![1] as RequestInit).headers as Record<string, string>;
    const secondAuth = (calls[1]![1] as RequestInit).headers as Record<string, string>;
    expect(firstAuth.authorization).toBe('Bearer tok-1');
    expect(secondAuth.authorization).toBe('Bearer tok-2');
  });

  it('survives a malformed JSON body', async () => {
    const { fetchFn } = makeFetch(async () => new Response('not json', { status: 200 }));
    const client = makeClient(fetchFn);

    await expect(client.search({ gtin: '9780345391803' })).resolves.toEqual({
      listings: [],
      totalActive: 0,
    });
  });
});
