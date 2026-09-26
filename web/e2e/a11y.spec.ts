// Accessibility matrix (T036 a11y.spec), the acceptance bar in contracts/ui-states.md
// "Accessibility checks per state": for every state S0–S15 reachable without a camera, at
// each project width, in light and dark (and forced colors for S2–S6):
//   1. axe (wcag2a/2aa/21aa/22aa) → 0 violations, measured after the entrance animation ends
//   2. no horizontal scroll
//   3. the state's focus target is document.activeElement
//   4. every visible interactive target ≥ 44×44 (inline prose links exempt)
// Then explicit tests for the concerns flagged during implementation.
import type { Page } from '@playwright/test';
import {
  axNode,
  ERRORS,
  expect,
  expectNoAxeViolations,
  expectStateAccessible,
  fakeCamera,
  gotoApp,
  input,
  isDesktop,
  lookupFixture,
  mockApi,
  noMediaDevices,
  QUERIES,
  rejectCamera,
  resultHeading,
  scanButton,
  settle,
  submitQuery,
  test,
  THEMES,
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
      await expect(page.getByRole('button', { name: 'Checking…' })).toHaveAttribute('aria-disabled', 'true');
    },
    focus: '#lookup-input',
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
      await lookupFixture(page, 'flip');
      await lookupFixture(page, 'uncertain');
      await lookupFixture(page, 'noMarket');
      await page.locator('#recent .recent-item').nth(2).click();
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
      await page.getByRole('button', { name: 'Clear history' }).click();
      await expect(page.getByRole('dialog')).toBeVisible();
    },
    focus: 'dialog[open] .btn:not(.btn--primary)',
  },
  {
    id: 'S13 storage unavailable',
    before: blockStorage,
    enter: async (page) => {
      await mockApi(page);
      await gotoApp(page);
      await expect(page.getByText("Recent lookups can't be saved in this browser.")).toBeVisible();
      await lookupFixture(page, 'flip');
      await expect(page.locator('#recent .recent-item')).toHaveCount(1);
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
    id: 'S15 scanner viewfinder (canvas stream, no camera)',
    before: fakeCamera,
    enter: async (page) => {
      await mockApi(page);
      await gotoApp(page);
      await scanButton(page).click();
      await expect(page.getByRole('dialog', { name: 'Point at a barcode' })).toBeVisible();
    },
    focus: '.scanner__cancel',
  },
  ...(
    [
      ['denied', 'NotAllowedError'],
      ['no camera', 'NotFoundError'],
      ['unsupported', 'TypeError'],
    ] as const
  ).map(
    ([label, err]): State => ({
      id: `S15 scanner ${label}`,
      before: (page) => rejectCamera(page, err),
      enter: async (page) => {
        await mockApi(page);
        await gotoApp(page);
        await scanButton(page).click();
        await expect(page.getByRole('dialog', { name: 'Camera not available' })).toBeVisible();
      },
      focus: '.scanner__failed .btn',
    }),
  ),
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
        await state.before?.(page);
        await state.enter(page);
        await expectFocus(page, state);
        await expectStateAccessible(page, `${state.id} / ${colorScheme}`);
        // Running axe must not have moved focus either.
        await expectFocus(page, state);
      });

      if (state.forced) {
        test(`${state.id} — forced colors`, async ({ page }) => {
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
    expect(await page.evaluate(() => {
      const hd = document.getElementById('result-heading')!;
      return hd.nextElementSibling?.classList.contains('verdict__reason') ?? false;
    })).toBe(true);

    // S12: the "Saved result, not refreshed" note sits visually above the heading, i.e. before
    // the focus target in reading order. It must still be conveyed when the heading is focused.
    await page.locator('#recent .recent-item').first().click();
    await expect(resultHeading(page)).toBeFocused();
    const saved = await axNode(page, '#result-heading');
    expect(saved.description ?? '').toContain('Saved result, not refreshed.');
  });

  test('label in name (WCAG 2.5.3): every control’s accessible name starts with its visible text', async ({
    page,
  }) => {
    await mockApi(page);
    await gotoApp(page);
    await lookupFixture(page, 'flip');
    await lookupFixture(page, 'uncertain');
    await lookupFixture(page, 'noMarket');
    await page.locator('#recent .recent-item').nth(1).click(); // S12 on UNCERTAIN: most controls

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
      if (node.role === 'textbox') continue; // named by <label>, no visible text inside
      const name = node.name ?? '';
      if (!name.trim()) problems.push(`[${c.visible}] has no accessible name`);
      else if (c.visible && !words(name).startsWith(words(c.visible)))
        problems.push(`name "${name}" does not start with visible "${c.visible}"`);
    }
    expect(problems).toEqual([]);

    // The icon-only Settings button (< 1024 px) still has the name "Settings"; ≥ 1024 its
    // visible text is exactly that name.
    const settings = await axNode(page, '.header__settings');
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

  test('S8 #recent target is a labelled region with a heading', async ({ page }) => {
    await mockApi(page);
    await gotoApp(page);
    const region = await axNode(page, '#recent');
    expect(region.role).toBe('region');
    expect(region.name).toBe('Recent');
    await expect(page.getByRole('region', { name: 'Recent' }).getByRole('heading', { level: 2, name: 'Recent' })).toBeVisible();
  });

  test('no mediaDevices: the Scan button is not rendered (S15 "unsupported" is shown only after a failure)', async ({
    page,
  }) => {
    // With navigator.mediaDevices undefined the contract says the Scan button is not rendered
    // at all, so the "unsupported" S15 panel is reached via a getUserMedia failure instead
    // (covered in the matrix as "S15 scanner unsupported").
    await noMediaDevices(page);
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
