// Shared e2e fixtures (T036, extended by T049 for spec 008): canned API responses, the /api/**
// mock, a guard that fails any test whose page tries to leave localhost, and the per-state
// accessibility checks from contracts/ui-states.md "Accessibility checks per state".
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import AxeBuilder from '@axe-core/playwright';
import { test as base, expect, type BrowserContext, type Page } from '@playwright/test';
import { flip, noMarket, rip, risky, uncertain } from '../src/test/fixtures';
import type { Meta, VerdictResult } from '../src/lib/types';

// Read as plain JSON text rather than `import … with { type: 'json' }`: the e2e service's Node
// ESM loader (invoked via tsx/esbuild-register under Playwright) rejects a bare JSON import
// without an import attribute, and pinning that attribute would couple this file to a Node
// version. A file read has no such constraint.
const baselineJson: unknown = JSON.parse(
  readFileSync(fileURLToPath(new URL('./baseline.json', import.meta.url)), 'utf-8'),
);

export { expect };
export { flip, noMarket, rip, risky, uncertain };

/** A cap deliberately different from the client default (50), to prove S8 reads /api/meta. */
export const META: Meta = { defaultProfitThresholdCents: 1000, lookupDailyCap: 75, marketplaceId: 'EBAY_US' };

/** Spec 007: environment badge. META has no ebayEnv, so existing specs keep running with an unknown environment. */
export const SANDBOX_META: Meta = { ...META, ebayEnv: 'sandbox' };
export const PRODUCTION_META: Meta = { ...META, defaultProfitThresholdCents: 1500, ebayEnv: 'production' };
export const BADGE_TEXT = "Test data — eBay sandbox. Results come from eBay's test environment, not real listings.";

/**
 * T069's regression gate is read mechanically from `web/e2e/baseline.json` (written once by T001,
 * WP1) rather than hand-copied, so a stale or blank baseline can't pass unnoticed. Throws at
 * module load — before any test runs — if the file is missing or the figure isn't a real number.
 */
export const BASELINE_MS: number = (() => {
  const v = (baselineJson as { submitToVerdictMedianMs?: unknown }).submitToVerdictMedianMs;
  if (typeof v !== 'number' || !Number.isFinite(v) || v <= 0) {
    throw new Error(
      'web/e2e/baseline.json is missing or invalid: submitToVerdictMedianMs must be a finite number > 0 (see T001).',
    );
  }
  return v;
})();

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
export async function mockApi(
  target: Page | BrowserContext,
  handler: Handler = byQuery,
  meta: Meta = META,
  metaDelayMs = 0,
): Promise<ApiMock> {
  const bodies: LookupBody[] = [];
  await target.route('**/api/**', async (route) => {
    const url = new URL(route.request().url());
    if (url.pathname === '/api/meta') {
      if (metaDelayMs) await new Promise((r) => setTimeout(r, metaDelayMs));
      return route.fulfill({ json: meta });
    }
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
/** `.sheet` is not unique on the page: the Recent sheet dialog (`.sheet.sheet--full`) also carries
 *  it. `.col-result` wraps only the result sheet, at every width (it's the always-rendered column
 *  wrapper, R-B/document structure), so scoping through it disambiguates. */
export const resultSheet = (page: Page) => page.locator('.col-result .sheet');
/** `.recent-item` is unique on the page either way: `RecentList` renders exactly one of the pane
 *  (`#recent`, ≥ 1024 px) or sheet (`dialog.recent-sheet`, < 1024 px) presentations at a time. Call
 *  `openRecent(page)` first below 1024 px so the items are actually visible/interactable. */
export const recentItems = (page: Page) => page.locator('.recent-item');

/** Types a query and presses Enter (the keyboard path). */
export async function submitQuery(page: Page, query: string): Promise<void> {
  await input(page).fill(query);
  // `fill` dispatches the native `input` event; Preact's controlled-input state update from it is
  // not necessarily committed by the time `fill` resolves. Pressing Enter before it lands can
  // submit against the (still empty) prior value, tripping the "Enter a barcode or item name"
  // client-side validation instead of the query just typed. Waiting for the DOM value to actually
  // read back what was filled pins that race closed — cheap when it's already true.
  await expect(input(page)).toHaveValue(query);
  await input(page).press('Enter');
}

/** Submits a fixture's query and waits until its verdict heading has focus. */
export async function lookupFixture(page: Page, name: FixtureName): Promise<void> {
  await submitQuery(page, QUERIES[name].query);
  await expect(resultHeading(page)).toHaveText(LABELS[name]);
  await expect(resultHeading(page)).toBeFocused();
}

/**
 * Runs `lookupFixture` for each name in turn, dismissing with "Check another" between them.
 * Below 1024 px the lookup group (and `#lookup-input`) only exists in the resting sheet (T032) —
 * once a result expands the sheet, a second typed submission needs a fresh dismissal first, not
 * the (now unmounted) previous `#lookup-input`.
 */
export async function lookupSequence(page: Page, names: readonly FixtureName[]): Promise<void> {
  for (let i = 0; i < names.length; i++) {
    if (i > 0) {
      await page.getByRole('button', { name: 'Check another' }).click();
      // "Check another" clears the input via a post-render effect (app.tsx's `pendingFormAction`),
      // not synchronously with the click: filling immediately can race that effect and have the
      // clear stomp the just-typed value. Waiting for the value to actually become empty pins the
      // race to always resolve before the next fill.
      await expect(input(page)).toHaveValue('');
    }
    await lookupFixture(page, names[i]!);
  }
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

/**
 * axe reports contrast as *incomplete* (not a violation) for text over a `<video>` — it cannot
 * rasterize video frames. So a state with a live camera would otherwise stop being checked for
 * contrast the moment it appears. Failing on a `color-contrast` `incomplete` entry here is what
 * keeps that an asserted fact rather than a silent gap (research R5).
 */
export async function expectNoIncompleteContrast(page: Page): Promise<void> {
  const { incomplete } = await new AxeBuilder({ page }).withTags(AXE_TAGS).analyze();
  const contrastIncomplete = incomplete.filter((i) => i.id === 'color-contrast');
  const stillUnresolved: string[] = [];
  for (const item of contrastIncomplete) {
    for (const node of item.nodes) {
      const target = node.target as string[];
      const selector = target.join(' ');
      // Most `incomplete` hits here are geometric false positives (`elmPartiallyObscured` /
      // `elmPartiallyObscuring`, always `contrastRatio: 0`): the node's rect crossed the fixed,
      // `overflow-y: auto` sheet's clip edge, or sat in a flex chrome bar whose child only
      // partially covered the parent box, before axe ever got a settled layout to measure.
      // Scrolling the node fully into view and re-running axe scoped to just it resolves those;
      // a genuinely unresolvable case (a live <video>, a real translucent overlay) stays
      // incomplete even after scrolling — `withVideoHidden` covers the video case separately, so
      // this loop is what's left closing the hole for everything else.
      try {
        await page.locator(selector).first().scrollIntoViewIfNeeded({ timeout: 2000 });
      } catch {
        // Detached or zero-size nodes can't be scrolled; the re-run below settles it regardless.
      }
      const rerun = await new AxeBuilder({ page }).withTags(AXE_TAGS).include(target).analyze();
      const nowViolates = rerun.violations.some((i) => i.id === 'color-contrast');
      if (nowViolates) {
        stillUnresolved.push(selector);
        continue;
      }
      const stillIncomplete = rerun.incomplete.find((i) => i.id === 'color-contrast');
      if (!stillIncomplete) continue; // resolved by the scroll

      // Weaker fallback (documented per instruction, used only because measured necessary): the
      // chrome bar's flex children (e.g. the Cancel button) report `elmPartiallyObscured` /
      // `elmPartiallyObscuring` even after a full scroll-into-view — this one is a flex box-model
      // partial-coverage quirk, not a scroll clip, so the re-check above can never resolve it.
      // Accept that specific reason, but only on the chrome ground (`--chrome-fg` /
      // `--chrome-secondary` / `--chrome-focus` on `--chrome-bg` — contrast-contract.ts C1-C3,
      // already statically verified at 15.63 / 6.95 / 8.15:1). Any other reason, or an incomplete
      // anywhere outside the chrome bar, still fails.
      const reasons = (stillIncomplete.nodes[0]?.any ?? []).map((c) => c.data?.['messageKey'] ?? c.id);
      const knownReason = reasons.length > 0 && reasons.every((r) => r === 'elmPartiallyObscured' || r === 'elmPartiallyObscuring');
      const onChrome = await page.locator(selector).first().evaluate((el) => !!el.closest('.chrome'));
      if (!(knownReason && onChrome)) stillUnresolved.push(selector);
    }
  }
  expect(stillUnresolved, 'color-contrast still unresolved after scrolling the node into view').toEqual([]);
}

/** The full per-state bar: axe, no horizontal scroll, target sizes. Focus is asserted per state. */
export async function expectStateAccessible(page: Page, label: string): Promise<void> {
  await expectNoAxeViolations(page, label);
  await expectNoHorizontalScroll(page);
  await expectTargetSizes(page);
  // A live <video> makes axe's contrast check merely "incomplete" (see expectNoIncompleteContrast);
  // states with no video in the DOM get a real, checkable answer, so assert it here.
  if ((await page.locator('video').count()) === 0) await expectNoIncompleteContrast(page);
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

// ---- Spec 008: sheet UI (T049) ----

/**
 * `getUserMedia` resolves with a solid-black canvas stream — the worst-case backdrop for a
 * frosted sheet composite. Counts calls on `window.__getUserMediaCalls`, so a test can assert the
 * camera was opened once across two decodes rather than re-acquired per scan (US1, SC-003).
 */
export async function blackCamera(page: Page): Promise<void> {
  await page.addInitScript(() => {
    (window as unknown as { __getUserMediaCalls: number }).__getUserMediaCalls = 0;
    Object.defineProperty(navigator.mediaDevices, 'getUserMedia', {
      value: async () => {
        (window as unknown as { __getUserMediaCalls: number }).__getUserMediaCalls++;
        const c = document.createElement('canvas');
        c.width = 320;
        c.height = 240;
        const ctx = c.getContext('2d')!;
        ctx.fillStyle = '#000000';
        ctx.fillRect(0, 0, c.width, c.height);
        // `captureStream(0)` is manual/on-demand: without repeatedly pushing a frame, headless
        // Chromium's canvas-backed MediaStreamTrack never fires a second
        // `requestVideoFrameCallback`, so `detect.ts`'s decode loop never ticks. Redrawing and
        // requesting a frame on an interval is what keeps the video "live" for the decode loop.
        const stream = c.captureStream(0);
        const track = stream.getVideoTracks()[0] as MediaStreamTrack & { requestFrame?: () => void };
        const timer = setInterval(() => {
          ctx.fillRect(0, 0, c.width, c.height);
          track.requestFrame?.();
        }, 50);
        track.addEventListener('ended', () => clearInterval(timer));
        (window as unknown as { __scanStream: MediaStream }).__scanStream = stream;
        return stream;
      },
      configurable: true,
    });
  });
}

/**
 * Stubs `window.BarcodeDetector` with a queue of codes: `detect()` keeps returning the current
 * one (so it decodes twice in a row and fires, matching `detect.ts`'s debounce) until the test
 * calls `window.__nextCode()` to advance the queue. No test hook exists in production code
 * (research R15) — this lives entirely in the page's init script.
 */
export async function fakeDetector(page: Page, codes: string[]): Promise<void> {
  await page.addInitScript((codeList: string[]) => {
    let idx = 0;
    class FakeBarcodeDetector {
      static async getSupportedFormats(): Promise<string[]> {
        return ['ean_13'];
      }
      async detect(): Promise<Array<{ rawValue: string; format: string }>> {
        const code = codeList[idx];
        return code ? [{ rawValue: code, format: 'ean_13' }] : [];
      }
    }
    (window as unknown as { BarcodeDetector: unknown }).BarcodeDetector = FakeBarcodeDetector;
    (window as unknown as { __nextCode: () => void }).__nextCode = () => {
      idx++;
    };
  }, codes);
}

/** Below 1024 px, opens the Recent sheet from the chrome and waits for it; at ≥ 1024 px it is
 *  already the permanent `#recent` column (R9). */
export async function openRecent(page: Page): Promise<void> {
  if (isDesktop(page)) {
    await expect(page.locator('#recent')).toBeVisible();
    return;
  }
  await page.getByRole('button', { name: 'Recent' }).click();
  await expect(page.locator('dialog[open] #recent-heading')).toBeVisible();
}

/**
 * Hides the live `<video>` (display: none) so axe composites the sheet over the `#000` ground
 * behind it (research R5) instead of reporting contrast as merely "incomplete", runs `fn`, then
 * restores the video exactly as it was.
 */
export async function withVideoHidden<T>(page: Page, fn: () => Promise<T>): Promise<T> {
  // Deviation from the T049 wording ("sets display:none on .viewfinder__video"): the reticle
  // (`.viewfinder__reticle`) is also decorative, aria-hidden, painted content sitting behind the
  // glass sheet. Measured: with only the video hidden, axe still reports `color-contrast` as
  // `incomplete` ("overlapped by another element") for sheet content whose bounding box the
  // reticle's inset brackets geometrically intersect — axe can composite two solid colors through
  // an alpha sheet, but not a solid sheet color plus an arbitrary overlapping painted element. That
  // defeats the whole point of this helper (a determinate #000 ground), so both are hidden here.
  const target = page.locator('.viewfinder__video, .viewfinder__reticle');
  await target.evaluateAll((els: HTMLElement[]) => {
    for (const el of els) {
      el.dataset.e2ePrevDisplay = el.style.display;
      el.style.display = 'none';
    }
  });
  try {
    return await fn();
  } finally {
    await target.evaluateAll((els: HTMLElement[]) => {
      for (const el of els) {
        el.style.display = el.dataset.e2ePrevDisplay ?? '';
        delete el.dataset.e2ePrevDisplay;
      }
    });
  }
}

/**
 * Toggles `prefers-reduced-transparency` via CDP (Playwright 1.63 has no first-class option for
 * it), reusing the `newCDPSession` pattern from `axNode`.
 */
// Measured: detaching the CDP session that set `Emulation.setEmulatedMedia` reverts the override
// immediately — Chromium ties this particular emulation to the session's lifetime, not the page.
// A fresh session per call (the `axNode` pattern) therefore silently no-ops the very next
// `matchMedia` read. One session, kept open and reused for every toggle on a given page, is what
// actually lets `on` and `off` both take effect.
const reducedTransparencySessions = new WeakMap<Page, Awaited<ReturnType<BrowserContext['newCDPSession']>>>();

export async function emulateReducedTransparency(page: Page, on: boolean): Promise<void> {
  let cdp = reducedTransparencySessions.get(page);
  if (!cdp) {
    cdp = await page.context().newCDPSession(page);
    reducedTransparencySessions.set(page, cdp);
  }
  // Measured: omitting `media` (passing only `features`) leaves this Chromium build's media
  // features unchanged — the override silently doesn't apply. Passing `media: ''` alongside
  // `features` is what actually flips `matchMedia('(prefers-reduced-transparency: reduce)')`.
  await cdp.send('Emulation.setEmulatedMedia', {
    media: '',
    features: on ? [{ name: 'prefers-reduced-transparency', value: 'reduce' }] : [],
  });
}

/** Every chrome element (bar, buttons, pill, env badge) must stay fully opaque (FR-016): legible
 *  over a live camera feed regardless of theme or reduced-transparency fallback. */
export async function expectChromeOpaque(page: Page): Promise<void> {
  const nonOpaque = await page.evaluate(() => {
    const alphaOf = (color: string): number => {
      const m = /rgba?\(([^)]+)\)/.exec(color);
      if (!m) return 0;
      const parts = m[1]!.split(',').map((s) => parseFloat(s));
      return parts.length === 4 ? parts[3]! : 1;
    };
    const out: string[] = [];
    document.querySelectorAll('.chrome, .chrome__btn, .pill, .env-badge').forEach((start) => {
      // `.chrome__btn` deliberately has no fill of its own (sheet.css) — it sits on the opaque
      // `.chrome` bar beneath it, so what matters for FR-016 is the nearest actual fill up the
      // tree, not this element's own (possibly transparent) background-color.
      let el: Element | null = start;
      let effectiveAlpha = 0;
      while (el) {
        const a = alphaOf(getComputedStyle(el).backgroundColor);
        if (a > 0) {
          effectiveAlpha = a;
          break;
        }
        el = el.parentElement;
      }
      if (effectiveAlpha !== 1) out.push(`${start.className || start.tagName}: effective alpha ${effectiveAlpha}`);
    });
    return out;
  });
  expect(nonOpaque, 'chrome elements with an effective background alpha != 1').toEqual([]);
}
