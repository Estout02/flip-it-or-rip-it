// Environment badge (T036 env.spec, spec 007; re-pointed at the chrome/sheet by T063 for spec
// 008): the "Test data" pill lives in `.chrome` now, not a removed `header.app-header`, and stays
// visible with the result sheet expanded and with Recent open.
import {
  BADGE_TEXT,
  expect,
  expectNoAxeViolations,
  expectNoHorizontalScroll,
  expectStateAccessible,
  gotoApp,
  input,
  lookupFixture,
  mockApi,
  openRecent,
  PRODUCTION_META,
  recentItems,
  resultHeading,
  SANDBOX_META,
  test,
  THEMES,
  byQuery,
} from './fixtures';

for (const colorScheme of THEMES) {
  test.describe(`env badge (${colorScheme})`, () => {
    test.use({ colorScheme });

    test('sandbox: header shows the "Test data" pill', async ({ page }) => {
      await mockApi(page, byQuery, SANDBOX_META);
      await gotoApp(page);
      const w = page.viewportSize()!.width;

      const badge = page.locator('.chrome .env-badge');
      await expect(badge).toBeVisible();
      await expect(badge).toBeInViewport();
      await expect(badge).toHaveText(BADGE_TEXT);

      const wideBox = await page.locator('.env-badge__wide').boundingBox();
      if (w < 480) expect(wideBox!.width).toBeLessThanOrEqual(1);
      else expect(wideBox!.width).toBeGreaterThan(1);

      const wordmarkBox = await page.locator('.wordmark__text').boundingBox();
      if (w < 360) expect(wordmarkBox!.width).toBeLessThanOrEqual(1);
      else expect(wordmarkBox!.width).toBeGreaterThan(1);

      await expect(page.getByRole('heading', { level: 1, name: 'Flip it or Rip it' })).toBeVisible();
      await expectNoHorizontalScroll(page);
      await expectNoAxeViolations(page, `badge / ${colorScheme}`);
    });

    test('sandbox badge under forced-colors: solid border, no violations', async ({ page }) => {
      await mockApi(page, byQuery, SANDBOX_META);
      await gotoApp(page);
      await expect(page.locator('.chrome .env-badge')).toBeVisible();

      await page.emulateMedia({ forcedColors: 'active' });
      await expectNoAxeViolations(page, `badge forced-colors / ${colorScheme}`);
      const style = await page.locator('.env-badge').evaluate((el) => {
        const cs = getComputedStyle(el);
        return { borderTopStyle: cs.borderTopStyle, borderTopWidth: cs.borderTopWidth };
      });
      expect(style.borderTopStyle).toBe('solid');
      expect(style.borderTopWidth).toBe('1px');
    });

    test('production: no badge', async ({ page }) => {
      await mockApi(page, byQuery, PRODUCTION_META);
      await gotoApp(page);
      await expect(page.locator('.threshold .money')).toHaveText('$15.00');
      // The badge's box always mounts now (reserves its header space from first paint) — in
      // production it carries `env-badge--hidden` (`visibility: hidden`) rather than being absent.
      await expect(page.locator('.env-badge')).toBeHidden();
      await expect(page.locator('.env-badge')).toHaveAttribute('aria-hidden', 'true');
    });

    test('layout-shift guard: the badge appearing does not move the input or resize the header', async ({ page }) => {
      await mockApi(page, byQuery, SANDBOX_META, 500);
      await page.goto('/');
      await input(page).click();
      await input(page).pressSequentially('Chrono');
      await expect(page.locator('.env-badge')).toBeHidden();

      const inputBefore = await input(page).boundingBox();
      const headerBefore = await page.locator('header.chrome').boundingBox();

      await expect(page.locator('.env-badge')).toBeVisible();

      const inputAfter = await input(page).boundingBox();
      const headerAfter = await page.locator('header.chrome').boundingBox();

      expect(inputAfter!.y).toBeCloseTo(inputBefore!.y, 0);
      expect(inputAfter!.x).toBeCloseTo(inputBefore!.x, 0);
      expect(headerAfter!.height).toBeCloseTo(headerBefore!.height, 0);

      await expect(input(page)).toBeFocused();
      await expect(input(page)).toHaveValue('Chrono');
    });

    test('sandbox no-market: the sparse-sandbox sentence appears; the badge stays visible with the result sheet expanded', async ({
      page,
    }) => {
      await mockApi(page, byQuery, SANDBOX_META);
      await gotoApp(page);
      await expect(page.locator('.env-badge')).toBeVisible();
      await lookupFixture(page, 'noMarket');
      // The badge is chrome — always on top, above the sheet (T063).
      await expect(page.locator('.chrome .env-badge')).toBeVisible();

      await expect(
        page.getByText(
          "You're using eBay's test environment, which has very few listings. This item may well be for sale on real eBay.",
        ),
      ).toBeVisible();
      await expectStateAccessible(page, `S6 sandbox / ${colorScheme}`);

      await page.emulateMedia({ forcedColors: 'active' });
      await expectNoAxeViolations(page, `S6 sandbox forced-colors / ${colorScheme}`);
    });

    test('the badge stays visible with Recent open', async ({ page }) => {
      await mockApi(page, byQuery, SANDBOX_META);
      await gotoApp(page);
      await lookupFixture(page, 'flip');
      await openRecent(page);
      await expect(page.locator('.chrome .env-badge')).toBeVisible();
    });

    test('history remembers the environment it was checked in', async ({ page }) => {
      await mockApi(page, byQuery, SANDBOX_META);
      await gotoApp(page);
      await expect(page.locator('.env-badge')).toBeVisible();
      await lookupFixture(page, 'noMarket');

      await page.unroute('**/api/**');
      await mockApi(page, byQuery, PRODUCTION_META);
      await page.reload();
      await expect(page.locator('.threshold .money')).toHaveText('$15.00');
      await expect(page.locator('.env-badge')).toBeHidden();

      await openRecent(page);
      const recentButton = recentItems(page).first();
      await expect(recentButton).toHaveAttribute('aria-label', /^Test data: Rip it: /);
      await expect(recentButton.locator('.chip--test')).toHaveText('Test data');

      await recentButton.click();
      await expect(resultHeading(page)).toHaveText('Rip it');
      await expect(resultHeading(page)).toBeFocused();
      await expect(page.locator('#result-env-note')).toHaveText('Test data — eBay sandbox');
      await expect(
        page.getByText(
          "You're using eBay's test environment, which has very few listings. This item may well be for sale on real eBay.",
        ),
      ).toBeVisible();
      await expectStateAccessible(page, `S12 sandbox / ${colorScheme}`);
    });
  });
}
