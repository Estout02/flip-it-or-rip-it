import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { RateLimiter } from './rate-limit.js';

const DAY_MS = 86_400_000;

describe('RateLimiter', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    // Mid-day UTC so window math is exercised away from boundaries.
    vi.setSystemTime(new Date('2026-07-07T12:00:00Z'));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  const make = (overrides = {}) =>
    new RateLimiter({ lookupDailyCap: 50, ebayDailyCallBudget: 2500, ...overrides });

  describe('per-client daily cap', () => {
    it('allows exactly the cap and refuses the next lookup (50 vs 51)', () => {
      const limiter = make();
      for (let i = 0; i < 50; i++) {
        expect(limiter.tryConsumeLookup('1.2.3.4')).toBe(true);
      }
      expect(limiter.tryConsumeLookup('1.2.3.4')).toBe(false);
    });

    it('tracks clients independently', () => {
      const limiter = make({ lookupDailyCap: 1 });
      expect(limiter.tryConsumeLookup('a')).toBe(true);
      expect(limiter.tryConsumeLookup('a')).toBe(false);
      expect(limiter.tryConsumeLookup('b')).toBe(true);
    });

    it('resets at UTC midnight', () => {
      const limiter = make({ lookupDailyCap: 1 });
      expect(limiter.tryConsumeLookup('a')).toBe(true);
      expect(limiter.tryConsumeLookup('a')).toBe(false);
      vi.setSystemTime(new Date('2026-07-08T00:00:01Z'));
      expect(limiter.tryConsumeLookup('a')).toBe(true);
    });
  });

  describe('global eBay-call budget', () => {
    it('reports budget until the hard stop', () => {
      const limiter = make({ ebayDailyCallBudget: 2 });
      expect(limiter.hasEbayBudget()).toBe(true);
      limiter.countEbayCall();
      limiter.countEbayCall();
      expect(limiter.hasEbayBudget()).toBe(false);
      expect(limiter.ebayCallsToday()).toBe(2);
    });

    it('resets the budget window at UTC midnight', () => {
      const limiter = make({ ebayDailyCallBudget: 1 });
      limiter.countEbayCall();
      expect(limiter.hasEbayBudget()).toBe(false);
      vi.advanceTimersByTime(DAY_MS);
      expect(limiter.hasEbayBudget()).toBe(true);
      expect(limiter.ebayCallsToday()).toBe(0);
    });
  });

  describe('cooldown', () => {
    it('is off by default', () => {
      expect(make().inCooldown()).toBe(false);
    });

    it('holds for the configured window then expires', () => {
      const limiter = make({ cooldownMs: 30_000 });
      limiter.startCooldown();
      expect(limiter.inCooldown()).toBe(true);
      vi.advanceTimersByTime(29_999);
      expect(limiter.inCooldown()).toBe(true);
      vi.advanceTimersByTime(1);
      expect(limiter.inCooldown()).toBe(false);
    });
  });
});
