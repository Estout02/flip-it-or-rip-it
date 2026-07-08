import { pathToFileURL } from 'node:url';
import Fastify, { type FastifyError, type FastifyInstance } from 'fastify';
import { TtlCache } from './lib/cache.js';
import { RateLimiter } from './lib/rate-limit.js';
import { lookup, type LookupRequest } from './lib/pipeline.js';
import { ValidationError } from './lib/identify.js';
import type { Valuation } from './lib/valuation.js';
import { EbayTokenManager } from './lib/ebay/auth.js';
import { BrowseApiClient } from './lib/ebay/browse.js';
import { fetchBrowseQuota } from './lib/ebay/analytics.js';
import { EbayUnavailableError, type EbayBrowseClient, type EbayEnv } from './lib/ebay/types.js';

export interface AppConfig {
  ebayEnv: EbayEnv;
  ebayClientId: string;
  ebayClientSecret: string;
  marketplaceId: string;
  feeRate: number;
  shippingFlatCents: number;
  cacheTtlMs: number;
  lookupDailyCap: number;
  ebayDailyCallBudget: number;
  defaultProfitThresholdCents: number;
  port: number;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  return {
    ebayEnv: env.EBAY_ENV === 'production' ? 'production' : 'sandbox',
    ebayClientId: env.EBAY_CLIENT_ID ?? '',
    ebayClientSecret: env.EBAY_CLIENT_SECRET ?? '',
    marketplaceId: env.EBAY_MARKETPLACE_ID ?? 'EBAY_US',
    feeRate: Number(env.EBAY_FEE_RATE ?? 0.1325),
    shippingFlatCents: Number(env.SHIPPING_FLAT_CENTS ?? 500),
    cacheTtlMs: Number(env.VALUATION_CACHE_TTL_HOURS ?? 24) * 3_600_000,
    lookupDailyCap: Number(env.LOOKUP_DAILY_CAP ?? 50),
    ebayDailyCallBudget: Number(env.EBAY_DAILY_CALL_BUDGET ?? 2500),
    // Env keeps dollars for founder convenience; converted to cents exactly once here.
    defaultProfitThresholdCents: Math.round(Number(env.PROFIT_THRESHOLD_DEFAULT ?? 10) * 100),
    port: Number(env.PORT ?? 3000),
  };
}

export interface AppDeps {
  config: AppConfig;
  browseClient: EbayBrowseClient;
  cache: TtlCache<Valuation>;
  rateLimiter: RateLimiter;
}

const lookupBodySchema = {
  type: 'object',
  properties: {
    identifier: { type: 'string' },
    title: { type: 'string' },
    costBasisCents: { type: 'integer', minimum: 0 },
    profitThresholdCents: { type: 'integer', minimum: 0 },
  },
} as const;

export function buildApp(
  deps: AppDeps,
  options: { logger?: boolean } = {},
): FastifyInstance {
  const { config, rateLimiter } = deps;
  // trustProxy so request.ip is the real client behind compose/prod proxies.
  const app = Fastify({ logger: options.logger ?? true, trustProxy: true });

  app.setErrorHandler((err: FastifyError, request, reply) => {
    if (err.validation !== undefined || err instanceof ValidationError) {
      return reply.code(400).send({ error: 'validation', message: err.message });
    }
    if (err instanceof EbayUnavailableError) {
      return reply
        .code(503)
        .send({ error: 'temporarily-unavailable', message: 'Marketplace lookup unavailable, try again shortly.' });
    }
    request.log.error(err);
    return reply.code(500).send({ error: 'internal', message: 'Unexpected server error.' });
  });

  app.get('/health', async () => ({
    status: 'ok',
    ebayCallsToday: rateLimiter.ebayCallsToday(),
  }));

  app.post<{ Body: LookupRequest }>(
    '/api/lookup',
    {
      schema: { body: lookupBodySchema },
      // O(1) in-memory check — the only work added to the hot path (FR-012).
      onRequest: (request, reply, done) => {
        if (!rateLimiter.tryConsumeLookup(request.ip)) {
          reply
            .code(429)
            .send({ error: 'limit-reached', message: 'Daily lookup limit reached. Resets at 00:00 UTC.' });
        }
        done();
      },
    },
    async (request) => lookup(request.body ?? {}, deps),
  );

  return app;
}

export function buildProductionDeps(
  config: AppConfig,
): { deps: AppDeps; tokenManager: EbayTokenManager } {
  const tokenManager = new EbayTokenManager({
    env: config.ebayEnv,
    clientId: config.ebayClientId,
    clientSecret: config.ebayClientSecret,
  });
  return {
    tokenManager,
    deps: {
      config,
      browseClient: new BrowseApiClient({
        env: config.ebayEnv,
        marketplaceId: config.marketplaceId,
        tokenManager,
      }),
      cache: new TtlCache({ ttlMs: config.cacheTtlMs }),
      rateLimiter: new RateLimiter({
        lookupDailyCap: config.lookupDailyCap,
        ebayDailyCallBudget: config.ebayDailyCallBudget,
      }),
    },
  };
}

/**
 * Quota headroom observability (constitution I): fire-and-forget at startup,
 * never on the lookup hot path. Skips gracefully without credentials.
 */
function logQuotaHeadroom(
  app: FastifyInstance,
  config: AppConfig,
  tokenManager: EbayTokenManager,
): void {
  if (config.ebayClientId === '' || config.ebayClientSecret === '') {
    app.log.info('eBay credentials absent — skipping Browse quota headroom check');
    return;
  }
  void fetchBrowseQuota({ env: config.ebayEnv, tokenManager }).then((quota) => {
    if (quota.ok) {
      app.log.info(
        `Browse API quota headroom: ${quota.remaining}/${quota.limit} calls remaining today`,
      );
    } else {
      app.log.warn(`Browse quota check skipped — ${quota.reason}`);
    }
  });
}

const isMain =
  process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href;

if (isMain) {
  const config = loadConfig();
  const { deps, tokenManager } = buildProductionDeps(config);
  const app = buildApp(deps);
  logQuotaHeadroom(app, config, tokenManager);
  app.listen({ port: config.port, host: '0.0.0.0' }).catch((err) => {
    app.log.error(err);
    process.exit(1);
  });
}
