// Error states (T036 errors.spec): S7 validation (inline), S8 limit, S9 unavailable,
// S10 offline, S11 unexpected — copy verbatim from ui-states.md, focus, and the input kept.
import {
  ERRORS,
  expect,
  gotoApp,
  input,
  lookupFixture,
  META,
  mockApi,
  QUERIES,
  resultHeading,
  submitQuery,
  test,
  THEMES,
} from './fixtures';

const QUERY = 'Chrono Trigger SNES';

for (const colorScheme of THEMES) {
  test.describe(`errors (${colorScheme})`, () => {
    test.use({ colorScheme });

    test('S7 server 400: inline message, aria-invalid, focus on input, previous result kept', async ({ page }) => {
      await mockApi(page, (body) =>
        body.identifier === '12345678' ? ERRORS.validation : { json: QUERIES.flip.result },
      );
      await gotoApp(page);
      await lookupFixture(page, 'flip');
      await submitQuery(page, '12345678');
      const msg = page.locator('#lookup-error');
      await expect(msg).toHaveText(ERRORS.validation.json.message);
      await expect(input(page)).toBeFocused();
      await expect(input(page)).toHaveAttribute('aria-invalid', 'true');
      await expect(input(page)).toHaveAttribute('aria-describedby', 'lookup-error');
      await expect(input(page)).toHaveAccessibleDescription(ERRORS.validation.json.message);
      await expect(input(page)).toHaveValue('12345678');
      await expect(resultHeading(page)).toHaveText('Flip it');
      await expect(page.getByRole('alert')).toHaveText(ERRORS.validation.json.message);
    });

    test('S7 client-side: an empty submit never reaches the API', async ({ page }) => {
      const api = await mockApi(page);
      await gotoApp(page);
      await input(page).press('Enter');
      await expect(page.locator('#lookup-error')).toHaveText('Enter a barcode or an item name.');
      await expect(input(page)).toBeFocused();
      expect(api.lookups()).toBe(0);
    });

    test('S8 limit (429): heading focused, cap from /api/meta, no Try again, #recent reaches Recent', async ({
      page,
    }) => {
      await mockApi(page, (_b, n) => (n === 1 ? { json: QUERIES.flip.result } : ERRORS.limit));
      await gotoApp(page);
      await lookupFixture(page, 'flip');
      await submitQuery(page, 'Another thing');
      await expect(resultHeading(page)).toHaveText("You've hit today's limit");
      await expect(resultHeading(page)).toBeFocused();
      await expect(page.locator('.error-panel')).toContainText(
        new RegExp(`This network has used all ${META.lookupDailyCap} free lookups for today\\. They reset at \\d{1,2}:\\d{2}\\s?[AP]M\\.`),
      );
      await expect(page.getByRole('button', { name: 'Try again' })).toHaveCount(0);
      await expect(input(page)).toHaveValue('Another thing');

      // Flagged concern: the #recent link lands on a sensible target — a named region whose
      // heading is "Recent" — and focus actually moves there (keyboard activation).
      const link = page.getByRole('link', { name: 'Your recent lookups are still here.' });
      await link.focus();
      await page.keyboard.press('Enter');
      await expect(page.locator('#recent')).toBeFocused();
      await expect(page.getByRole('region', { name: 'Recent' })).toBeFocused();
      await expect(page.locator('#recent')).toBeInViewport();
      // The next Tab continues inside Recent, not back at the top of the page.
      await page.keyboard.press('Tab');
      expect(await page.evaluate(() => !!document.activeElement?.closest('#recent'))).toBe(true);
    });

    for (const [kind, heading, body] of [
      ['unavailable', "eBay isn't answering", 'This usually clears up in a few seconds.'],
      ['unexpected', 'Something went wrong', "It's on our side, not yours."],
    ] as const) {
      test(`${kind}: heading focused, copy, Try again re-sends the same input`, async ({ page }) => {
        const api = await mockApi(page, (_b, n) => (n === 1 ? ERRORS[kind] : { json: QUERIES.flip.result }));
        await gotoApp(page);
        await submitQuery(page, QUERY);
        await expect(resultHeading(page)).toHaveText(heading);
        await expect(resultHeading(page)).toBeFocused();
        await expect(page.locator('.error-panel')).toContainText(body);
        await expect(input(page)).toHaveValue(QUERY);
        await page.getByRole('button', { name: 'Try again' }).click();
        await expect(resultHeading(page)).toHaveText('Flip it');
        await expect(resultHeading(page)).toBeFocused();
        expect(api.bodies).toHaveLength(2);
        expect(api.bodies[1]).toEqual(api.bodies[0]);
      });
    }

    test('S10 offline: heading focused, copy, input kept; Try again works once back online', async ({
      page,
      context,
    }) => {
      const api = await mockApi(page);
      await gotoApp(page);
      await context.setOffline(true);
      await submitQuery(page, QUERY);
      await expect(resultHeading(page)).toHaveText("You're offline");
      await expect(resultHeading(page)).toBeFocused();
      await expect(page.locator('.error-panel')).toContainText(
        'Lookups need a connection. Your recent lookups are still available.',
      );
      await expect(input(page)).toHaveValue(QUERY);
      expect(api.lookups()).toBe(0);

      await context.setOffline(false);
      await page.getByRole('button', { name: 'Try again' }).click();
      await expect(resultHeading(page)).toHaveText('Flip it');
      expect(api.lookups()).toBe(1);
    });
  });
}
