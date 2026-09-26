import { pathToFileURL } from 'node:url';
import { isIP } from 'node:net';
import { existsSync } from 'node:fs';
import path from 'node:path';
import Fastify, { type FastifyError, type FastifyInstance } from 'fastify';
import fastifyStatic from '@fastify/static';
import { TtlCache } from './lib/cache.js';
import { RateLimiter } from './lib/rate-limit.js';
import { lookup, type LookupRequest } from './lib/pipeline.js';
import { ValidationError } from './lib/identify.js';
import {
  LIQUIDITY_DEFAULTS,
  REALIZATION_RATE_DEFAULT,
  type LiquidityConfig,
} from './lib/verdict.js';
import { MATCH_DEFAULTS, type MatchConfig, type Valuation } from './lib/valuation.js';
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
  liquidity: LiquidityConfig;
  realizationRate: number;
  match: MatchConfig;
  port: number;
  /**
   * Fastify's `trustProxy` option, straight through. `false` (the default) means
   * request.ip is the connecting socket address; forwarding headers are ignored.
   * Parsed from TRUST_PROXY by parseTrustProxy in T010 — hard-coded false here
   * for now so the bypass is closed even before that parser lands (research R3).
   */
  trustProxy: false | number | string;
  /**
   * Absolute path to the built web client (research R4), resolved once here
   * against `process.cwd()` rather than left relative — a later `chdir` (or a
   * differing container `WORKDIR`) must not change which directory gets
   * served. Static serving is registered only when `<webDistDir>/index.html`
   * exists: absent in dev, where the `web` compose service's Vite dev server
   * serves the client on its own port instead.
   */
  webDistDir: string;
}

/**
 * Cross-field invariants matter here: a moderate cutoff below the strong cutoff
 * would make MODERATE unreachable, and a multiplier under 1 would put the
 * "comfortable margin" line below the threshold the gate already cleared. A
 * typo'd env var degrades to defaults rather than taking the API down.
 */
function loadLiquidityConfig(env: NodeJS.ProcessEnv): LiquidityConfig {
  const candidate: LiquidityConfig = {
    strongMaxListings: Number(
      env.LIQUIDITY_STRONG_MAX_LISTINGS ?? LIQUIDITY_DEFAULTS.strongMaxListings,
    ),
    moderateMaxListings: Number(
      env.LIQUIDITY_MODERATE_MAX_LISTINGS ?? LIQUIDITY_DEFAULTS.moderateMaxListings,
    ),
    riskyMarginMultiplier: Number(
      env.LIQUIDITY_RISKY_MARGIN_MULTIPLIER ?? LIQUIDITY_DEFAULTS.riskyMarginMultiplier,
    ),
  };
  const valid =
    Number.isFinite(candidate.strongMaxListings) &&
    candidate.strongMaxListings >= 1 &&
    Number.isFinite(candidate.moderateMaxListings) &&
    candidate.moderateMaxListings >= candidate.strongMaxListings &&
    Number.isFinite(candidate.riskyMarginMultiplier) &&
    candidate.riskyMarginMultiplier >= 1;
  if (!valid) {
    console.warn(
      `Invalid LIQUIDITY_* configuration ${JSON.stringify(candidate)} — falling back to defaults.`,
    );
    return { ...LIQUIDITY_DEFAULTS };
  }
  return candidate;
}

/**
 * Bounded at 1 because the asking price is the transaction ceiling for the
 * fixed-price listings we query — a rate above 1 would claim items sell for more
 * than they are listed at. A rate of 0 would RIP everything.
 */
function loadRealizationRate(env: NodeJS.ProcessEnv): number {
  const raw = env.VALUATION_REALIZATION_RATE;
  const rate = Number(raw ?? REALIZATION_RATE_DEFAULT);
  if (!Number.isFinite(rate) || rate <= 0 || rate > 1) {
    console.warn(
      `Invalid VALUATION_REALIZATION_RATE ${JSON.stringify(raw)} — falling back to ${REALIZATION_RATE_DEFAULT}.`,
    );
    return REALIZATION_RATE_DEFAULT;
  }
  return rate;
}

/**
 * Incoherent bands are the real risk here: a medium dominance floor above the
 * high one, or a high dispersion ceiling above the medium one, would make a tier
 * unreachable and silently mislabel every match. A typo degrades to defaults
 * rather than shipping nonsense confidence.
 */
function loadMatchConfig(env: NodeJS.ProcessEnv): MatchConfig {
  const candidate: MatchConfig = {
    minDominanceHigh: Number(env.MATCH_MIN_DOMINANCE_HIGH ?? MATCH_DEFAULTS.minDominanceHigh),
    minDominanceMedium: Number(env.MATCH_MIN_DOMINANCE_MEDIUM ?? MATCH_DEFAULTS.minDominanceMedium),
    maxDispersionHigh: Number(env.MATCH_MAX_DISPERSION_HIGH ?? MATCH_DEFAULTS.maxDispersionHigh),
    maxDispersionMedium: Number(env.MATCH_MAX_DISPERSION_MEDIUM ?? MATCH_DEFAULTS.maxDispersionMedium),
  };
  const finite = Object.values(candidate).every((v) => Number.isFinite(v));
  const valid =
    finite &&
    candidate.minDominanceHigh > 0 &&
    candidate.minDominanceHigh <= 1 &&
    candidate.minDominanceMedium > 0 &&
    candidate.minDominanceMedium <= candidate.minDominanceHigh &&
    candidate.maxDispersionHigh >= 1 &&
    candidate.maxDispersionHigh <= candidate.maxDispersionMedium;
  if (!valid) {
    console.warn(
      `Invalid MATCH_* configuration ${JSON.stringify(candidate)} — falling back to defaults.`,
    );
    return { ...MATCH_DEFAULTS };
  }
  return candidate;
}

/** IPv4 prefixes run 0–32; IPv6 prefixes run 0–128 (research R3). */
function isValidAddressOrCidr(entry: string): boolean {
  if (entry === '') return false;
  const slashIndex = entry.indexOf('/');
  const address = slashIndex === -1 ? entry : entry.slice(0, slashIndex);
  const version = isIP(address);
  if (version === 0) return false;
  if (slashIndex === -1) return true;
  const prefixRaw = entry.slice(slashIndex + 1);
  if (!/^\d+$/.test(prefixRaw)) return false;
  const prefix = Number(prefixRaw);
  const maxPrefix = version === 4 ? 32 : 128;
  return prefix >= 0 && prefix <= maxPrefix;
}

/**
 * Fastify's `trustProxy: true` trusts every hop, which turns request.ip into
 * the leftmost (client-controlled) X-Forwarded-For entry — the per-client cap
 * bypass this spec closes. So `true` is rejected here right alongside actual
 * garbage: the only way to trust a proxy is to name it, by hop count or by
 * address/CIDR (research R3).
 */
export function parseTrustProxy(raw: string | undefined): false | number | string {
  const trimmed = (raw ?? '').trim();
  if (trimmed === '' || trimmed === 'false') return false;

  if (/^\d+$/.test(trimmed) && Number(trimmed) >= 1) {
    return Number(trimmed);
  }

  const entries = trimmed.split(',').map((s) => s.trim());
  if (entries.every(isValidAddressOrCidr)) {
    return entries.join(',');
  }

  console.warn(
    `Invalid TRUST_PROXY ${JSON.stringify(raw)} — falling back to false (forwarding headers ignored).`,
  );
  return false;
}

/**
 * One validation path for every scalar env-driven setting (research R4): unset
 * keeps the default silently; present-but-invalid warns (naming the var and
 * the raw value, matching the existing liquidity/match/realization-rate
 * warnings) and still falls back to the default rather than shipping NaN or an
 * out-of-range number into the hot path.
 */
function numericSetting(
  env: NodeJS.ProcessEnv,
  name: string,
  fallback: number,
  isValid: (n: number) => boolean,
): number {
  const raw = env[name];
  if (raw === undefined) return fallback;
  const n = Number(raw);
  if (!Number.isFinite(n) || !isValid(n)) {
    console.warn(`Invalid ${name} ${JSON.stringify(raw)} — falling back to ${fallback}.`);
    return fallback;
  }
  return n;
}

const isPositiveInteger = (n: number): boolean => Number.isInteger(n) && n >= 1;

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  // Env keeps hours/dollars for founder convenience; converted to ms/cents
  // exactly once, after validation, below.
  const cacheTtlHours = numericSetting(env, 'VALUATION_CACHE_TTL_HOURS', 24, (n) => n > 0);
  const profitThresholdDollars = numericSetting(
    env,
    'PROFIT_THRESHOLD_DEFAULT',
    10,
    (n) => n >= 0,
  );

  return {
    ebayEnv: env.EBAY_ENV === 'production' ? 'production' : 'sandbox',
    ebayClientId: env.EBAY_CLIENT_ID ?? '',
    ebayClientSecret: env.EBAY_CLIENT_SECRET ?? '',
    marketplaceId: env.EBAY_MARKETPLACE_ID ?? 'EBAY_US',
    feeRate: numericSetting(env, 'EBAY_FEE_RATE', 0.1325, (n) => n >= 0 && n < 1),
    shippingFlatCents: numericSetting(
      env,
      'SHIPPING_FLAT_CENTS',
      500,
      (n) => Number.isInteger(n) && n >= 0,
    ),
    cacheTtlMs: cacheTtlHours * 3_600_000,
    lookupDailyCap: numericSetting(env, 'LOOKUP_DAILY_CAP', 50, isPositiveInteger),
    ebayDailyCallBudget: numericSetting(env, 'EBAY_DAILY_CALL_BUDGET', 2500, isPositiveInteger),
    defaultProfitThresholdCents: Math.round(profitThresholdDollars * 100),
    liquidity: loadLiquidityConfig(env),
    realizationRate: loadRealizationRate(env),
    match: loadMatchConfig(env),
    port: numericSetting(env, 'PORT', 3000, (n) => Number.isInteger(n) && n >= 1 && n <= 65535),
    trustProxy: parseTrustProxy(env.TRUST_PROXY),
    webDistDir: path.resolve(process.cwd(), env.WEB_DIST_DIR ?? 'web/dist'),
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
  // A misspelled field (e.g. costBasis instead of costBasisCents) must be
  // REJECTED, not silently ignored — silently ignoring it produced a wrong
  // answer with no signal to the caller (research R7).
  additionalProperties: false,
} as const;

/**
 * The exact CSP from research R8. `'wasm-unsafe-eval'` is the one narrow
 * allowance WebAssembly compilation needs (the barcode scanner's ZXing-WASM
 * decoder); same-origin serving (research R4) means nothing else ever needs
 * to point off `'self'`.
 */
const WEB_CLIENT_CSP =
  "default-src 'self'; script-src 'self' 'wasm-unsafe-eval'; style-src 'self'; img-src 'self' data: blob:; connect-src 'self'; worker-src 'self'; manifest-src 'self'; media-src 'self' blob:; object-src 'none'; base-uri 'none'; frame-ancestors 'none'";

/**
 * Files the PWA's `autoUpdate` flow depends on fetching fresh every time —
 * serving a stale `index.html` or `sw.js` from an intermediary cache would
 * pin a client to an old build indefinitely (research R4/R9).
 */
const WEB_CLIENT_NO_CACHE_BASENAMES = new Set([
  'index.html',
  'sw.js',
  'registerSW.js',
  'manifest.webmanifest',
]);

/**
 * Serves the built web client from `dir` at the API's own origin (research
 * R4), so the client's `/api` and `/health` calls need no CORS. This only
 * adds routes via `@fastify/static` — no hooks — so it cannot add overhead to
 * the `/api/lookup` hot path (constitution II). Fastify's router (find-my-way)
 * always prefers a literal route (`/api/lookup`, `/health`) over the static
 * plugin's wildcard fallback regardless of registration order, so it cannot
 * shadow either. Cache-Control is fully hand-rolled here (`cacheControl:
 * false`) because HTML, the service worker and hashed assets each need a
 * different policy, which no single `maxAge`/`immutable` pair can express.
 */
export function registerWebClient(app: FastifyInstance, dir: string): void {
  app.register(fastifyStatic, {
    root: dir,
    index: ['index.html'],
    cacheControl: false,
    // @fastify/static ≥ 10 hands setHeaders the FastifyReply, not the raw response.
    setHeaders(reply, filePath) {
      const base = path.basename(filePath);
      if (base.endsWith('.html')) {
        reply.header('Content-Security-Policy', WEB_CLIENT_CSP);
        reply.header('Referrer-Policy', 'no-referrer');
        reply.header('Permissions-Policy', 'camera=(self)');
      }
      if (WEB_CLIENT_NO_CACHE_BASENAMES.has(base)) {
        reply.header('Cache-Control', 'no-cache');
      } else if (filePath.split(path.sep).includes('assets')) {
        reply.header('Cache-Control', 'public, max-age=31536000, immutable');
      }
    },
  });
}

export function buildApp(
  deps: AppDeps,
  options: { logger?: boolean } = {},
): FastifyInstance {
  const { config, rateLimiter } = deps;
  // trustProxy comes straight from config: false unless the operator explicitly
  // configured TRUST_PROXY, so request.ip cannot be spoofed via X-Forwarded-For
  // by default (research R3 — closes the per-client cap bypass).
  const app = Fastify({
    logger: options.logger ?? true,
    // Fastify's own .d.ts omits `number` from trustProxy's type even though
    // it's accepted at runtime (proxy-addr's hop-count form) — a known gap in
    // Fastify's types, not a loosening of our own: AppConfig.trustProxy stays
    // `false | number | string`, matching data-model.md exactly.
    trustProxy: config.trustProxy as boolean | string | undefined,
    // Fastify's own default is removeAdditional: true, which would silently
    // STRIP unknown fields and still answer 200 — exactly the bug this schema
    // exists to close. Without this override, additionalProperties: false on
    // the schema above does nothing (research R7).
    ajv: { customOptions: { removeAdditional: false } },
  });

  app.setErrorHandler((err: FastifyError, request, reply) => {
    if (err.validation !== undefined) {
      const additionalPropertyError = err.validation.find(
        (entry) => entry.keyword === 'additionalProperties',
      );
      if (additionalPropertyError !== undefined) {
        const fieldName = (additionalPropertyError.params as { additionalProperty?: string })
          .additionalProperty;
        return reply.code(400).send({
          error: 'validation',
          message: `Unknown field "${fieldName}". Allowed: identifier, title, costBasisCents, profitThresholdCents.`,
        });
      }
      return reply.code(400).send({ error: 'validation', message: err.message });
    }
    if (err instanceof ValidationError) {
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

  // Local config only — zero eBay calls, so it carries no rate-limit hook and
  // never touches the per-client lookup cap (research R5). Short max-age (not
  // immutable) because these values come from server config, which an
  // operator can change between deploys.
  app.get('/api/meta', async (_request, reply) => {
    reply.header('Cache-Control', 'public, max-age=300');
    return {
      defaultProfitThresholdCents: config.defaultProfitThresholdCents,
      lookupDailyCap: config.lookupDailyCap,
      marketplaceId: config.marketplaceId,
    };
  });

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

  // Absent in dev (the `web` compose service's Vite dev server handles :5173
  // instead) and absent until a production build exists — checked once here
  // rather than inside registerWebClient so a missing dir is simply "don't
  // register the plugin," not a runtime 404-generating registration.
  if (existsSync(path.join(config.webDistDir, 'index.html'))) {
    registerWebClient(app, config.webDistDir);
  }

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
