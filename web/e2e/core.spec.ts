// Core flows (T036 core.spec, extended by T038/T042/T065 for spec 008): type → verdict for every
// fixture, focus management, Recent, settings, the stale-response guard, the camera ground's
// lifecycle (no dialogs any more — the camera IS the ground, FR-011), and the desktop pane rules.
import {
  BASELINE_MS,
  blackCamera,
  expect,
  expectNoHorizontalScroll,
  fakeCamera,
  fakeDetector,
  gotoApp,
  input,
  LABELS,
  lookupFixture,
  mockApi,
  openRecent,
  QUERIES,
  recentItems,
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
      await page.getByRole('button', { name: 'Check another' }).click();
      await expect(input(page)).toHaveValue(''); // the clear runs in a post-render effect, not the click itself
      await lookupFixture(page, 'rip');
      expect(api.lookups()).toBe(2);

      await page.reload();
      await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
      await openRecent(page);
      const items = recentItems(page);
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
      await openRecent(page);
      const clear = page.getByRole('button', { name: 'Clear history' });
      await clear.click();
      const dialog = page.getByRole('dialog', { name: 'Clear all recent lookups on this device?' });
      await expect(dialog).toBeVisible();
      await expect(dialog.getByRole('button', { name: 'Cancel' })).toBeFocused();
      await page.keyboard.press('Escape');
      await expect(dialog).toBeHidden();
      await expect(clear).toBeFocused();
      await expect(recentItems(page)).toHaveCount(1);

      await clear.click();
      await dialog.getByRole('button', { name: 'Clear', exact: true }).click();
      await expect(dialog).toBeHidden();
      await expect(page.locator('#recent-heading')).toBeFocused();
      await expect(page.getByText('Items you check will show up here.')).toBeVisible();
      await page.reload();
      await openRecent(page);
      await expect(page.getByText('Items you check will show up here.')).toBeVisible();
    });

    test('stale-response guard: only the second of two submits renders', async ({ page }, testInfo) => {
      // Below 1024 px the lookup group unmounts the moment the sheet expands for the first
      // submit's loading state (T032) — a second typed submit is only reachable at desktop width,
      // where `.col-lookup` keeps `#lookup-input` mounted regardless of the sheet's state. (The
      // narrow-width double-submit path is the scanner one, covered by T038's scanner loop test.)
      test.skip(testInfo.project.name !== 'desktop-1280', 'a second typed submit needs #lookup-input to stay mounted');
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
      await openRecent(page);
      await expect(recentItems(page)).toHaveCount(1);
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

    test.describe('camera ground fallbacks (US1/US2, T038)', () => {
      for (const [err, body] of [
        ['NotAllowedError', 'Camera access was blocked.'],
        ['NotFoundError', 'No camera was found.'],
        ['TypeError', "This browser can't scan barcodes."],
      ] as const) {
        test(`${err}: "Camera not available" notice, "Type it instead" focused, it focuses the input`, async ({
          page,
        }) => {
          await rejectCamera(page, err);
          await mockApi(page);
          await gotoApp(page);
          await scanButton(page).click();
          const heading = page.getByRole('heading', { name: 'Camera not available' });
          await expect(heading).toBeVisible();
          await expect(page.getByText(body, { exact: false })).toBeVisible();
          const typeInstead = page.getByRole('button', { name: 'Type it instead' });
          await expect(typeInstead).toBeFocused();
          await typeInstead.click();
          await expect(input(page)).toBeFocused();
        });
      }

      test('live viewfinder: chrome Cancel focused; clicking it releases the camera and stops the stream', async ({
        page,
      }) => {
        await fakeCamera(page);
        await mockApi(page);
        await gotoApp(page);
        await scanButton(page).click();
        await expect(page.locator('.ground--camera video')).toBeVisible();
        const cancel = page.getByRole('button', { name: 'Cancel' });
        await expect(cancel).toBeFocused();
        await page.waitForFunction(() => !!(window as unknown as { __scanStream?: MediaStream }).__scanStream);
        await cancel.click();
        await expect(page.locator('.ground--camera')).toHaveCount(0);
        // Cancel (unlike Escape/dismiss elsewhere) has no documented refocus target — the button
        // itself unmounts with the camera ground (contracts/sheet-states.md has no rule for it).
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

    test.describe('scanner loop (US1, SC-003)', () => {
      test('one Scan tap decodes two barcodes in a row on a single camera acquisition', async ({ page }, testInfo) => {
        // "Scan the next one" is a narrow-only dismissal control (R-D): at ≥ 1024 px the panes
        // coexist and the primary stays "Check another" (covered by the desktop describe below).
        test.skip(testInfo.project.name === 'desktop-1280', 'no dismissal control at desktop');
        await blackCamera(page);
        await fakeDetector(page, ['9780345391803', '9780000000002']);
        await mockApi(page);
        await gotoApp(page);
        await scanButton(page).click();
        await expect(page.locator('.pill')).toHaveText('Point at a barcode');

        await expect(resultHeading(page)).toHaveText(LABELS.risky, { timeout: 10_000 });
        await expect(resultHeading(page)).toBeFocused();
        await expect(page.locator('.pill')).toHaveText('Barcode found · 9780345391803');
        await expect(page.locator('.ground--camera video')).toHaveCount(1);

        await page.getByRole('button', { name: 'Scan the next one' }).click();
        // The viewfinder never unmounts across the two verdicts (FR-011).
        await expect(page.locator('.ground--camera video')).toHaveCount(1);

        await page.evaluate(() => (window as unknown as { __nextCode: () => void }).__nextCode());
        await expect(resultHeading(page)).toHaveText(LABELS.noMarket, { timeout: 10_000 });
        await expect(resultHeading(page)).toBeFocused();

        const calls = await page.evaluate(() => (window as unknown as { __getUserMediaCalls: number }).__getUserMediaCalls);
        expect(calls, 'getUserMedia call count across both scans').toBe(1);
      });
    });

    test.describe('typed-only path never touches the camera (US2, SC-004)', () => {
      test('no getUserMedia call, no <video>, no scanner-chunk request, and the typed loop keeps working', async ({
        page,
      }) => {
        await page.addInitScript(() => {
          (window as unknown as { __getUserMediaCalls: number }).__getUserMediaCalls = 0;
          const md = navigator.mediaDevices;
          if (md) {
            const orig = md.getUserMedia?.bind(md);
            md.getUserMedia = ((...args: Parameters<NonNullable<typeof orig>>) => {
              (window as unknown as { __getUserMediaCalls: number }).__getUserMediaCalls++;
              return orig ? orig(...args) : Promise.reject(new Error('no camera'));
            }) as typeof md.getUserMedia;
          }
        });
        const scannerRequests: string[] = [];
        await page.route(
          (url) => /zxing|barcode-detector/.test(url.pathname),
          (route) => {
            scannerRequests.push(route.request().url());
            return route.continue();
          },
        );
        await mockApi(page);
        await gotoApp(page);
        expect(await page.evaluate(() => (window as unknown as { __getUserMediaCalls: number }).__getUserMediaCalls)).toBe(0);
        await expect(page.locator('video')).toHaveCount(0);

        for (const name of Object.keys(QUERIES) as FixtureName[]) {
          await lookupFixture(page, name);
          await page.getByRole('button', { name: 'Check another' }).click();
          const freshInput = input(page);
          await expect(freshInput).toBeFocused();
          await expect(freshInput).toHaveValue('');
        }

        expect(scannerRequests, 'no request for the scanner chunk / wasm').toEqual([]);
        expect(await page.evaluate(() => (window as unknown as { __getUserMediaCalls: number }).__getUserMediaCalls)).toBe(0);
        await expect(page.locator('video')).toHaveCount(0);
      });
    });

    test.describe('desktop pane (US6, T065)', () => {
      test('Recent is the visible #recent column, never a dialog; no chrome Recent button', async ({
        page,
      }, testInfo) => {
        test.skip(testInfo.project.name !== 'desktop-1280', 'desktop layout only');
        await mockApi(page);
        await gotoApp(page);
        await expect(page.locator('#recent')).toBeVisible();
        await expect(page.getByRole('button', { name: 'Recent' })).toHaveCount(0);
        await expect(page.getByRole('dialog', { name: 'Recent' })).toHaveCount(0);
      });

      test('the viewfinder card live keeps "Check another" as the only dismissal (no "Scan the next one")', async ({
        page,
      }, testInfo) => {
        test.skip(testInfo.project.name !== 'desktop-1280', 'desktop layout only');
        await blackCamera(page);
        await fakeDetector(page, ['9780345391803']);
        await mockApi(page);
        await gotoApp(page);
        await scanButton(page).click();
        await expect(page.locator('.ground--camera.ground--card video')).toBeVisible();
        await expect(resultHeading(page)).toHaveText(LABELS.risky, { timeout: 10_000 });
        await expect(page.getByRole('button', { name: 'Check another' })).toBeVisible();
        await expect(page.getByRole('button', { name: 'Scan the next one' })).toHaveCount(0);
      });

      test('the whole loop is keyboard-only reachable', async ({ page }, testInfo) => {
        test.skip(testInfo.project.name !== 'desktop-1280', 'desktop layout only');
        await mockApi(page);
        await gotoApp(page);
        await expect(input(page)).toBeFocused();
        await input(page).fill(QUERIES.flip.query);
        await page.keyboard.press('Enter');
        await expect(resultHeading(page)).toHaveText(LABELS.flip);
        const checkAnother = page.getByRole('button', { name: 'Check another' });
        for (let i = 0; i < 15 && !(await checkAnother.evaluate((el) => el === document.activeElement)); i++) {
          await page.keyboard.press('Tab');
        }
        await expect(checkAnother).toBeFocused();
        await page.keyboard.press('Enter');
        await expect(input(page)).toBeFocused();
      });

      test('no horizontal scrolling from 320 px to 1920 px (SC-005)', async ({ page }, testInfo) => {
        test.skip(testInfo.project.name !== 'desktop-1280', 'desktop layout only');
        for (const width of [320, 768, 1024, 1280, 1920]) {
          await page.setViewportSize({ width, height: 900 });
          await mockApi(page);
          await gotoApp(page);
          await expectNoHorizontalScroll(page);
        }
      });
    });
  });
}

// T069, SC-007: the regression gate. Run identically to T001's pre-change baseline recipe (R-G in
// tasks.md) — same helpers, same alternating flip/rip/flip/rip/flip sequence, same per-cycle
// precondition and completion predicate — so the two numbers are comparable. Gated to one device
// profile: the project name must be a real one from playwright.config.ts, or a typo would make
// this skip everywhere while still reporting green.
test('submit → verdict does not regress (SC-007)', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'mobile-390', 'SC-007 is measured on one device profile');

  await mockApi(page);
  await gotoApp(page);

  const sequence: Array<'flip' | 'rip'> = ['flip', 'rip', 'flip', 'rip', 'flip'];
  const samples: number[] = [];

  for (const name of sequence) {
    const label = LABELS[name];
    // 1. Precondition: the heading does not already say this cycle's label, so the completion
    //    predicate below cannot already be true (no ~0 ms false pass).
    await expect(resultHeading(page)).not.toHaveText(label);
    // 2. Fill first — submit → verdict, not type → verdict.
    await input(page).fill(QUERIES[name].query);
    // 3. Measure entirely in-page: no Playwright polling latency in the number.
    const ms = await page.evaluate(async (expected) => {
      const el = document.querySelector('#lookup-input') as HTMLInputElement;
      const started = performance.now();
      const done = () => {
        const h = document.getElementById('result-heading');
        return !!h && h.textContent?.trim() === expected && document.activeElement === h;
      };
      el.form!.requestSubmit();
      await new Promise<void>((resolve, reject) => {
        const obs = new MutationObserver(check);
        const onFocus = () => check();
        const timer = setTimeout(() => {
          stop();
          reject(new Error('verdict never arrived'));
        }, 5000);
        function stop() {
          obs.disconnect();
          document.removeEventListener('focusin', onFocus);
          clearTimeout(timer);
        }
        function check() {
          if (done()) {
            stop();
            resolve();
          }
        }
        obs.observe(document.body, { subtree: true, childList: true, characterData: true });
        document.addEventListener('focusin', onFocus);
        check();
      });
      await new Promise(requestAnimationFrame);
      return performance.now() - started;
    }, label);
    samples.push(ms);
    // 4. Back to the lookup-ready state for the next cycle. The clear itself runs in a
    //    post-render effect, not synchronously with the click (app.tsx's `pendingFormAction`) —
    //    waiting for it here is harness robustness around step 4, not part of the measured
    //    window above, so it doesn't touch the recipe's timing.
    await page.getByRole('button', { name: 'Check another' }).click();
    await expect(input(page)).toHaveValue('');
  }

  samples.sort((a, b) => a - b);
  const median = samples[Math.floor(samples.length / 2)]!;
  const max = Math.max(...samples);
  console.log(`SC-007 submit → verdict: median ${median.toFixed(2)} ms, max ${max.toFixed(2)} ms (baseline ${BASELINE_MS.toFixed(2)} ms)`);

  expect(median, `median ${median.toFixed(2)} ms vs baseline ${BASELINE_MS.toFixed(2)} ms`).toBeLessThanOrEqual(
    Math.max(BASELINE_MS * 1.25, 150),
  );
  expect(max, `slowest cycle ${max.toFixed(2)} ms`).toBeLessThanOrEqual(400);
});
