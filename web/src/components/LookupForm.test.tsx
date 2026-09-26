import { fireEvent, render, screen, waitFor } from '@testing-library/preact';
import { createRef } from 'preact';
import { describe, expect, it, vi } from 'vitest';
import { LiveRegion } from './LiveRegion';
import { LookupForm, type LookupFormHandle } from './LookupForm';

function setup(extra: Partial<Parameters<typeof LookupForm>[0]> = {}) {
  const onSubmit = vi.fn();
  const onFieldEdit = vi.fn();
  const handle = createRef<LookupFormHandle>();
  const utils = render(
    <>
      <LiveRegion />
      <LookupForm handle={handle} loading={false} serverError={null} onSubmit={onSubmit} onFieldEdit={onFieldEdit} {...extra} />
    </>,
  );
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
  });

  it('handle: setValue, clear (also clears cost) and focusInput', () => {
    const { input, handle } = setup();
    handle.current!.setValue('9780345391803');
    return waitFor(() => expect(input.value).toBe('9780345391803')).then(async () => {
      const cost = screen.getByLabelText('Amount paid ($)') as HTMLInputElement;
      type(cost, '5');
      handle.current!.clear();
      await waitFor(() => expect(input.value).toBe(''));
      expect(cost.value).toBe('');
      expect(document.activeElement).toBe(input);
    });
  });
});
