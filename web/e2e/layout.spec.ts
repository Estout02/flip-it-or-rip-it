// Layout (T036 layout.spec, rewritten by T053/T065 for spec 008): three columns on desktop
// (unchanged — 006 US5), one sheet on phones (the fixed Scan dock is gone), the sheet never covers
// the focused element (WCAG 2.4.11), 400% zoom reflow (1.4.10), reduced motion, and the desktop
// pane-only rules (no grabber, no history entry, Escape does nothing).
import type { Page } from '@playwright/test';
import {
  expect,
  expectNoHorizontalScroll,
  gotoApp,
  lookupFixture,
  lookupSequence,
  mockApi,
  resultSheet,
  test,
  THEMES,
} from './fixtures';

type Box = { x: number; y: number; width: number; height: number };

const box = async (page: Page, selector: string): Promise<Box> => {
  const b = await page.locator(selector).boundingBox();
  if (!b) throw new Error(`${selector} has no box`);
  return b;
};

const intersects = (a: Box, b: Box) =>
  a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;

/** A populated screen: a result with details, plus three Recent entries. */
async function populated(page: Page) {
  await mockApi(page);
  await gotoApp(page);
  await lookupSequence(page, ['flip', 'rip', 'uncertain']);
}

/** Tabs from the top of the document, recording every stop's box, until it wraps around. */
async function tabWalk(page: Page): Promise<{ stops: number; sheetCovers: string[] }> {
  await page.evaluate(() => {
    document.body.tabIndex = -1;
    document.body.focus();
    document.body.removeAttribute('tabindex');
  });

  const seen = new Set<string>();
  const sheetCovers: string[] = [];
  let stops = 0;
  for (let i = 0; i < 80; i++) {
    await page.keyboard.press('Tab');
    const info = await page.evaluate(() => {
      const a = document.activeElement as HTMLElement | null;
      if (!a || a === document.body) return null;
      a.dataset.e2eStop ??= String(Math.random());
      const r = a.getBoundingClientRect();
      const sheet = document.querySelector('.col-result .sheet')!.getBoundingClientRect();
      return {
        key: a.dataset.e2eStop,
        label: (a.getAttribute('aria-label') ?? a.textContent ?? a.id).trim().slice(0, 40),
        isSheet: !!a.closest('.col-result .sheet'),
        // The chrome bar (z-index 20) and the skip link (z-index 100) both sit `position: fixed`
        // above the sheet's z-index 10 (sheet.css/base.css) — they always render on top regardless
        // of geometric overlap, so a bounding-box intersection with either is not the WCAG 2.4.11
        // violation this walk is for (a real visual obscuring).
        isChrome: !!a.closest('.chrome, .skip-link'),
        el: { x: r.x, y: r.y, width: r.width, height: r.height },
        sheet: { x: sheet.x, y: sheet.y, width: sheet.width, height: sheet.height },
      };
    });
    if (!info) break;
    if (seen.has(info.key)) break; // wrapped around
    seen.add(info.key);
    stops++;
    // An element that lives inside the sheet is naturally inside its own box; only a stop
    // outside the sheet being covered by it is the WCAG 2.4.11 violation this test is for.
    if (!info.isSheet && !info.isChrome && intersects(info.el, info.sheet)) sheetCovers.push(info.label);
  }
  return { stops, sheetCovers };
}

for (const colorScheme of THEMES) {
  test.describe(`layout (${colorScheme})`, () => {
    test.use({ colorScheme });

    test('desktop: form, result and Recent side by side in three columns', async ({ page }, info) => {
      test.skip(info.project.name !== 'desktop-1280', 'desktop layout only');
      await populated(page);
      const [l, r, c] = await Promise.all([box(page, '.col-lookup'), box(page, '.col-result'), box(page, '.col-recent')]);
      expect(l.x + l.width).toBeLessThanOrEqual(r.x);
      expect(r.x + r.width).toBeLessThanOrEqual(c.x);
      // All three start within the first screen, at the same row.
      for (const b of [l, r, c]) expect(b.y).toBeLessThan(200);
      await expect(page.locator('.col-lookup')).toBeInViewport();
      await expect(page.locator('.col-result')).toBeInViewport();
      await expect(page.locator('.col-recent')).toBeInViewport();
      await expectNoHorizontalScroll(page);
    });

    test('desktop: the sheet is a pane — no grabber, not fixed, Escape does nothing, no history entry', async ({
      page,
    }, info) => {
      test.skip(info.project.name !== 'desktop-1280', 'desktop layout only');
      await populated(page);
      const sheet = resultSheet(page);
      await expect(sheet).toHaveClass(/sheet--pane/);
      await expect(sheet.locator('.sheet__grabber')).toHaveCount(0);
      const position = await sheet.evaluate((el) => getComputedStyle(el).position);
      expect(position).not.toBe('fixed');

      const before = await sheet.locator('#result-heading').textContent();
      const historyLength = await page.evaluate(() => history.length);
      await page.keyboard.press('Escape');
      await expect(sheet.locator('#result-heading')).toHaveText(before ?? '');
      expect(await page.evaluate(() => history.length)).toBe(historyLength);
    });

    test('the sheet never covers the focused element (WCAG 2.4.11)', async ({ page }, info) => {
      test.skip(info.project.name === 'desktop-1280', 'the sheet is a fixed bottom sheet below 1024 px only');
      await populated(page);
      // Open the rough-figures disclosure so the Tab walk passes through more content.
      await page.locator('.rough > summary').click();

      const { stops, sheetCovers } = await tabWalk(page);
      expect(sheetCovers, `sheet covered: ${sheetCovers.join(', ')}`).toEqual([]);
      // The narrow *expanded* sheet's reachable set is small by design: skip link, chrome
      // Recent, Settings, the rough-figures summary, Check another, Scan the next one — about 6,
      // not the ~10+ of the resting sheet's lookup form. The real subject here is `sheetCovers`
      // above; this floor only guards against the walk silently finding nothing at all.
      expect(stops).toBeGreaterThan(5);
    });

    test('the sheet never covers the focused element with the on-screen keyboard open', async ({ page }, info) => {
      test.skip(info.project.name === 'desktop-1280', 'no on-screen keyboard emulation at desktop');
      await populated(page);
      await page.locator('.rough > summary').click();
      await page.evaluate(() => document.documentElement.style.setProperty('--kb-inset', '300px'));

      const { stops, sheetCovers } = await tabWalk(page);
      expect(sheetCovers, `sheet covered: ${sheetCovers.join(', ')}`).toEqual([]);
      expect(stops).toBeGreaterThan(5);
    });

    test('400% zoom (320 CSS px at 1×): no horizontal scroll opening the sheet, a disclosure, Recent and Settings', async ({
      page,
    }, info) => {
      test.skip(info.project.name !== 'desktop-1280', '1280 / 4 = 320: emulated from the desktop project');
      await page.setViewportSize({ width: 320, height: 200 });
      await populated(page);
      await expectNoHorizontalScroll(page);
      await page.locator('.rough > summary').click();
      await expectNoHorizontalScroll(page);

      await page.getByRole('button', { name: 'Recent' }).click();
      await expect(page.locator('dialog[open] #recent-heading')).toBeVisible();
      await expectNoHorizontalScroll(page);
      const recentDialog = page.locator('dialog[open].recent-sheet');
      // The sheet scrolls internally rather than clipping content at this width (FR-005, SC-005).
      const overflowsInternally = await recentDialog.evaluate(
        (el) => el.scrollHeight >= el.clientHeight && getComputedStyle(el).overflowY !== 'hidden',
      );
      expect(overflowsInternally).toBe(true);
      await recentDialog.locator('.recent-item').nth(1).click();
      await expectNoHorizontalScroll(page);

      await page.getByRole('button', { name: 'Settings' }).click();
      await expect(page.getByRole('dialog', { name: 'Your settings' })).toBeVisible();
      await expectNoHorizontalScroll(page);
      const dialog = await box(page, 'dialog[open]');
      expect(dialog.width).toBeLessThanOrEqual(320);
    });

    test('reduced motion: the result has no entrance animation or transition', async ({ page }) => {
      await page.emulateMedia({ reducedMotion: 'reduce' });
      await mockApi(page);
      await gotoApp(page);
      await lookupFixture(page, 'flip');
      const timing = await resultSheet(page).evaluate((el) => {
        const cs = getComputedStyle(el);
        const secs = (v: string) => Math.max(...v.split(',').map((s) => parseFloat(s) * (s.trim().endsWith('ms') ? 0.001 : 1)));
        return {
          animationName: cs.animationName,
          animation: secs(cs.animationDuration),
          transition: secs(cs.transitionDuration),
          // Only the reduced-motion rule's 0.01 ms transitions may exist; nothing over 1 ms.
          moving: document.getAnimations().filter((a) => Number(a.effect?.getComputedTiming().duration ?? 0) > 1)
            .length,
        };
      });
      expect(timing.transition).toBeLessThanOrEqual(0.001);
      expect(timing.animationName === 'none' || timing.animation <= 0.001).toBe(true);
      expect(timing.moving).toBe(0);
    });
  });
}
