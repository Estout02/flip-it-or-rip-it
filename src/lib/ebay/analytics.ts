// Developer Analytics getRateLimits — quota headroom checked proactively
// (constitution I) rather than discovered by exhaustion. Called off the lookup
// hot path only: at server startup and from the sandbox smoke script.

import { EBAY_API_BASE, type EbayTokenManager } from './auth.js';
import type { EbayEnv } from './types.js';

export interface QuotaCheck {
  ok: boolean;
  /** Daily call limit for the Browse API (when ok). */
  limit?: number;
  /** Remaining calls in the current window (when ok). */
  remaining?: number;
  /** Why the check produced no numbers (when not ok). */
  reason?: string;
}

interface WireRate {
  limit?: number;
  remaining?: number;
}

export async function fetchBrowseQuota(options: {
  env: EbayEnv;
  tokenManager: EbayTokenManager;
  fetchFn?: typeof fetch;
}): Promise<QuotaCheck> {
  const fetchFn = options.fetchFn ?? fetch;
  const url = `${EBAY_API_BASE[options.env]}/developer/analytics/v1_beta/rate_limit/?api_name=browse&api_context=buy`;
  try {
    const token = await options.tokenManager.getToken();
    const response = await fetchFn(url, {
      headers: { authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(5000),
    });
    if (!response.ok) {
      return { ok: false, reason: `getRateLimits returned HTTP ${response.status}` };
    }
    const data = (await response.json().catch(() => ({}))) as {
      rateLimits?: Array<{ resources?: Array<{ rates?: WireRate[] }> }>;
    };
    const rate = data.rateLimits?.[0]?.resources?.[0]?.rates?.[0];
    if (rate === undefined || typeof rate.limit !== 'number') {
      return { ok: false, reason: 'getRateLimits response held no Browse rate data' };
    }
    return { ok: true, limit: rate.limit, remaining: rate.remaining ?? rate.limit };
  } catch (err) {
    return {
      ok: false,
      reason: `getRateLimits unreachable: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
}
