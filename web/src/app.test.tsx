import { fireEvent, screen, waitFor, within } from '@testing-library/preact';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { loadSettings } from './lib/storage';
import { expandSheet, mockApi, renderApp, sheet, typeAndSubmit } from './test/app-harness';
import { flip, jsonResponse, noMarket, rip } from './test/fixtures';

afterEach(() => vi.unstubAllGlobals());

const heading = (name: string) => screen.findByRole('heading', { level: 2, name });
// Crossing the resting ↔ expanded boundary re-parents the lookup group (T032's "one ordered
// block"), unmounting/remounting `<LookupForm>` and its `#lookup-input` — so any assertion on the
// input made after such a transition must re-query it rather than reuse an old reference.
const currentInput = () => screen.getByLabelText('Barcode or item name') as HTMLInputElement;

describe('App: core loop (US1, US5)', () => {
  it('renders landmarks, the h1, a skip link first, and the empty state in the resting sheet', () => {
    mockApi(() => jsonResponse(flip));
    const { container } = renderApp();
    expect(screen.getByRole('heading', { level: 1, name: 'Flip it or Rip it' })).toBeTruthy();
    expect(screen.getByRole('main')).toBeTruthy();
    expect(screen.getByRole('banner')).toBeTruthy();
    const firstFocusable = container.querySelector('a, button, input, summary');
    expect(firstFocusable?.textContent).toBe('Skip to lookup');
    expect(firstFocusable?.getAttribute('href')).toBe('#lookup-input');
    expect(sheet(container)?.classList.contains('sheet--resting')).toBe(true);
    const explainer = screen.getByRole('heading', { name: 'Scan or type an item' });
    expect(explainer.closest('.sheet--resting')).toBeTruthy();
    expect(document.title).toBe('Flip it or Rip it');
  });

  it('type → verdict expands the sheet, focuses its heading → Check another collapses it, resets and focuses the input', async () => {
    const { lookups } = mockApi(() => jsonResponse(flip));
    const { container, input } = renderApp();
    typeAndSubmit(input, '9780345391803');
    expect(lookups).toEqual([{ identifier: '9780345391803' }]);
    const h = await heading('Flip it');
    expect(sheet(container)?.classList.contains('sheet--expanded')).toBe(true);
    await waitFor(() => expect(document.activeElement).toBe(h));
    expect(screen.getByText(/^Estimated from current eBay asking prices/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Check another' }));
    expect(sheet(container)?.classList.contains('sheet--resting')).toBe(true);
    const freshInput = currentInput();
    expect(freshInput.value).toBe('');
    expect(document.activeElement).toBe(freshInput);
    expect(screen.getByRole('heading', { name: 'Scan or type an item' })).toBeTruthy();
  });

  it('S6: "Try the item name instead" collapses the sheet and focuses the emptied input', async () => {
    mockApi(() => jsonResponse(noMarket));
    const { container, input } = renderApp();
    typeAndSubmit(input, '9780000000002');
    await heading('Rip it');
    fireEvent.click(screen.getByRole('button', { name: 'Try the item name instead' }));
    expect(sheet(container)?.classList.contains('sheet--resting')).toBe(true);
    const freshInput = currentInput();
    expect(freshInput.value).toBe('');
    expect(document.activeElement).toBe(freshInput);
  });

  it('Escape returns the sheet to resting, clears the input and focuses it, without moving a settled result off screen', async () => {
    mockApi(() => jsonResponse(flip));
    const { container, input } = renderApp();
    await expandSheet(input, 'Chrono Trigger SNES');
    await heading('Flip it');
    fireEvent.keyDown(document, { key: 'Escape' });
    await waitFor(() => expect(sheet(container)?.classList.contains('sheet--resting')).toBe(true));
    const freshInput = currentInput();
    expect(freshInput.value).toBe('');
    expect(document.activeElement).toBe(freshInput);
    expect(screen.getByRole('heading', { name: 'Scan or type an item' })).toBeTruthy();
  });

  it('a result that resolves after dismissal is saved to history but does not re-expand the sheet or move focus', async () => {
    let resolve!: (r: Response) => void;
    mockApi(() => new Promise<Response>((r) => (resolve = r)));
    const { container, input } = renderApp();
    typeAndSubmit(input, 'Chrono Trigger SNES');
    await waitFor(() => expect(sheet(container)?.classList.contains('sheet--expanded')).toBe(true));
    fireEvent.keyDown(document, { key: 'Escape' });
    await waitFor(() => expect(sheet(container)?.classList.contains('sheet--resting')).toBe(true));
    const freshInput = currentInput();
    expect(document.activeElement).toBe(freshInput);
    resolve(jsonResponse(flip));
    await waitFor(() => expect(JSON.parse(localStorage.getItem('flip-or-rip:history:v1') ?? '[]')).toHaveLength(1));
    expect(sheet(container)?.classList.contains('sheet--resting')).toBe(true);
    expect(document.activeElement).toBe(freshInput);
  });

  it('the skip link collapses the sheet and focuses the input', async () => {
    mockApi(() => jsonResponse(flip));
    const { container, input } = renderApp();
    await expandSheet(input, 'Chrono Trigger SNES');
    await heading('Flip it');
    fireEvent.click(screen.getByText('Skip to lookup'));
    expect(sheet(container)?.classList.contains('sheet--resting')).toBe(true);
    expect(document.activeElement).toBe(currentInput());
  });
});

describe('App: settings and cost (US3, T030)', () => {
  it('a $25 minimum profit is sent as profitThresholdCents and persists', async () => {
    const { lookups } = mockApi(() => jsonResponse(flip));
    const { input } = renderApp();
    const settingsBtn = screen.getByRole('button', { name: 'Settings' });
    expect(settingsBtn.getAttribute('aria-haspopup')).toBe('dialog');
    fireEvent.click(settingsBtn);
    const field = screen.getByLabelText('Minimum profit to flip ($)') as HTMLInputElement;
    fireEvent.input(field, { target: { value: '25' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(document.activeElement).toBe(settingsBtn));
    expect(loadSettings()).toEqual({ profitThresholdCents: 2500 });
    expect(screen.getByText('$25.00')).toBeTruthy();

    typeAndSubmit(input, 'Chrono Trigger SNES');
    expect(lookups.at(-1)).toEqual({ title: 'Chrono Trigger SNES', profitThresholdCents: 2500 });
  });

  it('no threshold is sent when unset; the default is shown as the default', async () => {
    const { lookups } = mockApi(() => jsonResponse(flip));
    const { input } = renderApp();
    await waitFor(() => expect(screen.getByText('(default)', { exact: false })).toBeTruthy());
    typeAndSubmit(input, 'x');
    expect(lookups.at(-1)).toEqual({ title: 'x' });
  });

  it('the cost is sent for one lookup and never persisted', async () => {
    const { lookups } = mockApi(() => jsonResponse(flip));
    const { input } = renderApp();
    fireEvent.input(screen.getByLabelText('Amount paid ($)'), { target: { value: '8' } });
    typeAndSubmit(input, 'x');
    expect(lookups.at(-1)).toEqual({ title: 'x', costBasisCents: 800 });
    await heading('Flip it');
    expect(JSON.stringify(localStorage.getItem('flip-or-rip:settings:v1') ?? '')).not.toContain('800');
    fireEvent.click(screen.getByRole('button', { name: 'Check another' }));
    expect((screen.getByLabelText('Amount paid ($)') as HTMLInputElement).value).toBe('');
  });
});

describe('App: Recent (US4, T031)', () => {
  it('selecting a recent entry from the Recent sheet shows it without a lookup and focuses its heading', async () => {
    const { fetchMock } = mockApi((b) => jsonResponse(b.title === 'a' ? flip : rip));
    const { input } = renderApp();
    typeAndSubmit(input, 'a');
    await heading('Flip it');
    // Back to a live #lookup-input first: the lookup group only lives in the resting sheet, so a
    // second typed submission needs a fresh dismissal, not the (now detached) first `input`.
    fireEvent.click(screen.getByRole('button', { name: 'Check another' }));
    typeAndSubmit(currentInput(), 'b');
    await heading('Rip it');
    const lookupCalls = () => fetchMock.mock.calls.filter(([u]) => String(u) === '/api/lookup').length;
    expect(lookupCalls()).toBe(2);

    const recentButton = screen.getByRole('button', { name: 'Recent' });
    fireEvent.click(recentButton);
    const dialog = await screen.findByRole('dialog', { name: 'Recent' });
    const items = within(dialog).getAllByRole('listitem');
    expect(items[0]!.textContent).toContain('Rip it');
    fireEvent.click(items[1]!.querySelector('button')!);
    const h = await heading('Flip it');
    await waitFor(() => expect(document.activeElement).toBe(h));
    expect(screen.getByText(/Saved result, not refreshed\./)).toBeTruthy();
    expect(lookupCalls()).toBe(2);
    // The Recent sheet closed itself on selection.
    expect(screen.queryByRole('dialog', { name: 'Recent' })).toBeNull();
  });

  it('closing Recent without selecting returns focus to the chrome Recent button', async () => {
    mockApi(() => jsonResponse(flip));
    renderApp();
    const recentButton = screen.getByRole('button', { name: 'Recent' });
    fireEvent.click(recentButton);
    const dialog = await screen.findByRole('dialog', { name: 'Recent' });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Close' }));
    await waitFor(() => expect(document.activeElement).toBe(recentButton));
  });
});

describe('App: errors (US6, T034)', () => {
  it('S8 limit: heading focused, cap from meta, local reset time, a button that opens Recent, no retry', async () => {
    mockApi(() => jsonResponse({ error: 'limit-reached', message: 'x' }, 429));
    const { input } = renderApp();
    typeAndSubmit(input, 'Chrono Trigger SNES');
    const h = await heading("You've hit today's limit");
    await waitFor(() => expect(document.activeElement).toBe(h));
    expect(screen.getByText(/^This network has used all 50 free lookups for today\. They reset at .+\.$/)).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Try again' })).toBeNull();
    expect(input.value).toBe('Chrono Trigger SNES');

    fireEvent.click(screen.getByRole('button', { name: 'Your recent lookups are still here.' }));
    await screen.findByRole('dialog', { name: 'Recent' });
  });

  it('S8: closing Recent (opened from the error panel, not the chrome) returns focus to that button, not the chrome Recent button (contracts/sheet-states.md rule 10)', async () => {
    mockApi(() => jsonResponse({ error: 'limit-reached', message: 'x' }, 429));
    const { input } = renderApp();
    typeAndSubmit(input, 'Chrono Trigger SNES');
    await heading("You've hit today's limit");

    const chromeRecent = screen.getByRole('button', { name: 'Recent' });
    const opener = screen.getByRole('button', { name: 'Your recent lookups are still here.' });
    fireEvent.click(opener);
    const dialog = await screen.findByRole('dialog', { name: 'Recent' });
    // jsdom's <dialog> polyfill doesn't implement native Escape-to-cancel (RecentList.test.tsx
    // notes the same limitation; covered for real by e2e/errors.spec.ts) — Close exercises the
    // same `onClose` path a real Escape would.
    fireEvent.click(within(dialog).getByRole('button', { name: 'Close' }));
    await waitFor(() => expect(document.activeElement).toBe(opener));
    // Not the chrome button: opening from a *different* control must not fall back to it.
    expect(document.activeElement).not.toBe(chromeRecent);
  });

  it.each([
    [503, "eBay isn't answering", 'This usually clears up in a few seconds.'],
    [500, 'Something went wrong', "It's on our side, not yours."],
  ])('%d: heading focused, copy, Try again re-sends, input preserved', async (status, title, body) => {
    const { lookups } = mockApi(() => jsonResponse({ error: 'x', message: 'y' }, status));
    const { input } = renderApp();
    fireEvent.input(screen.getByLabelText('Amount paid ($)'), { target: { value: '3' } });
    typeAndSubmit(input, 'Chrono Trigger SNES');
    const h = await heading(title);
    await waitFor(() => expect(document.activeElement).toBe(h));
    expect(screen.getByText(body)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(lookups).toHaveLength(2);
    expect(lookups[1]).toEqual(lookups[0]);
    expect(input.value).toBe('Chrono Trigger SNES');
  });

  it('offline: heading focused, copy, input preserved', async () => {
    mockApi(() => {
      throw new TypeError('Failed to fetch');
    });
    const { input } = renderApp();
    typeAndSubmit(input, '9780345391803');
    const h = await heading("You're offline");
    await waitFor(() => expect(document.activeElement).toBe(h));
    expect(screen.getByText('Lookups need a connection. Your recent lookups are still available.')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Try again' })).toBeTruthy();
    expect(input.value).toBe('9780345391803');
  });

  it('S7 server validation: the sheet collapses so the inline error at the input is visible, announced, focused', async () => {
    mockApi(() => jsonResponse({ error: 'validation', message: 'Identifier is not a valid UPC/ISBN/EAN.' }, 400));
    const { container, input } = renderApp();
    typeAndSubmit(input, '12345678');
    // The lookup group only lives in the resting sheet (T032): a server validation error collapses
    // it back there so the error is visible next to the input (contracts/sheet-states.md S7).
    await waitFor(() => expect(sheet(container)?.classList.contains('sheet--resting')).toBe(true));
    const freshInput = currentInput();
    const msg = await screen.findByText('Identifier is not a valid UPC/ISBN/EAN.');
    expect(freshInput.getAttribute('aria-invalid')).toBe('true');
    expect(freshInput.getAttribute('aria-describedby')).toBe(msg.id);
    await waitFor(() => expect(document.activeElement).toBe(freshInput));
    await waitFor(() => expect(screen.getByRole('alert').textContent).toBe('Identifier is not a valid UPC/ISBN/EAN.'));
    expect(screen.getByRole('heading', { name: 'Scan or type an item' })).toBeTruthy();
  });
});

describe('App: S0 non-regression (T068, FR-024)', () => {
  it('the resting sheet has the exact S0 heading and body, both inside .sheet--resting', () => {
    mockApi(() => jsonResponse(flip));
    renderApp();
    const h = screen.getByRole('heading', { name: 'Scan or type an item' });
    expect(h.closest('.sheet--resting')).toBeTruthy();
    const body = screen.getByText("You'll get a verdict — flip it or rip it — with the numbers behind it.");
    expect(body.parentElement).toBe(h.parentElement);
    expect(body.closest('.sheet--resting')).toBeTruthy();
  });

  it('#result-heading: at most one always, none while loading, exactly one once a verdict lands', async () => {
    mockApi(() => new Promise<Response>(() => undefined));
    const { input } = renderApp();
    expect(document.querySelectorAll('#result-heading')).toHaveLength(1);
    typeAndSubmit(input, 'Chrono Trigger SNES');
    await waitFor(() => expect(document.querySelector('.result[aria-busy="true"]')).toBeTruthy());
    expect(document.querySelectorAll('#result-heading')).toHaveLength(0);
  });

  it('narrow loading: no heading and no Check button yet, so focus moves to the busy region itself, then relays to the heading once the verdict lands', async () => {
    let resolve!: (r: Response) => void;
    mockApi(() => new Promise<Response>((r) => (resolve = r)));
    const { input } = renderApp();
    typeAndSubmit(input, 'Chrono Trigger SNES');
    const busy = await waitFor(() => {
      const el = document.querySelector('.result[aria-busy="true"]');
      expect(el).toBeTruthy();
      return el as HTMLElement;
    });
    expect(screen.queryByRole('button', { name: 'Checking…' })).toBeNull();
    await waitFor(() => expect(document.activeElement).toBe(busy));
    resolve(jsonResponse(flip));
    const h = await heading('Flip it');
    await waitFor(() => expect(document.activeElement).toBe(h));
  });

  it('after a verdict is dismissed, the S0 heading and body are present again', async () => {
    mockApi(() => jsonResponse(flip));
    const { input } = renderApp();
    typeAndSubmit(input, 'Chrono Trigger SNES');
    await heading('Flip it');
    fireEvent.click(screen.getByRole('button', { name: 'Check another' }));
    expect(screen.getByRole('heading', { name: 'Scan or type an item' })).toBeTruthy();
    expect(screen.getByText("You'll get a verdict — flip it or rip it — with the numbers behind it.")).toBeTruthy();
  });

  it('the document title is the plain app name in the resting state', () => {
    mockApi(() => jsonResponse(flip));
    renderApp();
    expect(document.title).toBe('Flip it or Rip it');
  });
});

describe('App: no camera', () => {
  it('renders no Scan button without getUserMedia', () => {
    mockApi(() => jsonResponse(flip));
    renderApp();
    expect(screen.queryByRole('button', { name: 'Scan' })).toBeNull();
  });
});

describe('App: desktop (≥ 1024 px, FR-027, contracts/sheet-states.md desktop rules)', () => {
  function stubDesktop() {
    vi.stubGlobal(
      'matchMedia',
      vi.fn((query: string) => ({
        matches: query === '(min-width: 1024px)',
        media: query,
        addEventListener: () => undefined,
        removeEventListener: () => undefined,
      })),
    );
  }

  it('renders .col-lookup and .col-recent, an always-expanded pane sheet with no grabber, and one #result-heading', async () => {
    stubDesktop();
    mockApi(() => jsonResponse(flip));
    const { container } = renderApp();
    expect(container.querySelector('.col-lookup')).toBeTruthy();
    expect(container.querySelector('.col-recent')).toBeTruthy();
    const s = sheet(container)!;
    expect(s.classList.contains('sheet--expanded')).toBe(true);
    expect(s.classList.contains('sheet--pane')).toBe(true);
    expect(s.querySelector('.sheet__grabber')).toBeNull();
    expect(s.querySelector('section.result')).toBeTruthy();
    expect(document.querySelectorAll('#result-heading')).toHaveLength(1);
    expect(container.querySelector('.sheet--resting')).toBeNull();
  });

  it('"Check another" resets the middle pane back to the S0 explainer', async () => {
    stubDesktop();
    mockApi(() => jsonResponse(flip));
    const { input } = renderApp();
    typeAndSubmit(input, 'Chrono Trigger SNES');
    await heading('Flip it');
    fireEvent.click(screen.getByRole('button', { name: 'Check another' }));
    await screen.findByRole('heading', { name: 'Scan or type an item' });
    expect(document.querySelectorAll('#result-heading')).toHaveLength(1);
  });
});
