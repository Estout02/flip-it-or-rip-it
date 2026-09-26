// Core flows (T036 core.spec): type → verdict for every fixture, focus management, Recent,
// settings, the stale-response guard, and the native <dialog> behaviours in a real browser.
import {
  expect,
  fakeCamera,
  gotoApp,
  input,
  LABELS,
  lookupFixture,
  mockApi,
  QUERIES,
  rejectCamera,
  resultHeading,
  scanButton,
  submitQuery,
  test,
  THEMES,
  type FixtureName,
} from './fixtures';

const BASIS =
  'Estimated from current eBay asking prices, adjusted toward typical sale prices. Competition counts similar active listings, not sales.';

for (const colorScheme of THEMES) {
  test.describe(`core (${colorScheme})`, () => {
    test.use({ colorScheme });

    for (const name of Object.keys(QUERIES) as FixtureName[]) {
      test(`type → verdict: ${name}`, async ({ page }) => {
        const api = await mockApi(page);
        await gotoApp(page);
        await lookupFixture(page, name);

        expect(api.lookups()).toBe(1);
        await expect(page).toHaveTitle(`${LABELS[name]} · Flip it or Rip it`);
        await expect(page.getByText(BASIS)).toBeVisible();

        // The reason follows the focused heading in reading order, so it's what a screen reader
        // reads next (flagged concern: "the reason must be reachable and read after it").
        const order = await page.evaluate(() => {
          const h = document.getElementById('result-heading')!;
          const reason = document.querySelector('.verdict__reason')!;
          return {
            follows: !!(h.compareDocumentPosition(reason) & Node.DOCUMENT_POSITION_FOLLOWING),
            hidden: !!reason.closest('[aria-hidden="true"]'),
            text: reason.textContent,
          };
        });
        expect(order.follows).toBe(true);
        expect(order.hidden).toBe(false);
        expect(order.text?.length).toBeGreaterThan(10);

        if (name === 'noMarket') {
          await expect(page.locator('.figures')).toHaveCount(0);
          await expect(page.locator('.verdict__reason')).toHaveText(
            "No one is selling this on eBay right now, so there's no price to go on.",
          );
          // Barcode query → "Try the item name instead" empties and focuses the input.
          await page.getByRole('button', { name: 'Try the item name instead' }).click();
          await expect(input(page)).toBeFocused();
          await expect(input(page)).toHaveValue('');
        }
        if (name === 'uncertain') {
          const body = await page.locator('.result').innerText();
          expect(body.toLowerCase()).not.toMatch(/donate|recycle/);
        }
      });
    }

    test('Check another clears and focuses the input; the keyboard loop works', async ({ page }) => {
      await mockApi(page);
      await gotoApp(page);
      await lookupFixture(page, 'flip');
      // From the focused heading, Tab reaches Check another.
      const checkAnother = page.getByRole('button', { name: 'Check another' });
      for (let i = 0; i < 10 && !(await checkAnother.evaluate((el) => el === document.activeElement)); i++) {
        await page.keyboard.press('Tab');
      }
      await expect(checkAnother).toBeFocused();
      await page.keyboard.press('Enter');
      await expect(input(page)).toBeFocused();
      await expect(input(page)).toHaveValue('');
    });

    test('Recent persists across reload; selecting an entry makes no request', async ({ page }) => {
      const api = await mockApi(page);
      await gotoApp(page);
      await lookupFixture(page, 'flip');
      await lookupFixture(page, 'rip');
      expect(api.lookups()).toBe(2);

      await page.reload();
      await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
      const items = page.locator('#recent .recent-item');
      await expect(items).toHaveCount(2);
      // Newest first.
      await expect(items.first()).toHaveAccessibleName(/^Rip it: Common Paperback, \+\$10\.27 profit, checked /);

      await items.nth(1).click();
      await expect(resultHeading(page)).toHaveText('Flip it');
      await expect(resultHeading(page)).toBeFocused();
      await expect(page.locator('.verdict__saved')).toContainText('Saved result, not refreshed.');
      expect(api.lookups(), 'selecting Recent must not call the API').toBe(2);
    });

    test('settings persist across reload and are sent with the lookup', async ({ page }) => {
      const api = await mockApi(page);
      await gotoApp(page);
      await page.getByRole('button', { name: 'Settings' }).click();
      const dialog = page.getByRole('dialog', { name: 'Your settings' });
      await expect(dialog).toBeVisible();
      await expect(page.locator('#threshold-input')).toBeFocused();
      await page.locator('#threshold-input').fill('25');
      await page.keyboard.press('Enter');
      await expect(dialog).toBeHidden();
      await expect(page.getByRole('button', { name: 'Settings' })).toBeFocused();

      await page.reload();
      await expect(page.locator('.threshold')).toContainText('Minimum profit: $25.00');
      await lookupFixture(page, 'flip');
      expect(api.bodies[0]).toMatchObject({ title: 'Chrono Trigger SNES', profitThresholdCents: 2500 });
    });

    test('settings dialog: Escape closes, focus is trapped, focus returns to the opener', async ({ page }) => {
      await mockApi(page);
      await gotoApp(page);
      const opener = page.getByRole('button', { name: 'Settings' });
      await opener.focus();
      await page.keyboard.press('Enter');
      const dialog = page.getByRole('dialog', { name: 'Your settings' });
      await expect(dialog).toBeVisible();

      // Tab forward through more stops than the dialog has: focus never leaves it (the page
      // behind is inert). Chromium lets focus reach the browser chrome after the last stop,
      // which isn't observable here, so we only require that no page element outside gets it.
      for (let i = 0; i < 8; i++) {
        await page.keyboard.press('Tab');
        const inside = await page.evaluate(() => {
          const a = document.activeElement;
          return a === document.body || a === null || !!a.closest('dialog[open]');
        });
        expect(inside, `Tab ${i + 1} left the dialog`).toBe(true);
      }
      await page.keyboard.press('Escape');
      await expect(dialog).toBeHidden();
      await expect(opener).toBeFocused();

      // The "Edit" opener in the threshold summary gets focus back too.
      const edit = page.getByRole('button', { name: 'Edit minimum profit' });
      await edit.click();
      await expect(dialog).toBeVisible();
      await page.getByRole('button', { name: 'Close' }).click();
      await expect(edit).toBeFocused();
    });

    test('clear history: Cancel is focused, Escape returns focus, Clear empties the list', async ({ page }) => {
      await mockApi(page);
      await gotoApp(page);
      await lookupFixture(page, 'flip');
      const clear = page.getByRole('button', { name: 'Clear history' });
      await clear.click();
      const dialog = page.getByRole('dialog', { name: 'Clear all recent lookups on this device?' });
      await expect(dialog).toBeVisible();
      await expect(dialog.getByRole('button', { name: 'Cancel' })).toBeFocused();
      await page.keyboard.press('Escape');
      await expect(dialog).toBeHidden();
      await expect(clear).toBeFocused();
      await expect(page.locator('#recent .recent-item')).toHaveCount(1);

      await clear.click();
      await dialog.getByRole('button', { name: 'Clear', exact: true }).click();
      await expect(dialog).toBeHidden();
      await expect(page.locator('#recent-heading')).toBeFocused();
      await expect(page.getByText('Items you check will show up here.')).toBeVisible();
      await page.reload();
      await expect(page.getByText('Items you check will show up here.')).toBeVisible();
    });

    test('stale-response guard: only the second of two submits renders', async ({ page }) => {
      let releaseFirst!: () => void;
      const first = new Promise<void>((r) => (releaseFirst = r));
      const api = await mockApi(page, (body, n) =>
        n === 1 ? { hold: first, json: QUERIES.rip.result } : { json: QUERIES.flip.result },
      );
      await gotoApp(page);
      await submitQuery(page, QUERIES.rip.query);
      await expect(page.locator('.result[aria-busy="true"]')).toBeVisible();
      await submitQuery(page, QUERIES.flip.query);
      await expect(resultHeading(page)).toHaveText('Flip it');
      releaseFirst();
      // Give the late first response every chance to land, then confirm it didn't.
      await page.waitForTimeout(300);
      await expect(resultHeading(page)).toHaveText('Flip it');
      await expect(page.locator('#recent .recent-item')).toHaveCount(1);
      expect(api.lookups()).toBe(2);
    });

    test('the cost field is sent once and not kept after submit', async ({ page }) => {
      const api = await mockApi(page);
      await gotoApp(page);
      await page.getByText('What I paid (optional)').click();
      await page.locator('#cost-input').fill('4.50');
      await lookupFixture(page, 'flip');
      expect(api.bodies[0]).toMatchObject({ costBasisCents: 450 });
      await expect(page.locator('.figures')).toContainText('What you paid');
      await page.getByRole('button', { name: 'Check another' }).click();
      await expect(page.locator('#cost-input')).toHaveValue('');
    });

    test.describe('scanner fallbacks (native <dialog>)', () => {
      for (const [err, body] of [
        ['NotAllowedError', 'Camera access was blocked.'],
        ['NotFoundError', 'No camera was found.'],
        ['TypeError', "This browser can't scan barcodes."],
      ] as const) {
        test(`${err}: "Type it instead" focused; it focuses the input; Escape returns to Scan`, async ({ page }) => {
          await rejectCamera(page, err);
          await mockApi(page);
          await gotoApp(page);
          await scanButton(page).click();
          const dialog = page.getByRole('dialog', { name: 'Camera not available' });
          await expect(dialog).toBeVisible();
          await expect(dialog).toContainText(body);
          const typeInstead = dialog.getByRole('button', { name: 'Type it instead' });
          await expect(typeInstead).toBeFocused();
          // Only one stop inside: Tab keeps focus in the dialog.
          await page.keyboard.press('Tab');
          expect(await page.evaluate(() => !document.activeElement?.closest('main, header'))).toBe(true);

          await page.keyboard.press('Escape');
          await expect(dialog).toBeHidden();
          await expect(scanButton(page)).toBeFocused();

          await scanButton(page).click();
          await expect(typeInstead).toBeFocused();
          await typeInstead.click();
          await expect(dialog).toBeHidden();
          await expect(input(page)).toBeFocused();
        });
      }

      test('live viewfinder: Cancel focused, Escape closes, camera stops, focus returns to Scan', async ({ page }) => {
        await fakeCamera(page);
        await mockApi(page);
        await gotoApp(page);
        await scanButton(page).click();
        const dialog = page.getByRole('dialog', { name: 'Point at a barcode' });
        await expect(dialog).toBeVisible();
        await expect(dialog.getByRole('button', { name: 'Cancel' })).toBeFocused();
        await page.waitForFunction(() => !!(window as unknown as { __scanStream?: MediaStream }).__scanStream);
        await page.keyboard.press('Escape');
        await expect(dialog).toBeHidden();
        await expect(scanButton(page)).toBeFocused();
        // Chromium hides a closed <dialog> (and restores focus) synchronously but dispatches its
        // `close` event — where the app stops the camera — as a queued task, measured at ~15 ms
        // after Escape. So poll, with a tight bound that still catches a leaked camera.
        await expect
          .poll(
            () =>
              page.evaluate(() =>
                (window as unknown as { __scanStream: MediaStream }).__scanStream
                  .getTracks()
                  .every((t) => t.readyState === 'ended'),
              ),
            { timeout: 500, intervals: [10] },
          )
          .toBe(true);
      });
    });
  });
}
