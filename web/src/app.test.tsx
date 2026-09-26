import { fireEvent, screen, waitFor, within } from '@testing-library/preact';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { loadSettings } from './lib/storage';
import { mockApi, renderApp, typeAndSubmit } from './test/app-harness';
import { flip, jsonResponse, noMarket, rip } from './test/fixtures';

afterEach(() => vi.unstubAllGlobals());

const heading = (name: string) => screen.findByRole('heading', { level: 2, name });

describe('App: core loop (US1, US5)', () => {
  it('renders landmarks, the h1, a skip link first, and the empty state', () => {
    mockApi(() => jsonResponse(flip));
    const { container } = renderApp();
    expect(screen.getByRole('heading', { level: 1, name: 'Flip it or Rip it' })).toBeTruthy();
    expect(screen.getByRole('main')).toBeTruthy();
    expect(screen.getByRole('banner')).toBeTruthy();
    const firstFocusable = container.querySelector('a, button, input, summary');
    expect(firstFocusable?.textContent).toBe('Skip to lookup');
    expect(firstFocusable?.getAttribute('href')).toBe('#lookup-input');
    expect(screen.getByRole('heading', { name: 'Scan or type an item' })).toBeTruthy();
  });

  it('type → verdict with focus on its heading → Check another empties and focuses the input', async () => {
    const { lookups } = mockApi(() => jsonResponse(flip));
    const { input } = renderApp();
    typeAndSubmit(input, '9780345391803');
    expect(lookups).toEqual([{ identifier: '9780345391803' }]);
    const h = await heading('Flip it');
    await waitFor(() => expect(document.activeElement).toBe(h));
    expect(screen.getByText(/^Estimated from current eBay asking prices/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Check another' }));
    expect(input.value).toBe('');
    expect(document.activeElement).toBe(input);
  });

  it('S6: "Try the item name instead" focuses the emptied input', async () => {
    mockApi(() => jsonResponse(noMarket));
    const { input } = renderApp();
    typeAndSubmit(input, '9780000000002');
    await heading('Rip it');
    fireEvent.click(screen.getByRole('button', { name: 'Try the item name instead' }));
    expect(input.value).toBe('');
    expect(document.activeElement).toBe(input);
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
  it('selecting a recent entry shows it without a lookup and focuses its heading', async () => {
    const { fetchMock } = mockApi((b) => jsonResponse(b.title === 'a' ? flip : rip));
    const { input } = renderApp();
    typeAndSubmit(input, 'a');
    await heading('Flip it');
    typeAndSubmit(input, 'b');
    await heading('Rip it');
    const lookupCalls = () => fetchMock.mock.calls.filter(([u]) => String(u) === '/api/lookup').length;
    expect(lookupCalls()).toBe(2);

    const items = within(document.getElementById('recent')!).getAllByRole('listitem');
    expect(items[0]!.textContent).toContain('Rip it');
    fireEvent.click(items[1]!.querySelector('button')!);
    const h = await heading('Flip it');
    await waitFor(() => expect(document.activeElement).toBe(h));
    expect(screen.getByText(/Saved result, not refreshed\./)).toBeTruthy();
    expect(lookupCalls()).toBe(2);
  });
});

describe('App: errors (US6, T034)', () => {
  it('S8 limit: heading focused, cap from meta, local reset time, link to Recent, no retry', async () => {
    mockApi(() => jsonResponse({ error: 'limit-reached', message: 'x' }, 429));
    const { input } = renderApp();
    typeAndSubmit(input, 'Chrono Trigger SNES');
    const h = await heading("You've hit today's limit");
    await waitFor(() => expect(document.activeElement).toBe(h));
    expect(screen.getByText(/^This network has used all 50 free lookups for today\. They reset at .+\.$/)).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Your recent lookups are still here.' }).getAttribute('href')).toBe('#recent');
    expect(screen.queryByRole('button', { name: 'Try again' })).toBeNull();
    expect(input.value).toBe('Chrono Trigger SNES');
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

  it('S7 server validation: inline at the input, announced, focused; result area unchanged', async () => {
    mockApi(() => jsonResponse({ error: 'validation', message: 'Identifier is not a valid UPC/ISBN/EAN.' }, 400));
    const { input } = renderApp();
    typeAndSubmit(input, '12345678');
    const msg = await screen.findByText('Identifier is not a valid UPC/ISBN/EAN.');
    expect(input.getAttribute('aria-invalid')).toBe('true');
    expect(input.getAttribute('aria-describedby')).toBe(msg.id);
    await waitFor(() => expect(document.activeElement).toBe(input));
    await waitFor(() => expect(screen.getByRole('alert').textContent).toBe('Identifier is not a valid UPC/ISBN/EAN.'));
    expect(screen.getByRole('heading', { name: 'Scan or type an item' })).toBeTruthy();
    expect(input.value).toBe('12345678');
  });
});

describe('App: no camera', () => {
  it('renders no Scan button without getUserMedia', () => {
    mockApi(() => jsonResponse(flip));
    renderApp();
    expect(screen.queryByRole('button', { name: 'Scan' })).toBeNull();
  });
});
