import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { flip, jsonResponse } from '../test/fixtures';
import { DEFAULT_META, getMeta, lookup, LookupFailure, resetMetaForTests } from './api';

const fetchMock = vi.fn<typeof fetch>();

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal('fetch', fetchMock);
  resetMetaForTests();
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

async function failureOf(p: Promise<unknown>) {
  try {
    await p;
  } catch (e) {
    return e;
  }
  throw new Error('expected rejection');
}

describe('lookup', () => {
  it('POSTs the input as JSON and returns the verdict', async () => {
    fetchMock.mockResolvedValue(jsonResponse(flip));
    const result = await lookup({ title: 'Chrono Trigger SNES', profitThresholdCents: 2500 });
    expect(result).toEqual(flip);
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe('/api/lookup');
    expect(init?.method).toBe('POST');
    expect(JSON.parse(String(init?.body))).toEqual({ title: 'Chrono Trigger SNES', profitThresholdCents: 2500 });
  });

  it('400 → validation with the server message', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ error: 'validation', message: 'Identifier is not a valid UPC.' }, 400));
    const e = await failureOf(lookup({ identifier: '123' }));
    expect(e).toBeInstanceOf(LookupFailure);
    expect((e as LookupFailure).error).toEqual({ kind: 'validation', message: 'Identifier is not a valid UPC.' });
  });

  it.each([
    [429, 'limit'],
    [503, 'unavailable'],
    [500, 'unexpected'],
    [404, 'unexpected'],
  ])('%d → %s', async (status, kind) => {
    fetchMock.mockResolvedValue(jsonResponse({ error: 'x', message: 'y' }, status));
    const e = (await failureOf(lookup({ title: 'x' }))) as LookupFailure;
    expect(e.error.kind).toBe(kind);
  });

  it('a fetch TypeError → offline', async () => {
    fetchMock.mockRejectedValue(new TypeError('Failed to fetch'));
    const e = (await failureOf(lookup({ title: 'x' }))) as LookupFailure;
    expect(e.error.kind).toBe('offline');
  });

  it('navigator.onLine === false → offline without fetching', async () => {
    vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false);
    const e = (await failureOf(lookup({ title: 'x' }))) as LookupFailure;
    expect(e.error.kind).toBe('offline');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('an AbortError propagates as-is', async () => {
    const abort = new DOMException('aborted', 'AbortError');
    fetchMock.mockRejectedValue(abort);
    expect(await failureOf(lookup({ title: 'x' }))).toBe(abort);
  });
});

describe('getMeta', () => {
  it('fetches once and caches', async () => {
    const meta = { defaultProfitThresholdCents: 1500, lookupDailyCap: 40, marketplaceId: 'EBAY_US' };
    fetchMock.mockResolvedValue(jsonResponse(meta));
    expect(await getMeta()).toEqual(meta);
    expect(await getMeta()).toEqual(meta);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('falls back to defaults on failure', async () => {
    fetchMock.mockRejectedValue(new TypeError('offline'));
    expect(await getMeta()).toEqual(DEFAULT_META);
    fetchMock.mockResolvedValue(jsonResponse({ nope: true }));
    expect(await getMeta()).toEqual(DEFAULT_META);
  });
});
