// Shared e2e fixtures (T036): canned API responses, the /api/** mock, a guard that fails any
// test whose page tries to leave localhost, and the per-state accessibility checks from
// contracts/ui-states.md "Accessibility checks per state".
import AxeBuilder from '@axe-core/playwright';
import { test as base, expect, type BrowserContext, type Page } from '@playwright/test';
import { flip, noMarket, rip, risky, uncertain } from '../src/test/fixtures';
import type { Meta, VerdictResult } from '../src/lib/types';

export { expect };
export { flip, noMarket, rip, risky, uncertain };

/** A cap deliberately different from the client default (50), to prove S8 reads /api/meta. */
export const META: Meta = { defaultProfitThresholdCents: 1000, lookupDailyCap: 75, marketplaceId: 'EBAY_US' };

/** Query → canned verdict. Each fixture's own query is what the test types. */
export const QUERIES = {
  flip: { query: 'Chrono Trigger SNES', result: flip },
  risky: { query: '9780345391803', result: risky },
  rip: { query: 'Common Paperback', result: rip },
  uncertain: { query: 'Chrono Trigger', result: { ...uncertain, query: { identifier: null, title: 'Chrono Trigger' } } },
  noMarket: { query: '9780000000002', result: noMarket },
} as const satisfies Record<string, { query: string; result: VerdictResult }>;

export type FixtureName = keyof typeof QUERIES;

export const LABELS: Record<FixtureName, string> = {
  flip: 'Flip it',
  risky: 'Flip it — slow seller',
  rip: 'Rip it',
  uncertain: "Can't tell",
  noMarket: 'Rip it',
};

export const ERRORS = {
  validation: { status: 400, json: { error: 'VALIDATION', message: 'That barcode has the wrong number of digits.' } },
  limit: { status: 429, json: { error: 'RATE_LIMITED', message: 'Daily lookup limit reached.' } },
  unavailable: { status: 503, json: { error: 'UPSTREAM_UNAVAILABLE', message: 'eBay is not responding.' } },
  unexpected: { status: 500, json: { error: 'INTERNAL', message: 'boom' } },
} as const;

export type Reply = { status?: number; json?: unknown; delayMs?: number; hold?: Promise<unknown> };
export type LookupBody = { identifier?: string; title?: string; costBasisCents?: number; profitThresholdCents?: number };
export type Handler = (body: LookupBody, n: number) => Reply | Promise<Reply>;

/** Answers by query: whichever fixture's query was typed. Unknown queries get the FLIP fixture. */
export const byQuery: Handler = (body) => {
  const q = body.identifier ?? body.title ?? '';
  const hit = Object.values(QUERIES).find((f) => f.query === q);
  return { json: hit?.result ?? flip };
};

export type ApiMock = { lookups(): number; bodies: LookupBody[] };

/**
 * Intercepts every /api/** request. /api/meta returns META; /api/lookup goes to `handler`.
 * Works on a Page or a BrowserContext (the context level also sees service-worker fetches).
 */
export async function mockApi(target: Page | BrowserContext, handler: Handler = byQuery, meta: Meta = META): Promise<ApiMock> {
  const bodies: LookupBody[] = [];
  await target.route('**/api/**', async (route) => {
    const url = new URL(route.request().url());
    if (url.pathname === '/api/meta') return route.fulfill({ json: meta });
    if (url.pathname === '/api/lookup' && route.request().method() === 'POST') {
      const body = (route.request().postDataJSON() ?? {}) as LookupBody;
      bodies.push(body);
      const reply = await handler(body, bodies.length);
      if (reply.hold) await reply.hold;
      if (reply.delayMs) await new Promise((r) => setTimeout(r, reply.delayMs));
      try {
        await route.fulfill({ status: reply.status ?? 200, json: reply.json ?? {} });
      } catch {
        // The page aborted the request (a newer submit) or closed; nothing to answer.
      }
      return;
    }
    return route.fulfill({ status: 404, json: { error: 'NOT_FOUND' } });
  });
  return { lookups: () => bodies.length, bodies };
}

/**
 * Every test gets a guard: any request that isn't to our own preview server is aborted and
 * recorded, and the test fails if one happened. So a regression that called eBay (or a CDN)
 * directly can't pass silently.
 */
export const test = base.extend<{ offsite: string[] }>({
  offsite: [
    async ({ context }, use) => {
      const seen: string[] = [];
      await context.route(
        (url) => url.hostname !== 'localhost' && url.hostname !== '127.0.0.1' && url.protocol.startsWith('http'),
        (route) => {
          seen.push(route.request().url());
          return route.abort();
        },
      );
      await use(seen);
      expect(seen, 'requests left localhost').toEqual([]);
    },
    { auto: true },
  ],
});

export const THEMES = ['light', 'dark'] as const;

export function isDesktop(page: Page): boolean {
  return (page.viewportSize()?.width ?? 0) >= 1024;
}

export async function gotoApp(page: Page): Promise<void> {
  await page.goto('/');
  await expect(page.getByRole('heading', { level: 1, name: 'Flip it or Rip it' })).toBeVisible();
}

export const input = (page: Page) => page.locator('#lookup-input');
export const resultHeading = (page: Page) => page.locator('#result-heading');

/** Types a query and presses Enter (the keyboard path). */
export async function submitQuery(page: Page, query: string): Promise<void> {
  await input(page).fill(query);
  await input(page).press('Enter');
}

/** Submits a fixture's query and waits until its verdict heading has focus. */
export async function lookupFixture(page: Page, name: FixtureName): Promise<void> {
  await submitQuery(page, QUERIES[name].query);
  await expect(resultHeading(page)).toHaveText(LABELS[name]);
  await expect(resultHeading(page)).toBeFocused();
}

/**
 * Waits for every finite animation (the 150 ms result/dialog entrance) to finish, so axe
 * never measures contrast mid-fade. Infinite ones (spinner, skeleton pulse) are left running.
 */
export async function settle(page: Page): Promise<void> {
  await page.evaluate(async () => {
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
    const finite = document.getAnimations().filter((a) => a.effect?.getComputedTiming().iterations !== Infinity);
    await Promise.all(finite.map((a) => a.finished.catch(() => undefined)));
  });
}

export const AXE_TAGS = ['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa'];

export async function expectNoAxeViolations(page: Page, label = ''): Promise<void> {
  await settle(page);
  const { violations } = await new AxeBuilder({ page }).withTags(AXE_TAGS).analyze();
  const summary = violations.map((v) => ({
    id: v.id,
    impact: v.impact,
    help: v.help,
    nodes: v.nodes.map((n) => `${n.target.join(' ')} :: ${n.failureSummary?.split('\n').slice(0, 3).join(' ')}`),
  }));
  expect(summary, `axe violations ${label}`).toEqual([]);
}

export async function expectNoHorizontalScroll(page: Page): Promise<void> {
  const { scrollWidth, clientWidth } = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    clientWidth: document.documentElement.clientWidth,
  }));
  expect(scrollWidth, 'document scrollWidth <= clientWidth').toBeLessThanOrEqual(clientWidth);
}

/**
 * Every visible button, link, input, summary and select is at least 44×44 CSS px (the
 * project's bar; WCAG 2.5.8 AA itself is 24×24). Links inside a paragraph are inline text
 * links in prose and are exempt from 44 (the WCAG 2.5.8 inline exception); they must still
 * meet the 24 px AA minimum in height.
 */
export async function expectTargetSizes(page: Page): Promise<void> {
  const small = await page.evaluate(() => {
    const out: string[] = [];
    for (const el of document.querySelectorAll<HTMLElement>('button, a, input, summary, select')) {
      if (!el.checkVisibility({ opacityProperty: true, visibilityProperty: true })) continue;
      if (el.closest('.visually-hidden')) continue;
      if (el.matches('input[type="hidden"]')) continue;
      const r = el.getBoundingClientRect();
      if (r.width === 0 && r.height === 0) continue;
      const inline = el.tagName === 'A' && !!el.closest('p');
      const minW = inline ? 1 : 44;
      const minH = inline ? 24 : 44;
      // Sub-pixel layout can land at 43.99; round to the device pixel grid.
      const w = Math.round(r.width * 100) / 100;
      const h = Math.round(r.height * 100) / 100;
      if (w + 0.01 < minW || h + 0.01 < minH) {
        const name = (el.getAttribute('aria-label') ?? el.textContent ?? '').trim().slice(0, 40) || el.id;
        out.push(`${el.tagName.toLowerCase()} "${name}" ${w}×${h}`);
      }
    }
    return out;
  });
  expect(small, 'targets under the minimum size').toEqual([]);
}

/** The full per-state bar: axe, no horizontal scroll, target sizes. Focus is asserted per state. */
export async function expectStateAccessible(page: Page, label: string): Promise<void> {
  await expectNoAxeViolations(page, label);
  await expectNoHorizontalScroll(page);
  await expectTargetSizes(page);
}

export type AxInfo = {
  role: string | undefined;
  name: string | undefined;
  description: string | undefined;
  ignored: boolean;
  props: Record<string, unknown>;
};

/** Chromium's own accessibility-tree node for the first element matching `selector` (via CDP). */
export async function axNode(page: Page, selector: string): Promise<AxInfo> {
  const cdp = await page.context().newCDPSession(page);
  try {
    await cdp.send('DOM.enable');
    await cdp.send('Accessibility.enable');
    const { root } = await cdp.send('DOM.getDocument', { depth: 0 });
    const { nodeId } = await cdp.send('DOM.querySelector', { nodeId: root.nodeId, selector });
    if (!nodeId) throw new Error(`no element for ${selector}`);
    const { nodes } = await cdp.send('Accessibility.getPartialAXTree', { nodeId, fetchRelatives: false });
    const n = nodes[0]!;
    return {
      role: n.role?.value as string | undefined,
      name: n.name?.value as string | undefined,
      description: n.description?.value as string | undefined,
      ignored: n.ignored,
      props: Object.fromEntries((n.properties ?? []).map((p) => [p.name, p.value.value])),
    };
  } finally {
    await cdp.detach();
  }
}

/** Lower-case words only: punctuation and separators ("·", ":", ",") don't count for label-in-name. */
export function words(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();
}

// ---- Scanner (S15) without a camera ----

/** No `navigator.mediaDevices` at all: the Scan button must not render. */
export async function noMediaDevices(page: Page): Promise<void> {
  await page.addInitScript(() => {
    Object.defineProperty(Navigator.prototype, 'mediaDevices', { get: () => undefined, configurable: true });
  });
}

/** `getUserMedia` exists but rejects with the given DOMException name. */
export async function rejectCamera(page: Page, name: string): Promise<void> {
  await page.addInitScript((errName) => {
    const md = navigator.mediaDevices;
    Object.defineProperty(md, 'getUserMedia', {
      value: () => Promise.reject(new DOMException('mocked', errName)),
      configurable: true,
    });
  }, name);
}

/**
 * `getUserMedia` resolves with a blank canvas stream: a live viewfinder with no camera and no
 * barcode. The stream is kept on `window.__scanStream` so a test can check it gets stopped.
 */
export async function fakeCamera(page: Page): Promise<void> {
  await page.addInitScript(() => {
    Object.defineProperty(navigator.mediaDevices, 'getUserMedia', {
      value: async () => {
        const c = document.createElement('canvas');
        c.width = 320;
        c.height = 240;
        const ctx = c.getContext('2d')!;
        ctx.fillStyle = '#777';
        ctx.fillRect(0, 0, c.width, c.height);
        const stream = c.captureStream(10);
        (window as unknown as { __scanStream: MediaStream }).__scanStream = stream;
        return stream;
      },
      configurable: true,
    });
  });
}

export const scanButton = (page: Page) => page.getByRole('button', { name: 'Scan', exact: true });
