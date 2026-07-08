import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { EbayTokenManager } from './auth.js';
import { EbayUnavailableError } from './types.js';

function tokenResponse(token: string, expiresInSec = 7200) {
  return new Response(
    JSON.stringify({ access_token: token, expires_in: expiresInSec, token_type: 'Bearer' }),
    { status: 200, headers: { 'content-type': 'application/json' } },
  );
}

describe('EbayTokenManager', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  const make = (fetchFn: typeof fetch) =>
    new EbayTokenManager({
      env: 'sandbox',
      clientId: 'test-id',
      clientSecret: 'test-secret',
      fetchFn,
    });

  it('mints a token via client-credentials against the sandbox URL', async () => {
    const fetchFn = vi.fn().mockResolvedValue(tokenResponse('tok-1'));
    const manager = make(fetchFn);

    await expect(manager.getToken()).resolves.toBe('tok-1');

    expect(fetchFn).toHaveBeenCalledTimes(1);
    const [url, init] = fetchFn.mock.calls[0]!;
    expect(url).toBe('https://api.sandbox.ebay.com/identity/v1/oauth2/token');
    expect(init.method).toBe('POST');
    expect(init.headers.authorization).toBe(
      `Basic ${Buffer.from('test-id:test-secret').toString('base64')}`,
    );
    expect(init.body).toContain('grant_type=client_credentials');
  });

  it('reuses the cached token while it is fresh', async () => {
    const fetchFn = vi.fn().mockResolvedValue(tokenResponse('tok-1'));
    const manager = make(fetchFn);

    await manager.getToken();
    vi.advanceTimersByTime(60_000);
    await expect(manager.getToken()).resolves.toBe('tok-1');
    expect(fetchFn).toHaveBeenCalledTimes(1);
  });

  it('proactively refreshes when under 5 minutes of lifetime remain', async () => {
    const fetchFn = vi
      .fn()
      .mockResolvedValueOnce(tokenResponse('tok-1', 7200))
      .mockResolvedValueOnce(tokenResponse('tok-2', 7200));
    const manager = make(fetchFn);

    await manager.getToken();
    // 7200s lifetime − 4 minutes left → inside the 5-minute refresh margin.
    vi.advanceTimersByTime((7200 - 240) * 1000);
    await expect(manager.getToken()).resolves.toBe('tok-2');
    expect(fetchFn).toHaveBeenCalledTimes(2);
  });

  it('mints a fresh token after invalidate (API-401 recovery path)', async () => {
    const fetchFn = vi
      .fn()
      .mockResolvedValueOnce(tokenResponse('tok-1'))
      .mockResolvedValueOnce(tokenResponse('tok-2'));
    const manager = make(fetchFn);

    await expect(manager.getToken()).resolves.toBe('tok-1');
    manager.invalidate();
    await expect(manager.getToken()).resolves.toBe('tok-2');
    expect(fetchFn).toHaveBeenCalledTimes(2);
  });

  it('dedupes concurrent mints into one request', async () => {
    const fetchFn = vi.fn().mockResolvedValue(tokenResponse('tok-1'));
    const manager = make(fetchFn);

    const [a, b] = await Promise.all([manager.getToken(), manager.getToken()]);
    expect(a).toBe('tok-1');
    expect(b).toBe('tok-1');
    expect(fetchFn).toHaveBeenCalledTimes(1);
  });

  it('maps mint failures to EbayUnavailableError', async () => {
    const fetchFn = vi.fn().mockResolvedValue(new Response('nope', { status: 401 }));
    const manager = make(fetchFn);

    await expect(manager.getToken()).rejects.toBeInstanceOf(EbayUnavailableError);
  });
});
