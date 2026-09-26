// Layout (T036 layout.spec): three columns on desktop, one on phones, the fixed Scan bar never
// hides the focused element (WCAG 2.4.11), 400% zoom reflow (1.4.10), and reduced motion.
import type { Page } from '@playwright/test';
import {
  expect,
  expectNoHorizontalScroll,
  gotoApp,
  lookupFixture,
  mockApi,
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
  await lookupFixture(page, 'flip');
  await lookupFixture(page, 'rip');
  await lookupFixture(page, 'uncertain');
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

    test('phones: one column, and the Scan bar never covers the focused element', async ({ page }, info) => {
      test.skip(info.project.name === 'desktop-1280', 'the Scan bar is fixed below 1024 px only');
      await populated(page);
      const [l, r, c] = await Promise.all([box(page, '.col-lookup'), box(page, '.col-result'), box(page, '.col-recent')]);
      expect(r.y).toBeGreaterThanOrEqual(l.y + l.height);
      expect(c.y).toBeGreaterThanOrEqual(r.y + r.height);
      expect(Math.abs(l.x - r.x)).toBeLessThan(1);

      // Open the rough-figures disclosure so the Tab walk passes through more content.
      await page.locator('.rough > summary').click();
      await page.evaluate(() => {
        document.body.tabIndex = -1;
        document.body.focus();
        document.body.removeAttribute('tabindex');
      });

      const seen = new Set<string>();
      let stops = 0;
      for (let i = 0; i < 80; i++) {
        await page.keyboard.press('Tab');
        const info2 = await page.evaluate(() => {
          const a = document.activeElement as HTMLElement | null;
          if (!a || a === document.body) return null;
          a.dataset.e2eStop ??= String(Math.random());
          const r = a.getBoundingClientRect();
          const d = document.querySelector('.scan-dock')!.getBoundingClientRect();
          return {
            key: a.dataset.e2eStop,
            label: (a.getAttribute('aria-label') ?? a.textContent ?? a.id).trim().slice(0, 40),
            isDock: a.classList.contains('scan-dock'),
            el: { x: r.x, y: r.y, width: r.width, height: r.height },
            dock: { x: d.x, y: d.y, width: d.width, height: d.height },
          };
        });
        if (!info2) break;
        if (seen.has(info2.key)) break; // wrapped around
        seen.add(info2.key);
        stops++;
        if (!info2.isDock) {
          expect(intersects(info2.el, info2.dock), `Scan bar covers "${info2.label}"`).toBe(false);
        }
      }
      expect(stops).toBeGreaterThan(10);
    });

    test('400% zoom (320 CSS px at 1×): no horizontal scroll in any main state', async ({ page }, info) => {
      test.skip(info.project.name !== 'desktop-1280', '1280 / 4 = 320: emulated from the desktop project');
      await page.setViewportSize({ width: 320, height: 200 });
      await populated(page);
      await expectNoHorizontalScroll(page);
      await page.locator('.rough > summary').click();
      await expectNoHorizontalScroll(page);
      await page.locator('#recent .recent-item').nth(1).click();
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
      const timing = await page.locator('.result-enter').evaluate((el) => {
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
