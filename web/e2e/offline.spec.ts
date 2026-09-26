// Offline shell (T036 offline.spec, T035): after one online visit the service worker has
// precached the app, so an offline reload still renders the shell and the Recent list.
import { expect, gotoApp, input, lookupFixture, mockApi, resultHeading, submitQuery, test, THEMES } from './fixtures';

for (const colorScheme of THEMES) {
  test.describe(`offline (${colorScheme})`, () => {
    // The config blocks service workers by default; this spec is about them.
    test.use({ colorScheme, serviceWorkers: 'allow' });

    test('load once, go offline, reload → shell and Recent render; a lookup shows S10', async ({
      page,
      context,
    }) => {
      // Context-level so fetches made by the service worker are intercepted too.
      await mockApi(context);
      await gotoApp(page);
      await lookupFixture(page, 'flip');
      await lookupFixture(page, 'rip');
      await page.waitForFunction(async () => {
        const reg = await navigator.serviceWorker.ready;
        return !!reg.active && !!navigator.serviceWorker.controller;
      });

      await context.setOffline(true);
      await page.reload();
      await expect(page.getByRole('heading', { level: 1, name: 'Flip it or Rip it' })).toBeVisible();
      await expect(input(page)).toBeVisible();
      const items = page.locator('#recent .recent-item');
      await expect(items).toHaveCount(2);
      await expect(items.first()).toHaveAccessibleName(/^Rip it: Common Paperback/);

      // History still works offline (no request needed)...
      await items.nth(1).click();
      await expect(resultHeading(page)).toHaveText('Flip it');

      // ...and a new lookup explains the situation instead of failing silently.
      await submitQuery(page, 'Anything else');
      await expect(resultHeading(page)).toHaveText("You're offline");
      await expect(resultHeading(page)).toBeFocused();
      await expect(input(page)).toHaveValue('Anything else');
    });
  });
}
