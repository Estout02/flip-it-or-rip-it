// In-memory rate limiting: per-client daily lookup cap, global daily eBay-call
// budget (both reset at UTC midnight, matching eBay's quota window), and a
// short cooldown after eBay 429/5xx responses. All checks are O(1) — they sit
// on the lookup hot path.

export interface RateLimiterOptions {
  /** Per-client lookups per UTC day (LOOKUP_DAILY_CAP). */
  lookupDailyCap: number;
  /** Hard stop for outbound eBay calls per UTC day (EBAY_DAILY_CALL_BUDGET). */
  ebayDailyCallBudget: number;
  /** How long to refuse eBay calls after a 429/5xx. */
  cooldownMs?: number;
}

interface DailyCounter {
  count: number;
  windowStart: number;
}

const DAY_MS = 86_400_000;
const DEFAULT_COOLDOWN_MS = 30_000;

/** Epoch ms of the current UTC day's midnight. */
function utcDayStart(now: number): number {
  return now - (now % DAY_MS);
}

export class RateLimiter {
  private readonly perClient = new Map<string, DailyCounter>();
  private ebayCalls: DailyCounter = { count: 0, windowStart: 0 };
  private cooldownUntil: number | null = null;
  private readonly lookupDailyCap: number;
  private readonly ebayDailyCallBudget: number;
  private readonly cooldownMs: number;

  constructor(options: RateLimiterOptions) {
    this.lookupDailyCap = options.lookupDailyCap;
    this.ebayDailyCallBudget = options.ebayDailyCallBudget;
    this.cooldownMs = options.cooldownMs ?? DEFAULT_COOLDOWN_MS;
  }

  /**
   * Count one lookup for this client. Returns false when the daily cap is
   * already spent (the lookup must be refused with 429). Cache hits count too:
   * lookups are the product's unit of value, and exempting hits would invite
   * scripted scraping of our cached data.
   */
  tryConsumeLookup(clientId: string): boolean {
    const now = Date.now();
    const windowStart = utcDayStart(now);
    let counter = this.perClient.get(clientId);
    if (!counter || counter.windowStart !== windowStart) {
      counter = { count: 0, windowStart };
      this.perClient.set(clientId, counter);
    }
    if (counter.count >= this.lookupDailyCap) return false;
    counter.count += 1;
    return true;
  }

  hasEbayBudget(): boolean {
    return this.ebayCallsToday() < this.ebayDailyCallBudget;
  }

  countEbayCall(): void {
    const windowStart = utcDayStart(Date.now());
    if (this.ebayCalls.windowStart !== windowStart) {
      this.ebayCalls = { count: 0, windowStart };
    }
    this.ebayCalls.count += 1;
  }

  ebayCallsToday(): number {
    const windowStart = utcDayStart(Date.now());
    return this.ebayCalls.windowStart === windowStart ? this.ebayCalls.count : 0;
  }

  startCooldown(): void {
    this.cooldownUntil = Date.now() + this.cooldownMs;
  }

  inCooldown(): boolean {
    if (this.cooldownUntil === null) return false;
    if (Date.now() >= this.cooldownUntil) {
      this.cooldownUntil = null;
      return false;
    }
    return true;
  }
}
