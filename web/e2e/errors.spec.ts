// Error states (T036 errors.spec, extended by T062 for spec 008, FR-026): S7 validation (inline),
// S8 limit, S9 unavailable, S10 offline, S11 unexpected — copy verbatim from ui-states.md, focus,
// and the input kept. S8's "recent lookups" reference is device-dependent: a button that opens the
// Recent sheet below 1024 px, and the existing #recent anchor at 1280 px (R9).
import {
  ERRORS,
  expect,
  gotoApp,
  input,
  isDesktop,
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
      // Below 1024 px the lookup group only lives in the resting sheet — Escape collapses to it
      // without resetting `use-lookup` (unlike "Check another"), so the flip result survives
      // underneath exactly as the comment below expects.
      if (!isDesktop(page)) {
        await page.keyboard.press('Escape');
        await expect(input(page)).toHaveValue(''); // the clear runs in a post-render effect, not the Escape keydown itself
      }
      await submitQuery(page, '12345678');
      const msg = page.locator('#lookup-error');
      await expect(msg).toHaveText(ERRORS.validation.json.message);
      await expect(input(page)).toBeFocused();
      await expect(input(page)).toHaveAttribute('aria-invalid', 'true');
      await expect(input(page)).toHaveAttribute('aria-describedby', 'lookup-error');
      await expect(input(page)).toHaveAccessibleDescription(ERRORS.validation.json.message);
      await expect(input(page)).toHaveValue('12345678');
      // Below 1024 px the sheet collapses to rest for S7 (T034): the previous result is not on
      // screen, but it is still the value `use-lookup` holds — nothing was lost, only hidden.
      if (isDesktop(page)) await expect(resultHeading(page)).toHaveText('Flip it');
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

    test('S8 limit (429): heading focused, cap from /api/meta, no Try again', async ({ page }) => {
      await mockApi(page, (_b, n) => (n === 1 ? { json: QUERIES.flip.result } : ERRORS.limit));
      await gotoApp(page);
      await lookupFixture(page, 'flip');
      if (!isDesktop(page)) {
        await page.keyboard.press('Escape');
        await expect(input(page)).toHaveValue('');
      }
      await submitQuery(page, 'Another thing');
      await expect(resultHeading(page)).toHaveText("You've hit today's limit");
      await expect(resultHeading(page)).toBeFocused();
      await expect(page.locator('.error-panel')).toContainText(
        new RegExp(`This network has used all ${META.lookupDailyCap} free lookups for today\\. They reset at \\d{1,2}:\\d{2}\\s?[AP]M\\.`),
      );
      await expect(page.getByRole('button', { name: 'Try again' })).toHaveCount(0);
      await expect(input(page)).toHaveValue('Another thing');
    });

    test('S8 limit: the recent reference is a button that opens Recent below 1024 px', async ({ page }, testInfo) => {
      test.skip(testInfo.project.name === 'desktop-1280', 'the #recent anchor case is covered separately');
      await mockApi(page, (_b, n) => (n === 1 ? { json: QUERIES.flip.result } : ERRORS.limit));
      await gotoApp(page);
      await lookupFixture(page, 'flip');
      await page.keyboard.press('Escape');
      await expect(input(page)).toHaveValue('');
      await submitQuery(page, 'Another thing');
      await expect(resultHeading(page)).toHaveText("You've hit today's limit");

      const button = page.getByRole('button', { name: 'Your recent lookups are still here.' });
      await expect(button).toBeVisible();
      await button.click();
      await expect(page.locator('dialog[open] #recent-heading')).toBeFocused();
      await page.keyboard.press('Escape');
      await expect(button).toBeFocused();
    });

    test('S8 limit: the recent reference is the existing #recent anchor at 1280 px', async ({ page }, testInfo) => {
      test.skip(testInfo.project.name !== 'desktop-1280', 'narrow widths get the Recent-sheet button');
      await mockApi(page, (_b, n) => (n === 1 ? { json: QUERIES.flip.result } : ERRORS.limit));
      await gotoApp(page);
      await lookupFixture(page, 'flip');
      await submitQuery(page, 'Another thing');
      await expect(resultHeading(page)).toHaveText("You've hit today's limit");

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
        // Below 1024 px the error panel lives in the expanded sheet, which has no #lookup-input
        // (it only lives in the resting sheet) — "input kept" is proven by "Try again" resending
        // the identical body below, not by a DOM value that isn't rendered at this width.
        if (isDesktop(page)) await expect(input(page)).toHaveValue(QUERY);
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
      if (isDesktop(page)) await expect(input(page)).toHaveValue(QUERY);
      expect(api.lookups()).toBe(0);

      await context.setOffline(false);
      await page.getByRole('button', { name: 'Try again' }).click();
      await expect(resultHeading(page)).toHaveText('Flip it');
      expect(api.lookups()).toBe(1);
    });
  });
}
