// OAuth2 client-credentials token manager. Tokens are cached in memory and
// refreshed proactively so user requests (almost) never pay mint latency.

import { EbayUnavailableError, type EbayEnv } from './types.js';

export const EBAY_API_BASE: Record<EbayEnv, string> = {
  sandbox: 'https://api.sandbox.ebay.com',
  production: 'https://api.ebay.com',
};

const OAUTH_SCOPE = 'https://api.ebay.com/oauth/api_scope';

export interface TokenManagerOptions {
  env: EbayEnv;
  clientId: string;
  clientSecret: string;
  fetchFn?: typeof fetch;
  /** Refresh when less than this much of the token's lifetime remains. */
  refreshMarginMs?: number;
}

const DEFAULT_REFRESH_MARGIN_MS = 5 * 60_000;

export class EbayTokenManager {
  private readonly tokenUrl: string;
  private readonly basicAuth: string;
  private readonly fetchFn: typeof fetch;
  private readonly refreshMarginMs: number;
  private token: { value: string; expiresAt: number } | null = null;
  private minting: Promise<string> | null = null;

  constructor(options: TokenManagerOptions) {
    this.tokenUrl = `${EBAY_API_BASE[options.env]}/identity/v1/oauth2/token`;
    this.basicAuth = Buffer.from(
      `${options.clientId}:${options.clientSecret}`,
    ).toString('base64');
    this.fetchFn = options.fetchFn ?? fetch;
    this.refreshMarginMs = options.refreshMarginMs ?? DEFAULT_REFRESH_MARGIN_MS;
  }

  async getToken(): Promise<string> {
    if (this.token && Date.now() < this.token.expiresAt - this.refreshMarginMs) {
      return this.token.value;
    }
    // Dedupe concurrent mints: everyone awaits the one in flight.
    this.minting ??= this.mint().finally(() => {
      this.minting = null;
    });
    return this.minting;
  }

  /** Drop the cached token (e.g. after an API 401) so the next getToken mints. */
  invalidate(): void {
    this.token = null;
  }

  private async mint(): Promise<string> {
    let response: Response;
    try {
      response = await this.fetchFn(this.tokenUrl, {
        method: 'POST',
        headers: {
          authorization: `Basic ${this.basicAuth}`,
          'content-type': 'application/x-www-form-urlencoded',
        },
        body: new URLSearchParams({
          grant_type: 'client_credentials',
          scope: OAUTH_SCOPE,
        }).toString(),
        signal: AbortSignal.timeout(2000),
      });
    } catch (err) {
      throw new EbayUnavailableError(
        `eBay token endpoint unreachable: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
    if (!response.ok) {
      throw new EbayUnavailableError(`eBay token mint failed with HTTP ${response.status}`);
    }
    const data = (await response.json()) as { access_token?: string; expires_in?: number };
    if (typeof data.access_token !== 'string' || typeof data.expires_in !== 'number') {
      throw new EbayUnavailableError('eBay token response malformed');
    }
    this.token = {
      value: data.access_token,
      expiresAt: Date.now() + data.expires_in * 1000,
    };
    return this.token.value;
  }
}
