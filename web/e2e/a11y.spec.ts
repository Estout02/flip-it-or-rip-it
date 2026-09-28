// Accessibility matrix (T036 a11y.spec, rewritten by T050–T052 for spec 008), the acceptance bar
// in contracts/sheet-states.md "Accessibility acceptance (per state)": for every state S0–S15 and
// N1–N6 reachable without a camera decode loop, at each project width, in light and dark (and
// forced colors for the result states):
//   1. axe (wcag2a/2aa/21aa/22aa) → 0 violations, measured after the entrance animation ends
//   2. no `color-contrast` entry in axe's `incomplete` (states with no live <video>; camera states
//      get a second pass with the video hidden — research R5)
//   3. no horizontal scroll
//   4. the state's focus target is document.activeElement
//   5. every visible interactive target ≥ 44×44 (inline prose links exempt)
//   6. every chrome element's background-color has alpha 1 (camera states)
// Then explicit tests for the concerns flagged during implementation, and the SC-006/FR-018 quartet
// distinctness checks.
import type { Page } from '@playwright/test';
import {
  axNode,
  blackCamera,
  ERRORS,
  expect,
  expectChromeOpaque,
  expectNoAxeViolations,
  expectNoIncompleteContrast,
  expectStateAccessible,
  emulateReducedTransparency,
  fakeCamera,
  fakeDetector,
  gotoApp,
  input,
  isDesktop,
  LABELS,
  lookupFixture,
  lookupSequence,
  mockApi,
  openRecent,
  recentItems,
  resultSheet,
  rejectCamera,
  resultHeading,
  scanButton,
  settle,
  submitQuery,
  test,
  THEMES,
  withVideoHidden,
  words,
  type FixtureName,
} from './fixtures';

type State = {
  id: string;
  /** Runs before the first navigation (init scripts, media emulation). */
  before?: (page: Page) => Promise<void>;
  /** Drives the app into the state. */
  enter: (page: Page) => Promise<void>;
  /** CSS selector of the expected document.activeElement; 'default' = the browser default. */
  focus: string | 'default' | ((page: Page) => string);
  forced?: boolean;
  /** A live viewfinder is present: run the video-hidden contrast pass and expectChromeOpaque. */
  camera?: boolean;
  /** Not applicable at some project widths (e.g. N6 has no on-screen keyboard at desktop). */
  skipIf?: (page: Page) => boolean;
  skipReason?: string;
  /** Extra per-state assertions beyond the generic accessibility bar. */
  extra?: (page: Page) => Promise<void>;
};

const result = (name: FixtureName, extra?: (p: Page) => Promise<void>) => async (page: Page) => {
  await mockApi(page);
  await gotoApp(page);
  await lookupFixture(page, name);
  await extra?.(page);
};

const error = (reply: { status: number; json: unknown }) => async (page: Page) => {
  await mockApi(page, () => reply);
  await gotoApp(page);
  await submitQuery(page, 'Chrono Trigger SNES');
  await expect(resultHeading(page)).toBeFocused();
};

const blockStorage = async (page: Page) => {
  await page.addInitScript(() => {
    Storage.prototype.setItem = () => {
      throw new DOMException('blocked', 'SecurityError');
    };
  });
};

const STATES: State[] = [
  {
    id: 'S0 empty',
    enter: async (page) => {
      await mockApi(page);
      await gotoApp(page);
    },
    // The input autofocuses only at ≥ 1024 px; on phones focus stays at the browser default.
    focus: (page) => (isDesktop(page) ? '#lookup-input' : 'default'),
  },
  {
    id: 'S1 loading',
    enter: async (page) => {
      await mockApi(page, () => ({ hold: new Promise(() => undefined) }));
      await gotoApp(page);
      await submitQuery(page, 'Chrono Trigger SNES');
      await expect(page.locator('.result[aria-busy="true"]')).toBeVisible();
      // Below 1024 px the lookup group (and its Check button) is unmounted while the sheet is
      // expanded — no submitter to keep focus on or show aria-disabled (contracts rule 11).
      if (isDesktop(page)) {
        await expect(page.getByRole('button', { name: 'Checking…' })).toHaveAttribute('aria-disabled', 'true');
      } else {
        await expect(page.getByRole('button', { name: 'Checking…' })).toHaveCount(0);
      }
    },
    // Width-dependent, like S0: the submitter at desktop, the aria-busy loading region below it.
    focus: (page) => (isDesktop(page) ? '#lookup-input' : '.result[aria-busy="true"]'),
  },
  { id: 'S2 FLIP', enter: result('flip'), focus: '#result-heading', forced: true },
  { id: 'S3 FLIP_RISKY', enter: result('risky'), focus: '#result-heading', forced: true },
  { id: 'S4 RIP (medium match badge)', enter: result('rip'), focus: '#result-heading', forced: true },
  { id: 'S5 UNCERTAIN', enter: result('uncertain'), focus: '#result-heading', forced: true },
  {
    id: 'S5 UNCERTAIN, rough figures open',
    enter: result('uncertain', async (page) => {
      await page.locator('.rough > summary').click();
      await expect(page.locator('.rough')).toHaveAttribute('open', '');
    }),
    focus: '.rough > summary',
  },
  { id: 'S6 no market data', enter: result('noMarket'), focus: '#result-heading', forced: true },
  {
    id: 'S7 validation (server 400)',
    enter: async (page) => {
      await mockApi(page, () => ERRORS.validation);
      await gotoApp(page);
      await submitQuery(page, '12345678');
      await expect(page.locator('#lookup-error')).toBeVisible();
    },
    focus: '#lookup-input',
  },
  {
    id: 'S7 validation (cost field)',
    enter: async (page) => {
      await mockApi(page);
      await gotoApp(page);
      await page.getByText('What I paid (optional)').click();
      await page.locator('#cost-input').fill('abc');
      await input(page).fill('Chrono Trigger SNES');
      await input(page).press('Enter');
      await expect(page.locator('#cost-error')).toBeVisible();
    },
    focus: '#cost-input',
  },
  { id: 'S8 limit', enter: error(ERRORS.limit), focus: '#result-heading' },
  { id: 'S9 unavailable', enter: error(ERRORS.unavailable), focus: '#result-heading' },
  {
    id: 'S10 offline',
    enter: async (page) => {
      await mockApi(page);
      await gotoApp(page);
      await page.context().setOffline(true);
      await submitQuery(page, 'Chrono Trigger SNES');
      await expect(resultHeading(page)).toHaveText("You're offline");
    },
    focus: '#result-heading',
  },
  { id: 'S11 unexpected', enter: error(ERRORS.unexpected), focus: '#result-heading' },
  {
    id: 'S12 from history',
    enter: async (page) => {
      await mockApi(page);
      await gotoApp(page);
      await lookupSequence(page, ['flip', 'uncertain', 'noMarket']);
      await openRecent(page);
      await recentItems(page).nth(2).click();
      await expect(page.locator('.verdict__saved')).toBeVisible();
    },
    focus: '#result-heading',
  },
  {
    id: 'S13 Recent, clear-history confirm open',
    enter: async (page) => {
      await mockApi(page);
      await gotoApp(page);
      await lookupFixture(page, 'rip');
      await openRecent(page);
      await page.getByRole('button', { name: 'Clear history' }).click();
      await expect(page.getByRole('dialog', { name: 'Clear all recent lookups on this device?' })).toBeVisible();
    },
    // Below 1024 px the confirm dialog sits atop the still-open Recent sheet dialog — disambiguate
    // by the confirm's own class rather than a bare `dialog[open]`, which would match both.
    focus: 'dialog.dialog--small[open] .btn:not(.btn--primary)',
  },
  {
    id: 'S13 storage unavailable',
    before: blockStorage,
    enter: async (page) => {
      await mockApi(page);
      await gotoApp(page);
      // `getByText` would also match the live-region announcement of the same sentence; the
      // visible notice is the actual UI surface (`.recent__notice`).
      await expect(page.locator('.recent__notice')).toHaveText("Recent lookups can't be saved in this browser.");
      await lookupFixture(page, 'flip');
      await expect(recentItems(page)).toHaveCount(1);
    },
    focus: '#result-heading',
  },
  {
    id: 'S14 settings dialog',
    enter: async (page) => {
      await mockApi(page);
      await gotoApp(page);
      await page.getByRole('button', { name: 'Settings' }).click();
      await expect(page.getByRole('dialog', { name: 'Your settings' })).toBeVisible();
    },
    focus: '#threshold-input',
  },
  {
    id: 'S14 settings dialog, invalid input',
    enter: async (page) => {
      await mockApi(page);
      await gotoApp(page);
      await page.getByRole('button', { name: 'Settings' }).click();
      await page.locator('#threshold-input').fill('lots');
      await page.getByRole('button', { name: 'Save' }).click();
      await expect(page.locator('#threshold-error')).toBeVisible();
    },
    focus: '#threshold-input',
  },
  {
    id: 'S15 viewfinder',
    before: fakeCamera,
    enter: async (page) => {
      await mockApi(page);
      await gotoApp(page);
      await scanButton(page).click();
      await expect(page.locator('.ground--camera video')).toBeVisible();
      await expect(page.locator('.pill')).toHaveText('Point at a barcode');
    },
    focus: 'button:text-is("Cancel")',
    camera: true,
  },
  ...(
    [
      ['denied', 'NotAllowedError'],
      ['no camera', 'NotFoundError'],
      ['unsupported', 'TypeError'],
    ] as const
  ).map(
    ([label, err]): State => ({
      id: `S15 camera unavailable (${label})`,
      before: (page) => rejectCamera(page, err),
      enter: async (page) => {
        await mockApi(page);
        await gotoApp(page);
        await scanButton(page).click();
        await expect(page.getByRole('heading', { name: 'Camera not available' })).toBeVisible();
      },
      focus: 'button:text-is("Type it instead")',
    }),
  ),
  {
    id: 'N1 resting over static',
    enter: async (page) => {
      await mockApi(page);
      await gotoApp(page);
    },
    focus: (page) => (isDesktop(page) ? '#lookup-input' : 'default'),
    extra: async (page) => {
      await expect(page.locator('video')).toHaveCount(0);
      await expect(page.locator('.viewfinder__reticle')).toHaveCount(0);
      await expect(page.locator('.pill')).toHaveCount(0);
    },
  },
  {
    id: 'N2 resting over live viewfinder',
    before: fakeCamera,
    enter: async (page) => {
      await mockApi(page);
      await gotoApp(page);
      await scanButton(page).click();
      await expect(page.locator('.ground--camera video')).toBeVisible();
    },
    focus: 'button:text-is("Cancel")',
    camera: true,
  },
  {
    id: 'N3 result over live viewfinder',
    before: async (page) => {
      await blackCamera(page);
      await fakeDetector(page, ['9780345391803']);
    },
    enter: async (page) => {
      await mockApi(page);
      await gotoApp(page);
      await scanButton(page).click();
      await expect(resultHeading(page)).toHaveText(LABELS.risky, { timeout: 10_000 });
    },
    focus: '#result-heading',
    forced: true,
    camera: true,
  },
  {
    id: 'N4 Recent over a result',
    enter: async (page) => {
      await mockApi(page);
      await gotoApp(page);
      await lookupFixture(page, 'flip');
      if (!isDesktop(page)) await openRecent(page);
    },
    // At ≥ 1024 px Recent is a permanent column, not an overlay over the result — there is no
    // dialog to open, so this state degrades to asserting the column is there (contracts N4 note).
    focus: (page) => (isDesktop(page) ? '#result-heading' : 'dialog[open] #recent-heading'),
    extra: async (page) => {
      if (isDesktop(page)) await expect(page.locator('#recent')).toBeVisible();
    },
  },
  {
    id: 'N5 opaque fallback',
    before: async (page) => {
      await blackCamera(page);
      await fakeDetector(page, ['9780345391803']);
    },
    enter: async (page) => {
      await mockApi(page);
      await gotoApp(page);
      await scanButton(page).click();
      await expect(resultHeading(page)).toHaveText(LABELS.risky, { timeout: 10_000 });
      await emulateReducedTransparency(page, true);
    },
    focus: '#result-heading',
    camera: true,
    extra: async (page) => {
      const measure = () =>
        resultSheet(page).evaluate((el) => {
          const cs = getComputedStyle(el);
          const m = /rgba?\(([^)]+)\)/.exec(cs.backgroundColor);
          const parts = m ? m[1]!.split(',').map((s) => parseFloat(s)) : [];
          return { alpha: parts.length === 4 ? parts[3]! : 1, backdrop: cs.backdropFilter };
        });
      const reduced = await measure();
      expect(reduced.alpha, 'sheet background alpha under reduced transparency').toBe(1);
      expect(reduced.backdrop === 'none' || reduced.backdrop === '', `backdrop-filter: ${reduced.backdrop}`).toBe(
        true,
      );

      await emulateReducedTransparency(page, false);
      const restored = await measure();
      expect(restored.backdrop, 'the glass returns once the preference clears (FR-019)').not.toBe('none');

      // Leave the page in the state this test is named for, for the video-hidden contrast pass.
      await emulateReducedTransparency(page, true);
    },
  },
  {
    id: 'N6 keyboard open',
    enter: async (page) => {
      await mockApi(page);
      await gotoApp(page);
      await page.evaluate(() => document.documentElement.style.setProperty('--kb-inset', '300px'));
      await input(page).focus();
    },
    focus: '#lookup-input',
    skipIf: isDesktop,
    skipReason: 'no on-screen keyboard emulation at desktop (contracts N6 note)',
    extra: async (page) => {
      const inputBox = await input(page).boundingBox();
      const sheetBox = await resultSheet(page).boundingBox();
      const viewport = page.viewportSize()!;
      expect(inputBox).toBeTruthy();
      expect(sheetBox).toBeTruthy();
      expect(inputBox!.y).toBeGreaterThanOrEqual(sheetBox!.y);
      expect(inputBox!.y + inputBox!.height, 'input bottom stays above the keyboard inset').toBeLessThanOrEqual(
        sheetBox!.y + sheetBox!.height,
      );
      expect(inputBox!.y + inputBox!.height, 'input stays inside the viewport').toBeLessThanOrEqual(viewport.height);
    },
  },
];

async function expectFocus(page: Page, state: State) {
  const target = typeof state.focus === 'function' ? state.focus(page) : state.focus;
  if (target === 'default') {
    const tag = await page.evaluate(() => document.activeElement?.tagName);
    expect(tag).toBe('BODY');
  } else {
    await expect(page.locator(target).first()).toBeFocused();
  }
}

for (const colorScheme of THEMES) {
  test.describe(`a11y matrix (${colorScheme})`, () => {
    test.use({ colorScheme });

    for (const state of STATES) {
      test(state.id, async ({ page }) => {
        if (state.skipIf?.(page)) test.skip(true, state.skipReason);
        await state.before?.(page);
        await state.enter(page);
        await expectFocus(page, state);
        await state.extra?.(page);
        await expectStateAccessible(page, `${state.id} / ${colorScheme}`);
        // Running axe must not have moved focus either.
        await expectFocus(page, state);
        if (state.camera) {
          // FR-016: chrome stays legible over a live camera feed at every alpha.
          await expectChromeOpaque(page);
          // axe reports contrast as merely "incomplete" over a live <video> (research R5); hiding
          // it composites the sheet over the #000 ground, turning the worst case into a fact.
          await withVideoHidden(page, async () => {
            await expectNoAxeViolations(page, `${state.id} (video hidden) / ${colorScheme}`);
            await expectNoIncompleteContrast(page);
          });
        }
      });

      if (state.forced) {
        test(`${state.id} — forced colors`, async ({ page }) => {
          if (state.skipIf?.(page)) test.skip(true, state.skipReason);
          await page.emulateMedia({ forcedColors: 'active' });
          await state.before?.(page);
          await state.enter(page);
          await expectFocus(page, state);
          await expectStateAccessible(page, `${state.id} / forced / ${colorScheme}`);
        });
      }
    }

    test('S2 under reduced motion (no entrance animation at all)', async ({ page }) => {
      await page.emulateMedia({ reducedMotion: 'reduce' });
      await mockApi(page);
      await gotoApp(page);
      await lookupFixture(page, 'flip');
      // The reduced-motion rule leaves 0.01 ms transitions (e.g. the focus outline) — nothing
      // that moves. Anything longer than 1 ms would be real motion.
      const moving = await page.evaluate(() =>
        document
          .getAnimations()
          .filter((a) => Number(a.effect?.getComputedTiming().duration ?? 0) > 1)
          .map((a) => (a as CSSAnimation).animationName ?? (a as CSSTransition).transitionProperty),
      );
      expect(moving).toEqual([]);
      await expectStateAccessible(page, `S2 reduced motion / ${colorScheme}`);
    });
  });
}

// ---- SC-006 / FR-018: the four verdicts must differ, and read as different in forced colors ----

test.describe('verdict distinctness (SC-006, FR-018)', () => {
  test('four distinct labels, four distinct icons; UNCERTAIN capsule is dashed, the others solid', async ({
    page,
  }) => {
    await mockApi(page);
    await gotoApp(page);
    const seen: Array<{ name: FixtureName; label: string; icon: string; borderStyle: string }> = [];
    for (const name of ['flip', 'risky', 'rip', 'uncertain'] as const) {
      await lookupFixture(page, name);
      const label = (await resultHeading(page).textContent())?.trim() ?? '';
      const icon = (await page.locator('.capsule__icon').getAttribute('data-icon')) ?? '';
      const borderStyle = await page.locator('.capsule').evaluate((el) => getComputedStyle(el).borderStyle);
      seen.push({ name, label, icon, borderStyle });
      await page.getByRole('button', { name: 'Check another' }).click();
      // The clear runs in a post-render effect, not the click itself (desktop keeps
      // #lookup-input mounted) — wait it out before the next iteration's fill.
      await expect(input(page)).toHaveValue('');
    }
    expect(new Set(seen.map((s) => s.label)).size, 'four distinct labels').toBe(4);
    expect(new Set(seen.map((s) => s.icon)).size, 'four distinct icons').toBe(4);
    for (const s of seen) {
      if (s.name === 'uncertain') expect(s.borderStyle, 'UNCERTAIN capsule is dashed').toBe('dashed');
      else expect(s.borderStyle, `${s.name} capsule is solid`).toBe('solid');
    }
  });

  test('forced colors: the capsule, a chip, buttons, the sheet and a money row keep a visible border', async ({
    page,
  }) => {
    await page.emulateMedia({ forcedColors: 'active' });
    await mockApi(page);
    await gotoApp(page);
    await lookupFixture(page, 'flip');
    await openRecent(page);
    const chip = recentItems(page).first().locator('.chip').first();
    const widths = await Promise.all([
      page.locator('.capsule').evaluate((el) => parseFloat(getComputedStyle(el).borderWidth)),
      chip.evaluate((el) => parseFloat(getComputedStyle(el).borderWidth)),
      resultSheet(page).evaluate((el) => parseFloat(getComputedStyle(el).borderWidth)),
    ]);
    for (const w of widths) expect(w).toBeGreaterThanOrEqual(1);

    // `.btn` (not the chrome bar's `.chrome__btn`, which is a different, unbordered class per
    // R-B) — "Check another" is the primary `.btn.btn--primary` action on this result.
    const btnWidth = await page
      .getByRole('button', { name: 'Check another' })
      .evaluate((el) => parseFloat(getComputedStyle(el).borderWidth));
    expect(btnWidth).toBeGreaterThanOrEqual(1);
    const rowWidth = await page.locator('.figures__row').first().evaluate((el) => parseFloat(getComputedStyle(el).borderWidth));
    expect(rowWidth).toBeGreaterThanOrEqual(1);
  });
});

// ---- Flagged concerns (semantics; theme-independent, run once per project) ----

test.describe('flagged concerns', () => {
  test('verdict heading focus: the reason (and S12 saved note) reach a screen reader', async ({ page }) => {
    await mockApi(page);
    await gotoApp(page);
    await lookupFixture(page, 'rip');
    const h = await axNode(page, '#result-heading');
    expect(h.role).toBe('heading');
    expect(h.name).toBe('Rip it');
    // The reason is the next thing in reading order and is exposed.
    const reason = await axNode(page, '.verdict__reason');
    expect(reason.ignored).toBe(false);
    // 008 R-C: the heading is nested inside `.capsule` (dot + icon + label) — the DOM sibling
    // that immediately follows in reading order is `.capsule`'s own next sibling, not the
    // heading's (it has none; it's the capsule's last child).
    expect(await page.evaluate(() => {
      const capsule = document.getElementById('result-heading')!.closest('.capsule')!;
      return capsule.nextElementSibling?.classList.contains('verdict__reason') ?? false;
    })).toBe(true);

    // S12: the "Saved result, not refreshed" note sits visually above the heading, i.e. before
    // the focus target in reading order. It must still be conveyed when the heading is focused.
    await openRecent(page);
    await recentItems(page).first().click();
    await expect(resultHeading(page)).toBeFocused();
    const saved = await axNode(page, '#result-heading');
    expect(saved.description ?? '').toContain('Saved result, not refreshed.');
  });

  test('label in name (WCAG 2.5.3): every control’s accessible name starts with its visible text', async ({
    page,
  }) => {
    await mockApi(page);
    await gotoApp(page);
    await lookupSequence(page, ['flip', 'uncertain', 'noMarket']);
    await openRecent(page);
    await recentItems(page).nth(1).click(); // S12 on UNCERTAIN: most controls

    const controls = await page.evaluate(() => {
      const out: { idx: number; visible: string }[] = [];
      let i = 0;
      for (const el of document.querySelectorAll<HTMLElement>('button, a, summary, input, [role="button"]')) {
        if (!el.checkVisibility()) continue;
        el.dataset.e2eIdx = String(i);
        // Visible text only: skip visually hidden text (1 px clipped boxes) and inputs' values.
        let visible = '';
        const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
        for (let n = walker.nextNode(); n; n = walker.nextNode()) {
          const parent = n.parentElement!;
          const r = parent.getBoundingClientRect();
          if (parent.closest('.visually-hidden') || r.width <= 1 || r.height <= 1) continue;
          visible += ` ${n.textContent}`;
        }
        out.push({ idx: i++, visible: visible.trim() });
      }
      return out;
    });
    expect(controls.length).toBeGreaterThan(8);

    const problems: string[] = [];
    for (const c of controls) {
      const node = await axNode(page, `[data-e2e-idx="${c.idx}"]`);
      // Chromium's AX tree doesn't expose every DOM-visible control in this state — the offscreen
      // skip link and controls inside the (closed-to-AT) Recent dialog come back `ignored`. That's
      // not a label-in-name failure to report; `controls.length > 8` below still guards against
      // this silently shrinking the set that gets checked.
      if (node.ignored) continue;
      if (node.role === 'textbox') continue; // named by <label>, no visible text inside
      const name = node.name ?? '';
      if (!name.trim()) problems.push(`[${c.visible}] has no accessible name`);
      else if (c.visible && !words(name).startsWith(words(c.visible)))
        problems.push(`name "${name}" does not start with visible "${c.visible}"`);
    }
    expect(problems).toEqual([]);

    // The chrome Settings button's accessible name is exactly "Settings" (icon + visible text at
    // every width — the icon-only < 1024 px variant from 006 no longer exists, R-B).
    // axNode resolves via the browser's native querySelector (CDP), so this must be plain CSS —
    // no Playwright-only pseudo-classes. `:has()` is standard CSS4, supported natively in Chromium.
    const settings = await axNode(page, '.chrome__btn:has([data-icon="settings"])');
    expect(settings.name).toBe('Settings');
  });

  test('UNCERTAIN "Show rough figures (unreliable)" exposes its expanded state', async ({ page }) => {
    await mockApi(page);
    await gotoApp(page);
    await lookupFixture(page, 'uncertain');
    const summary = page.locator('.rough > summary');
    const before = await axNode(page, '.rough > summary');
    expect(before.name).toBe('Show rough figures (unreliable)');
    expect(before.props.expanded).toBe(false);
    await summary.focus();
    await page.keyboard.press('Enter');
    await expect(page.locator('.rough')).toHaveAttribute('open', '');
    const after = await axNode(page, '.rough > summary');
    expect(after.props.expanded).toBe(true);
    await expect(page.locator('.rough')).toContainText('These figures may be for a different product.');
  });

  test('Recent is reachable and is a labelled region with a heading, at every width', async ({ page }) => {
    await mockApi(page);
    await gotoApp(page);
    if (isDesktop(page)) {
      const region = await axNode(page, '#recent');
      expect(region.role).toBe('region');
      expect(region.name).toBe('Recent');
      await expect(page.getByRole('region', { name: 'Recent' }).getByRole('heading', { level: 2, name: 'Recent' })).toBeVisible();
    } else {
      await openRecent(page);
      await expect(page.getByRole('dialog', { name: 'Recent' })).toBeVisible();
      await expect(page.getByRole('heading', { level: 2, name: 'Recent' })).toBeVisible();
    }
  });

  test('no mediaDevices: the Scan button is not rendered (S15 "unsupported" is shown only after a failure)', async ({
    page,
  }) => {
    // With navigator.mediaDevices undefined the contract says the Scan button is not rendered
    // at all, so the "unsupported" S15 panel is reached via a getUserMedia failure instead
    // (covered in the matrix as "S15 camera unavailable (unsupported)").
    await page.addInitScript(() => {
      Object.defineProperty(Navigator.prototype, 'mediaDevices', { get: () => undefined, configurable: true });
    });
    await mockApi(page);
    await gotoApp(page);
    await expect(scanButton(page)).toHaveCount(0);
    await lookupFixture(page, 'uncertain');
    // The UNCERTAIN "Scan the barcode" suggestion degrades to plain text, not a dead button.
    await expect(page.getByRole('button', { name: 'Scan the barcode if it has one' })).toHaveCount(0);
    await expect(page.getByText('Scan the barcode if it has one')).toBeVisible();
    await expectNoAxeViolations(page, 'no mediaDevices');
  });

  test('skip link is first, visible on focus, and lands on the input', async ({ page }) => {
    await mockApi(page);
    await gotoApp(page);
    // Reset the sequential-focus starting point to the top (desktop autofocuses the input).
    await page.evaluate(() => {
      document.body.tabIndex = -1;
      document.body.focus();
      document.body.removeAttribute('tabindex');
    });
    await page.keyboard.press('Tab');
    const skip = page.getByRole('link', { name: 'Skip to lookup' });
    await expect(skip).toBeFocused();
    await expect(skip).toBeInViewport();
    await settle(page);
    await page.keyboard.press('Enter');
    await expect(input(page)).toBeFocused();
  });
});
