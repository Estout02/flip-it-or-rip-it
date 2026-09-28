// T035: the viewfinder module is imported only on the first Scan click; a read fills the input,
// announces, vibrates and submits. The camera is the ground itself, not a modal (FR-011): it
// stays mounted through a decode, and is released only by the four triggers in FR-011.
import { fireEvent, screen, waitFor } from '@testing-library/preact';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { mockApi, renderApp } from './test/app-harness';
import { flip, jsonResponse, uncertain } from './test/fixtures';

const viewfinderModule = vi.hoisted(() => ({ loads: 0, lastProps: null as null | Record<string, (v?: unknown) => void> }));

vi.mock('./scanner/viewfinder', () => {
  viewfinderModule.loads++;
  const Viewfinder = (props: Record<string, (v?: unknown) => void>) => {
    viewfinderModule.lastProps = props;
    return <div data-fake-viewfinder />;
  };
  return { Viewfinder, default: Viewfinder };
});

const vibrate = vi.fn();

beforeAll(() => {
  Object.defineProperty(navigator, 'mediaDevices', { value: { getUserMedia: vi.fn() }, configurable: true });
  Object.defineProperty(navigator, 'vibrate', { value: vibrate, configurable: true });
});
afterAll(() => {
  Object.defineProperty(navigator, 'mediaDevices', { value: undefined, configurable: true });
});

describe('App: lazy viewfinder', () => {
  it('does not import the viewfinder until Scan is clicked, and mounts no camera ground before that', async () => {
    const { lookups } = mockApi(() => jsonResponse(flip));
    renderApp();
    expect(document.querySelector('[data-fake-viewfinder]')).toBeNull();
    expect(viewfinderModule.loads).toBe(0);
    const scan = screen.getByRole('button', { name: 'Scan' });

    fireEvent.click(scan);
    await waitFor(() => expect(document.querySelector('[data-fake-viewfinder]')).toBeTruthy());
    expect(viewfinderModule.loads).toBe(1);

    viewfinderModule.lastProps!.onCode!('9780345391803');
    // The read submits synchronously and the sheet expands, detaching this `input` node (the
    // lookup group only lives in the resting sheet) before its value would ever repaint — the
    // captured request is the authoritative record of what was scanned.
    await waitFor(() => expect(lookups).toEqual([{ identifier: '9780345391803' }]));
    expect(vibrate).toHaveBeenCalledWith(50);
    await waitFor(() => expect(screen.getByRole('status').textContent).toBe('Scanned 9780345391803. Checking…'));
    // FR-011: the viewfinder stays mounted after a decode — only the four release triggers unmount it.
    expect(document.querySelector('[data-fake-viewfinder]')).toBeTruthy();
  });

  it('the chrome Cancel button releases the camera; focusing the input also releases it (leaving the flow)', async () => {
    mockApi(() => jsonResponse(flip));
    const { input } = renderApp();
    fireEvent.click(screen.getByRole('button', { name: 'Scan' }));
    await waitFor(() => expect(document.querySelector('[data-fake-viewfinder]')).toBeTruthy());
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    await waitFor(() => expect(document.querySelector('[data-fake-viewfinder]')).toBeNull());

    fireEvent.click(screen.getByRole('button', { name: 'Scan' }));
    await waitFor(() => expect(document.querySelector('[data-fake-viewfinder]')).toBeTruthy());
    // jsdom's fireEvent.focusIn doesn't dispatch (a jsdom limitation, not a real-browser one);
    // a real .focus() call does, and is what the app actually listens for.
    input.focus();
    await waitFor(() => expect(document.querySelector('[data-fake-viewfinder]')).toBeNull());
  });

  it("onFailure('denied') renders the 'Camera not available' notice in the resting sheet with 'Type it instead' focused, and clicking it focuses the input", async () => {
    mockApi(() => jsonResponse(flip));
    const { input } = renderApp();
    fireEvent.click(screen.getByRole('button', { name: 'Scan' }));
    await waitFor(() => expect(document.querySelector('[data-fake-viewfinder]')).toBeTruthy());
    viewfinderModule.lastProps!.onFailure!('denied');
    const heading = await screen.findByRole('heading', { name: 'Camera not available' });
    expect(heading.textContent).toBe('Camera not available');
    const typeInstead = screen.getByRole('button', { name: 'Type it instead' });
    await waitFor(() => expect(document.activeElement).toBe(typeInstead));
    fireEvent.click(typeInstead);
    await waitFor(() => expect(document.activeElement).toBe(input));
  });

  it('one Scan tap decodes two distinct barcodes in a row, at narrow width, both starting a lookup (SC-003)', async () => {
    // Regression for 04edc01: onCode used to submit via `formRef.current?.submit(code)`, but
    // <LookupForm> only lives in the resting sheet at narrow widths (T032) — once the first
    // code's result is showing, the sheet is expanded, the form is unmounted, and that call
    // silently no-ops. A second decode must not depend on the form being mounted.
    const { lookups } = mockApi((b) => jsonResponse(b.identifier === '9780345391803' ? flip : uncertain));
    renderApp();
    fireEvent.click(screen.getByRole('button', { name: 'Scan' }));
    await waitFor(() => expect(document.querySelector('[data-fake-viewfinder]')).toBeTruthy());

    viewfinderModule.lastProps!.onCode!('9780345391803');
    await screen.findByRole('heading', { level: 2, name: 'Flip it' });
    expect(lookups).toEqual([{ identifier: '9780345391803' }]);

    // The camera stays live behind the open result sheet (FR-011): a second, different code
    // decodes without any dismissal and must start its own lookup.
    viewfinderModule.lastProps!.onCode!('0012345678905');
    await waitFor(() => expect(lookups).toEqual([{ identifier: '9780345391803' }, { identifier: '0012345678905' }]));
    await screen.findByRole('heading', { level: 2, name: "Can't tell" });
  });

  it("UNCERTAIN's scan suggestion starts the camera", async () => {
    mockApi(() => jsonResponse(uncertain));
    const { input } = renderApp();
    fireEvent.input(input, { target: { value: 'Chrono Trigger' } });
    fireEvent.submit(input.form!);
    fireEvent.click(await screen.findByRole('button', { name: 'Scan the barcode if it has one' }));
    await waitFor(() => expect(document.querySelector('[data-fake-viewfinder]')).toBeTruthy());
  });
});
