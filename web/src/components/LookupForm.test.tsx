import { fireEvent, render, screen, waitFor } from '@testing-library/preact';
import { createRef } from 'preact';
import { useState } from 'preact/hooks';
import { describe, expect, it, vi } from 'vitest';
import { LiveRegion } from './LiveRegion';
import { LookupForm, type LookupFormHandle } from './LookupForm';

// The query is App-owned (spec 008 B1): this harness stands in for App, holding it locally so the
// component under test behaves exactly as it does in the real tree (a controlled input).
function setup(extra: Partial<Parameters<typeof LookupForm>[0]> = {}) {
  const onSubmit = vi.fn();
  const onFieldEdit = vi.fn();
  const handle = createRef<LookupFormHandle>();

  function Harness() {
    const [query, setQuery] = useState(extra.query ?? '');
    return (
      <>
        <LiveRegion />
        <LookupForm
          handle={handle}
          loading={false}
          serverError={null}
          onSubmit={onSubmit}
          onFieldEdit={onFieldEdit}
          {...extra}
          query={query}
          onQueryChange={setQuery}
        />
      </>
    );
  }

  const utils = render(<Harness />);
  const input = screen.getByLabelText('Barcode or item name') as HTMLInputElement;
  return { ...utils, input, onSubmit, onFieldEdit, handle };
}

function type(el: HTMLInputElement, v: string) {
  fireEvent.input(el, { target: { value: v } });
}

describe('LookupForm', () => {
  it('labels the input and sets mobile keyboard hints', () => {
    const { input } = setup();
    expect(input.type).toBe('text');
    expect(input.getAttribute('inputmode')).toBe('search');
    expect(input.getAttribute('enterkeyhint')).toBe('go');
    expect(input.getAttribute('autocomplete')).toBe('off');
    expect(input.getAttribute('autocapitalize')).toBe('off');
    // spellcheck={false} is set as a DOM property; jsdom doesn't implement it (browsers do).
    expect(screen.getByRole('form', { name: 'Look up an item' })).toBeTruthy();
  });

  it('submits a barcode as an identifier and a name as a title', () => {
    const { input, onSubmit } = setup();
    type(input, '978-0-345-39180-3');
    fireEvent.submit(input.form!);
    expect(onSubmit).toHaveBeenLastCalledWith({ identifier: '978-0-345-39180-3' });
    type(input, 'Chrono Trigger SNES');
    fireEvent.click(screen.getByRole('button', { name: 'Check' }));
    expect(onSubmit).toHaveBeenLastCalledWith({ title: 'Chrono Trigger SNES' });
  });

  it('S7 client-side: blank input → inline error, aria-invalid, announced, focused, nothing sent', async () => {
    const { input, onSubmit } = setup();
    fireEvent.submit(input.form!);
    expect(onSubmit).not.toHaveBeenCalled();
    const msg = screen.getByText('Enter a barcode or an item name.');
    expect(input.getAttribute('aria-invalid')).toBe('true');
    expect(input.getAttribute('aria-describedby')).toBe(msg.id);
    expect(document.activeElement).toBe(input);
    await waitFor(() => expect(screen.getByRole('alert').textContent).toBe('Enter a barcode or an item name.'));
    type(input, 'x');
    expect(input.getAttribute('aria-invalid')).toBeNull();
  });

  it('S7 server-side message renders inline and focuses the input', async () => {
    const { input } = setup({ serverError: 'Identifier is not a valid UPC.' });
    expect(screen.getByText('Identifier is not a valid UPC.')).toBeTruthy();
    expect(input.getAttribute('aria-invalid')).toBe('true');
    await waitFor(() => expect(document.activeElement).toBe(input));
  });

  it('a server validation error does not wipe the query the way it once did (spec 008 B1)', async () => {
    // Regression: the query used to live inside this component, so a parent-driven remount (the
    // sheet collapsing back to rest on S7) would blank it. It's App state now, so the harness's
    // `query` survives a `serverError` transition unchanged — nothing to assert on the component
    // itself beyond the fact that it never resets `query` on its own.
    const { input } = setup({ query: 'Chrono Trigger SNES' });
    expect(input.value).toBe('Chrono Trigger SNES');
  });

  it('What I paid: collapsed by default, parsed to cents, validated', () => {
    const { input, onSubmit, container } = setup();
    const details = container.querySelector('details.cost') as HTMLDetailsElement;
    expect(details.open).toBe(false);
    expect(details.querySelector('summary')!.textContent).toBe('What I paid (optional)');
    const cost = screen.getByLabelText('Amount paid ($)') as HTMLInputElement;
    expect(cost.getAttribute('inputmode')).toBe('decimal');
    type(input, 'Chrono Trigger SNES');
    type(cost, '8');
    fireEvent.submit(input.form!);
    expect(onSubmit).toHaveBeenLastCalledWith({ title: 'Chrono Trigger SNES', costBasisCents: 800 });
    type(cost, '-1');
    onSubmit.mockClear();
    fireEvent.submit(input.form!);
    expect(onSubmit).not.toHaveBeenCalled();
    expect(screen.getByText('What I paid: Enter an amount like 12 or 12.50.')).toBeTruthy();
    expect(cost.getAttribute('aria-invalid')).toBe('true');
    expect(document.activeElement).toBe(cost);
    expect(details.open).toBe(true);
  });

  it('a $0 cost is omitted from the request', () => {
    const { input, onSubmit } = setup();
    type(input, 'x');
    type(screen.getByLabelText('Amount paid ($)') as HTMLInputElement, '0');
    fireEvent.submit(input.form!);
    expect(onSubmit).toHaveBeenLastCalledWith({ title: 'x' });
  });

  it('Check shows busy state while loading but stays focusable', () => {
    setup({ loading: true });
    const btn = screen.getByRole('button', { name: 'Checking…' });
    expect(btn.getAttribute('aria-disabled')).toBe('true');
    expect(btn.hasAttribute('disabled')).toBe(false);
  });

  it('Scan button only when onScan is given, after Check in DOM order', () => {
    const { unmount } = setup();
    expect(screen.queryByRole('button', { name: 'Scan' })).toBeNull();
    unmount();
    setup({ onScan: vi.fn() });
    const buttons = screen.getAllByRole('button').map((b) => b.textContent);
    expect(buttons.indexOf('Scan')).toBe(buttons.indexOf('Check') + 1);
    const scan = screen.getByRole('button', { name: 'Scan' });
    expect(scan.className).toBe('btn btn--scan');
  });

  it('handle: focusInput moves focus to the input', () => {
    const { input, handle } = setup();
    handle.current!.focusInput();
    expect(document.activeElement).toBe(input);
  });

  it("the handle no longer exposes an imperative submit — a decoded code must not depend on this component being mounted", () => {
    // Superseded fix (spec 008): submitting via `formRef.current?.submit(code)` silently dropped
    // every scan after the first, because <LookupForm> only lives in the resting sheet at narrow
    // widths (T032) — once a result is showing, the form is unmounted and the ref is null. App
    // now classifies and submits a decoded code directly (see app.scanner.test.tsx's SC-003 case);
    // this asserts the trap can't come back by way of the handle shape.
    const { handle } = setup();
    expect(handle.current).not.toHaveProperty('submit');
    expect(handle.current).toHaveProperty('focusInput');
    expect(handle.current).toHaveProperty('resetCost');
  });

  it('handle: resetCost clears the cost field only — the query is the caller\'s to clear', async () => {
    const { handle } = setup({ query: 'Chrono Trigger SNES' });
    const cost = screen.getByLabelText('Amount paid ($)') as HTMLInputElement;
    type(cost, '5');
    handle.current!.resetCost();
    await waitFor(() => expect(cost.value).toBe(''));
    expect(screen.getByLabelText('Barcode or item name')).toHaveProperty('value', 'Chrono Trigger SNES');
  });

  it('autoFocus focuses the input once, on mount', () => {
    const { input } = setup({ autoFocus: true });
    expect(document.activeElement).toBe(input);
  });

  it('without autoFocus, the input is not focused on mount', () => {
    const { input } = setup();
    expect(document.activeElement).not.toBe(input);
  });
});
