// T024: axe-core on every screen state reachable in jsdom → 0 violations.
// jsdom has no layout, so color contrast is covered by the Playwright matrix (T036) and by the
// verified token pairs in styles/tokens.css.
import { fireEvent, render, screen, waitFor, within } from '@testing-library/preact';
import axe from 'axe-core';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Scanner } from './scanner/scanner';
import { mockApi, renderApp, typeAndSubmit } from './test/app-harness';
import { flip, jsonResponse, noMarket, rip, risky, uncertain } from './test/fixtures';
import type { VerdictResult } from './lib/types';

afterEach(() => vi.unstubAllGlobals());

const TAGS = ['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa'];

async function expectNoViolations(root: Element = document.body) {
  const results = await axe.run(root, { runOnly: { type: 'tag', values: TAGS } });
  const summary = results.violations.map((v) => `${v.id}: ${v.help} → ${v.nodes.map((n) => n.html).join(' | ')}`);
  expect(summary).toEqual([]);
}

async function resultState(result: VerdictResult, label: string, query = 'Chrono Trigger SNES') {
  mockApi(() => jsonResponse(result));
  const { input } = renderApp();
  typeAndSubmit(input, query);
  await screen.findByRole('heading', { level: 2, name: label });
}

describe('axe: 0 violations per state', () => {
  it('S0 empty', async () => {
    mockApi(() => jsonResponse(flip));
    renderApp();
    await expectNoViolations();
  });

  it('S1 loading', async () => {
    mockApi(() => new Promise<Response>(() => undefined));
    const { input } = renderApp();
    typeAndSubmit(input, 'Chrono Trigger SNES');
    await screen.findByRole('button', { name: 'Checking…' });
    await expectNoViolations();
  });

  it('S2 FLIP', async () => {
    await resultState(flip, 'Flip it');
    await expectNoViolations();
  });

  it('S3 FLIP_RISKY', async () => {
    await resultState(risky, 'Flip it — slow seller');
    await expectNoViolations();
  });

  it('S4 RIP', async () => {
    await resultState(rip, 'Rip it');
    await expectNoViolations();
  });

  it('S5 UNCERTAIN (rough figures open too)', async () => {
    await resultState(uncertain, "Can't tell");
    await expectNoViolations();
    (document.querySelector('details.rough') as HTMLDetailsElement).open = true;
    await expectNoViolations();
  });

  it('S6 no market data', async () => {
    await resultState(noMarket, 'Rip it', '9780000000002');
    await expectNoViolations();
  });

  it('S7 validation error', async () => {
    mockApi(() => jsonResponse(flip));
    const { input } = renderApp();
    typeAndSubmit(input, '   ');
    await screen.findByText('Enter a barcode or an item name.');
    await expectNoViolations();
  });

  it.each([
    [429, "You've hit today's limit"],
    [503, "eBay isn't answering"],
    [500, 'Something went wrong'],
  ])('S8/S9/S11 error %d', async (status, title) => {
    mockApi(() => jsonResponse({ error: 'x', message: 'y' }, status));
    const { input } = renderApp();
    typeAndSubmit(input, 'x');
    await screen.findByRole('heading', { name: title });
    await expectNoViolations();
  });

  it('S10 offline', async () => {
    mockApi(() => {
      throw new TypeError('Failed to fetch');
    });
    const { input } = renderApp();
    typeAndSubmit(input, 'x');
    await screen.findByRole('heading', { name: "You're offline" });
    await expectNoViolations();
  });

  it('S12 result from history + S13 recent list with entries', async () => {
    await resultState(risky, 'Flip it — slow seller');
    fireEvent.click(within(document.getElementById('recent')!).getAllByRole('listitem')[0]!.querySelector('button')!);
    await screen.findByText(/Saved result, not refreshed\./);
    await expectNoViolations();
  });

  it('S13 clear-history confirm dialog', async () => {
    await resultState(flip, 'Flip it');
    fireEvent.click(screen.getByRole('button', { name: 'Clear history' }));
    await screen.findByRole('dialog', { name: 'Clear all recent lookups on this device?' });
    await expectNoViolations();
  });

  it('S14 settings dialog (with an inline error)', async () => {
    mockApi(() => jsonResponse(flip));
    renderApp();
    fireEvent.click(screen.getByRole('button', { name: 'Settings' }));
    await screen.findByRole('dialog', { name: 'Your settings' });
    await expectNoViolations();
    fireEvent.input(screen.getByLabelText('Minimum profit to flip ($)'), { target: { value: 'abc' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await screen.findByText('Minimum profit: Enter an amount like 12 or 12.50.');
    await expectNoViolations();
  });

  it('S15 scanner viewfinder and the denied fallback', async () => {
    let reject!: (e: unknown) => void;
    const getUserMedia = vi.fn(() => new Promise((_, r) => (reject = r)));
    vi.stubGlobal('navigator', { ...navigator, mediaDevices: { getUserMedia } });
    // Native detector stub, so no decoder wasm is fetched in jsdom.
    vi.stubGlobal('BarcodeDetector', Object.assign(class { detect = async () => []; }, { getSupportedFormats: async () => ['ean_13'] }));
    const { container } = render(<Scanner onCode={vi.fn()} onCancel={vi.fn()} onTypeInstead={vi.fn()} />);
    await screen.findByRole('dialog', { name: 'Point at a barcode' });
    await expectNoViolations(container);
    await waitFor(() => expect(getUserMedia).toHaveBeenCalled());
    reject(Object.assign(new Error('denied'), { name: 'NotAllowedError' }));
    await screen.findByRole('heading', { name: 'Camera not available' });
    await expectNoViolations(container);
  });
});
