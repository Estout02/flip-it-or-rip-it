// Spec 007: the header "Test data" badge and its absence under production/unknown environments.
// US2/US3 integration cases (environment origin flowing to results and history) are appended in
// WP5, which owns the ResultPanel/RecentList/use-lookup wiring those cases depend on.
import { screen, waitFor } from '@testing-library/preact';
import axe from 'axe-core';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { HISTORY_KEY } from './lib/storage';
import type { Meta } from './lib/types';
import { SANDBOX_NO_MARKET } from './lib/verdict-copy';
import { mockApi, META, renderApp, typeAndSubmit } from './test/app-harness';
import { flip, jsonResponse, noMarket } from './test/fixtures';

afterEach(() => vi.unstubAllGlobals());

const SANDBOX = { ...META, ebayEnv: 'sandbox' as const };
const PRODUCTION: Meta = { ...META, defaultProfitThresholdCents: 1500, ebayEnv: 'production' as const };

const TAGS = ['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa'];

describe('environment badge (spec 007, US1)', () => {
  it('shows the badge in the header for a sandbox environment', async () => {
    mockApi(() => jsonResponse(flip), SANDBOX);
    renderApp();
    await waitFor(() => expect(document.querySelector('header .env-badge')).not.toBeNull());

    const badge = document.querySelector('header .env-badge')!;
    expect(badge.textContent).toBe(
      "Test data — eBay sandbox. Results come from eBay's test environment, not real listings.",
    );
    expect(badge.previousElementSibling!.tagName).toBe('H1');
    expect(badge.nextElementSibling!.classList.contains('header__settings')).toBe(true);
    expect(document.querySelector('header')!.classList.contains('app-header--badged')).toBe(true);
    expect(screen.getByRole('heading', { level: 1, name: 'Flip it or Rip it' })).toBeTruthy();
  });

  it('shows no badge for a production environment', async () => {
    mockApi(() => jsonResponse(flip), PRODUCTION);
    renderApp();
    await screen.findByText('$15.00');
    expect(document.querySelector('.env-badge')).toBeNull();
    expect(document.querySelector('header')!.classList.contains('app-header--badged')).toBe(false);
  });

  it('shows no badge when the environment is unknown (meta request failed)', async () => {
    const { fetchMock } = mockApi(() => jsonResponse(flip), null);
    renderApp();
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith('/api/meta'));
    await new Promise((r) => setTimeout(r, 0));
    expect(document.querySelector('.env-badge')).toBeNull();
  });

  it('has 0 axe violations with the badge shown', async () => {
    mockApi(() => jsonResponse(flip), SANDBOX);
    renderApp();
    await waitFor(() => expect(document.querySelector('header .env-badge')).not.toBeNull());
    const results = await axe.run(document.body, { runOnly: { type: 'tag', values: TAGS } });
    expect(results.violations).toEqual([]);
  });
});

describe('environment origin (spec 007, US2 + US3)', () => {
  it('stamps a sandbox lookup with the environment, in the result and in Recent', async () => {
    mockApi(() => jsonResponse(noMarket), SANDBOX);
    const { input } = renderApp();
    await waitFor(() => expect(document.querySelector('.env-badge')).not.toBeNull());

    typeAndSubmit(input, '9780000000002');
    await screen.findByText(SANDBOX_NO_MARKET);

    expect(screen.getByRole('button', { name: /^Test data: Rip it: / })).toBeTruthy();
    const stored = JSON.parse(localStorage.getItem(HISTORY_KEY)!) as { ebayEnv?: string }[];
    expect(stored[0]!.ebayEnv).toBe('sandbox');
  });

  it('shows no sandbox note or chip under a production environment', async () => {
    mockApi(() => jsonResponse(noMarket), PRODUCTION);
    const { input } = renderApp();
    await screen.findByText('$15.00');

    typeAndSubmit(input, '9780000000002');
    await screen.findByRole('heading', { level: 2, name: 'Rip it' });

    expect(screen.queryByText(SANDBOX_NO_MARKET)).toBeNull();
    expect(screen.getByRole('button', { name: /^Rip it: / })).toBeTruthy();
    expect(document.querySelector('.chip--test')).toBeNull();
  });
});
