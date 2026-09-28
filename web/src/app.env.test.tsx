// Spec 007: the header "Test data" badge and its absence under production/unknown environments.
// Spec 008 (T061): the badge now lives in the chrome, which is reachable in every sheet state —
// resting, an expanded result, and with the Recent sheet open over it (FR-026).
import { fireEvent, screen, waitFor, within } from '@testing-library/preact';
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

describe('environment badge (spec 007, US1; relocated by spec 008 T061)', () => {
  it('shows the badge in the chrome for a sandbox environment, in the resting state', async () => {
    mockApi(() => jsonResponse(flip), SANDBOX);
    renderApp();
    await waitFor(() => expect(document.querySelector('.chrome .env-badge')).not.toBeNull());

    const badge = document.querySelector('.chrome .env-badge')!;
    expect(badge.textContent).toBe(
      "Test data — eBay sandbox. Results come from eBay's test environment, not real listings.",
    );
    expect(badge.previousElementSibling!.tagName).toBe('H1');
    expect(screen.getByRole('heading', { level: 1, name: 'Flip it or Rip it' })).toBeTruthy();
  });

  it('keeps the badge visible with a result sheet expanded', async () => {
    mockApi(() => jsonResponse(flip), SANDBOX);
    const { input } = renderApp();
    typeAndSubmit(input, 'Chrono Trigger SNES');
    await screen.findByRole('heading', { level: 2, name: 'Flip it' });
    expect(document.querySelector('.chrome .env-badge')).not.toBeNull();
  });

  it('keeps the badge visible with the Recent sheet open', async () => {
    mockApi(() => jsonResponse(flip), SANDBOX);
    renderApp();
    await waitFor(() => expect(document.querySelector('.chrome .env-badge')).not.toBeNull());
    fireEvent.click(screen.getByRole('button', { name: 'Recent' }));
    await screen.findByRole('dialog', { name: 'Recent' });
    expect(document.querySelector('.chrome .env-badge')).not.toBeNull();
  });

  // The pill's box is always mounted (it reserves its space before `/api/meta` resolves, and
  // permanently in production — contracts/sheet-states.md:185); "no badge" now means hidden and
  // unannounced, not absent from the DOM.
  it('shows no badge for a production environment', async () => {
    mockApi(() => jsonResponse(flip), PRODUCTION);
    renderApp();
    await screen.findByText('$15.00');
    const badge = document.querySelector('.env-badge')!;
    expect(badge).not.toBeNull();
    expect(badge.classList.contains('env-badge--hidden')).toBe(true);
    expect(badge.getAttribute('aria-hidden')).toBe('true');
  });

  it('shows no badge when the environment is unknown (meta request failed)', async () => {
    const { fetchMock } = mockApi(() => jsonResponse(flip), null);
    renderApp();
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith('/api/meta'));
    await new Promise((r) => setTimeout(r, 0));
    const badge = document.querySelector('.env-badge')!;
    expect(badge).not.toBeNull();
    expect(badge.classList.contains('env-badge--hidden')).toBe(true);
    expect(badge.getAttribute('aria-hidden')).toBe('true');
  });

  it('has 0 axe violations with the badge shown', async () => {
    mockApi(() => jsonResponse(flip), SANDBOX);
    renderApp();
    await waitFor(() => expect(document.querySelector('.chrome .env-badge')).not.toBeNull());
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

    fireEvent.click(screen.getByRole('button', { name: 'Check another' }));
    fireEvent.click(screen.getByRole('button', { name: 'Recent' }));
    const dialog = await screen.findByRole('dialog', { name: 'Recent' });
    expect(within(dialog).getByRole('button', { name: /^Test data: Rip it: / })).toBeTruthy();
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

    fireEvent.click(screen.getByRole('button', { name: 'Check another' }));
    fireEvent.click(screen.getByRole('button', { name: 'Recent' }));
    const dialog = await screen.findByRole('dialog', { name: 'Recent' });
    expect(within(dialog).getByRole('button', { name: /^Rip it: / })).toBeTruthy();
    expect(dialog.querySelector('.chip--test')).toBeNull();
  });
});
