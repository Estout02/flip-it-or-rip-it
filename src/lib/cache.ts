// Generic in-memory TTL cache: lazy eviction on read + periodic sweep.
// Process restart clears it — acceptable for the stateless MVP.

export interface TtlCacheOptions {
  ttlMs: number;
  /** How often the background sweep evicts expired entries. */
  sweepIntervalMs?: number;
}

interface Entry<V> {
  value: V;
  expiresAt: number;
}

const DEFAULT_SWEEP_INTERVAL_MS = 60_000;

export class TtlCache<V> {
  private readonly entries = new Map<string, Entry<V>>();
  private readonly ttlMs: number;
  private readonly sweepTimer: ReturnType<typeof setInterval>;

  constructor(options: TtlCacheOptions) {
    this.ttlMs = options.ttlMs;
    this.sweepTimer = setInterval(
      () => this.sweep(),
      options.sweepIntervalMs ?? DEFAULT_SWEEP_INTERVAL_MS,
    );
    // Never keep the process alive just to sweep a cache.
    this.sweepTimer.unref?.();
  }

  get(key: string): V | undefined {
    const entry = this.entries.get(key);
    if (!entry) return undefined;
    if (Date.now() >= entry.expiresAt) {
      this.entries.delete(key);
      return undefined;
    }
    return entry.value;
  }

  set(key: string, value: V): void {
    this.entries.set(key, { value, expiresAt: Date.now() + this.ttlMs });
  }

  delete(key: string): void {
    this.entries.delete(key);
  }

  /** Entry count including not-yet-swept expired entries (sweep observability). */
  get size(): number {
    return this.entries.size;
  }

  sweep(): void {
    const now = Date.now();
    for (const [key, entry] of this.entries) {
      if (now >= entry.expiresAt) this.entries.delete(key);
    }
  }

  dispose(): void {
    clearInterval(this.sweepTimer);
    this.entries.clear();
  }
}
