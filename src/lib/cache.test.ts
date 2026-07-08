import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TtlCache } from './cache.js';

describe('TtlCache', () => {
  let cache: TtlCache<string>;

  beforeEach(() => {
    vi.useFakeTimers();
    cache = new TtlCache<string>({ ttlMs: 1000, sweepIntervalMs: 10_000 });
  });

  afterEach(() => {
    cache.dispose();
    vi.useRealTimers();
  });

  it('returns a stored value before it expires', () => {
    cache.set('k', 'v');
    expect(cache.get('k')).toBe('v');
  });

  it('misses on a key that was never set', () => {
    expect(cache.get('nope')).toBeUndefined();
  });

  it('expires entries after the TTL (lazy eviction on read)', () => {
    cache.set('k', 'v');
    vi.advanceTimersByTime(999);
    expect(cache.get('k')).toBe('v');
    vi.advanceTimersByTime(1);
    expect(cache.get('k')).toBeUndefined();
    expect(cache.size).toBe(0);
  });

  it('refreshes the TTL when a key is set again', () => {
    cache.set('k', 'v1');
    vi.advanceTimersByTime(900);
    cache.set('k', 'v2');
    vi.advanceTimersByTime(900);
    expect(cache.get('k')).toBe('v2');
  });

  it('sweeps expired entries in the background without reads', () => {
    cache.set('a', '1');
    cache.set('b', '2');
    expect(cache.size).toBe(2);
    vi.advanceTimersByTime(10_000); // past TTL (1s) and onto the sweep tick
    expect(cache.size).toBe(0);
  });

  it('keeps live entries through a sweep', () => {
    cache = new TtlCache<string>({ ttlMs: 60_000, sweepIntervalMs: 10_000 });
    cache.set('a', '1');
    vi.advanceTimersByTime(10_000);
    expect(cache.size).toBe(1);
    expect(cache.get('a')).toBe('1');
  });

  it('deletes entries on demand', () => {
    cache.set('k', 'v');
    cache.delete('k');
    expect(cache.get('k')).toBeUndefined();
  });
});
