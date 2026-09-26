// Same-origin API client (research R6). Only our own API is ever called — never eBay (I).
import type { LookupError, LookupInput, Meta, VerdictResult } from './types';

export const DEFAULT_META: Meta = { defaultProfitThresholdCents: 1000, lookupDailyCap: 50, marketplaceId: 'EBAY_US' };

export class LookupFailure extends Error {
  constructor(readonly error: LookupError) {
    super(error.kind);
    this.name = 'LookupFailure';
  }
}

function isOffline(): boolean {
  return typeof navigator !== 'undefined' && navigator.onLine === false;
}

/** Resolves to the verdict, or throws `LookupFailure`. An `AbortError` propagates unchanged. */
export async function lookup(input: LookupInput, signal?: AbortSignal): Promise<VerdictResult> {
  if (isOffline()) throw new LookupFailure({ kind: 'offline' });
  let res: Response;
  try {
    res = await fetch('/api/lookup', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(input),
      signal,
    });
  } catch (err) {
    if (err instanceof DOMException && err.name === 'AbortError') throw err;
    if ((err as { name?: string })?.name === 'AbortError') throw err;
    if (err instanceof TypeError || isOffline()) throw new LookupFailure({ kind: 'offline' });
    throw new LookupFailure({ kind: 'unexpected' });
  }

  if (res.ok) {
    try {
      return (await res.json()) as VerdictResult;
    } catch (err) {
      if ((err as { name?: string })?.name === 'AbortError') throw err;
      throw new LookupFailure({ kind: 'unexpected' });
    }
  }
  if (res.status === 400) {
    let message = 'Check what you entered and try again.';
    try {
      const body = (await res.json()) as { message?: unknown };
      if (typeof body.message === 'string' && body.message) message = body.message;
    } catch {
      // keep the generic message
    }
    throw new LookupFailure({ kind: 'validation', message });
  }
  if (res.status === 429) throw new LookupFailure({ kind: 'limit' });
  if (res.status === 503) throw new LookupFailure({ kind: 'unavailable' });
  throw new LookupFailure({ kind: 'unexpected' });
}

let metaPromise: Promise<Meta> | null = null;

function isMeta(v: unknown): v is Meta {
  const m = v as Partial<Meta> | null;
  return (
    !!m &&
    Number.isInteger(m.defaultProfitThresholdCents) &&
    Number.isInteger(m.lookupDailyCap) &&
    typeof m.marketplaceId === 'string'
  );
}

/** Cached in memory; never rejects — falls back to the documented defaults. */
export function getMeta(): Promise<Meta> {
  metaPromise ??= fetch('/api/meta')
    .then(async (res) => {
      if (!res.ok) throw new Error(String(res.status));
      const body: unknown = await res.json();
      if (!isMeta(body)) throw new Error('bad meta');
      return body;
    })
    .catch(() => {
      metaPromise = null; // allow a later retry
      return DEFAULT_META;
    });
  return metaPromise;
}

export function resetMetaForTests(): void {
  metaPromise = null;
}
