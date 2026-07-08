// Opt-in live sandbox smoke test — the ONLY code path that touches the real
// eBay sandbox. Validates auth + wiring, not price accuracy (sandbox data is
// fake). Never imported by tests; automated tests use the fake client.
//
//   docker compose run --rm api npx tsx scripts/sandbox-smoke.ts [identifier-or-title]

import { loadConfig } from '../src/server.js';
import { EbayTokenManager } from '../src/lib/ebay/auth.js';
import { BrowseApiClient } from '../src/lib/ebay/browse.js';
import { fetchBrowseQuota } from '../src/lib/ebay/analytics.js';
import { TtlCache } from '../src/lib/cache.js';
import { RateLimiter } from '../src/lib/rate-limit.js';
import { lookup, type LookupRequest } from '../src/lib/pipeline.js';
import type { Valuation } from '../src/lib/valuation.js';

const config = loadConfig();

if (config.ebayClientId === '' || config.ebayClientSecret === '') {
  console.error(
    'Missing eBay credentials. Copy .env.example to .env and set EBAY_CLIENT_ID and',
    'EBAY_CLIENT_SECRET from the founder\'s eBay developer account (sandbox keyset).',
  );
  process.exit(1);
}

const dollars = (cents: number) => `$${(cents / 100).toFixed(2)}`;

const tokenManager = new EbayTokenManager({
  env: config.ebayEnv,
  clientId: config.ebayClientId,
  clientSecret: config.ebayClientSecret,
});

console.log(`eBay environment: ${config.ebayEnv}`);

// 1. Auth: mint a real app token.
await tokenManager.getToken();
console.log('✔ OAuth app token minted');

// 2. Quota headroom via Developer Analytics getRateLimits (constitution I).
const quota = await fetchBrowseQuota({ env: config.ebayEnv, tokenManager });
if (quota.ok) {
  console.log(`✔ Browse API quota: ${quota.remaining}/${quota.limit} calls remaining today`);
} else {
  console.log(`⚠ Quota check skipped — ${quota.reason}`);
}

// 3. Full pipeline against the real sandbox Browse API.
const input = process.argv[2] ?? 'Chrono Trigger SNES';
const request: LookupRequest = /^[\d\s-]+X?$/i.test(input.trim())
  ? { identifier: input }
  : { title: input };

const result = await lookup(request, {
  browseClient: new BrowseApiClient({
    env: config.ebayEnv,
    marketplaceId: config.marketplaceId,
    tokenManager,
  }),
  cache: new TtlCache<Valuation>({ ttlMs: config.cacheTtlMs }),
  rateLimiter: new RateLimiter({
    lookupDailyCap: config.lookupDailyCap,
    ebayDailyCallBudget: config.ebayDailyCallBudget,
  }),
  config,
});

console.log('✔ Browse search executed — VerdictResult:');
console.log(`
  query          ${JSON.stringify(request)}
  verdict        ${result.verdict}
  matched title  ${result.matchedTitle ?? '(no market data)'}
  est. value     ${dollars(result.estimatedValueCents)} (${result.pricingBasis}, sample ${result.sampleSize})
  fees           ${dollars(result.feesCents)}
  shipping       ${dollars(result.shippingEstimateCents)}
  profit         ${dollars(result.profitCents)}
  liquidity      ${result.liquidityScore.toFixed(2)} (${result.liquidityBasis})
  no market data ${result.noMarketData}
`);

process.exit(0);
