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

  it('"Scan the next one" keeps the camera ground mounted and focused on Cancel, not the input, so a second decode still starts its own lookup (SC-003 regression)', async () => {
    // Regression: the resting sheet's <LookupForm> only remounts once the camera ground goes
    // back to rest after a first result — and its `autoFocus` effect used to fire unconditionally
    // whenever `everExpanded` was true, stealing focus from the chrome Cancel button AND, via the
    // FR-011 focusin release trigger, releasing the live camera outright. A code decoded after
    // that point never reached onCode again.
    const { lookups } = mockApi((b) => jsonResponse(b.identifier === '9780345391803' ? flip : uncertain));
    renderApp();
    fireEvent.click(screen.getByRole('button', { name: 'Scan' }));
    await waitFor(() => expect(document.querySelector('[data-fake-viewfinder]')).toBeTruthy());

    viewfinderModule.lastProps!.onCode!('9780345391803');
    await screen.findByRole('heading', { level: 2, name: 'Flip it' });
    expect(lookups).toEqual([{ identifier: '9780345391803' }]);

    fireEvent.click(screen.getByRole('button', { name: 'Scan the next one' }));

    // The camera ground must still be live and the Cancel button focused, not the lookup input.
    expect(document.querySelector('[data-fake-viewfinder]')).toBeTruthy();
    expect(viewfinderModule.loads).toBe(1); // no re-import/remount of the viewfinder chunk
    await waitFor(() => expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Cancel' })));

    // A second, different code must still start its own lookup.
    viewfinderModule.lastProps!.onCode!('0012345678905');
    await waitFor(() => expect(lookups).toEqual([{ identifier: '9780345391803' }, { identifier: '0012345678905' }]));
    await screen.findByRole('heading', { level: 2, name: "Can't tell" });
  });

  it('"Check another" on a live camera result always releases the camera, clears the input and focuses it (contracts/copy-additions.md §3)', async () => {
    // B1 regression: the secondary "Check another" control next to "Scan the next one" used to
    // delegate to the Escape/back-gesture `dismiss`, which keeps a live camera scanning — so the
    // "boring, always-available" escape silently behaved like the camera-only primary instead.
    mockApi(() => jsonResponse(flip));
    renderApp();
    fireEvent.click(screen.getByRole('button', { name: 'Scan' }));
    await waitFor(() => expect(document.querySelector('[data-fake-viewfinder]')).toBeTruthy());

    viewfinderModule.lastProps!.onCode!('9780345391803');
    await screen.findByRole('heading', { level: 2, name: 'Flip it' });

    fireEvent.click(screen.getByRole('button', { name: 'Check another' }));

    await waitFor(() => expect(document.querySelector('[data-fake-viewfinder]')).toBeNull());
    expect(screen.queryByRole('button', { name: 'Cancel' })).toBeNull();
    const freshInput = screen.getByLabelText('Barcode or item name') as HTMLInputElement;
    expect(freshInput.value).toBe('');
    expect(document.activeElement).toBe(freshInput);
    expect(screen.getByRole('heading', { name: 'Scan or type an item' })).toBeTruthy();
  });

  it('chrome Cancel focuses the Scan button when resting, and the result region when a result is showing (B2: never document.body)', async () => {
    mockApi(() => jsonResponse(flip));
    renderApp();
    const scan = screen.getByRole('button', { name: 'Scan' });
    fireEvent.click(scan);
    await waitFor(() => expect(document.querySelector('[data-fake-viewfinder]')).toBeTruthy());
    // Let the "entering camera" effect (which focuses Cancel) settle before acting, so this test's
    // own click isn't racing that still-pending effect for an unrelated reason.
    await waitFor(() => expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Cancel' })));

    // Resting: cancelling before any decode returns focus to Scan, not document.body.
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    await waitFor(() => expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Scan' })));
    expect(document.activeElement).not.toBe(document.body);

    // Expanded: cancelling with a result showing (the "Scan the next one" case) moves focus to
    // the result region, not document.body.
    fireEvent.click(screen.getByRole('button', { name: 'Scan' }));
    await waitFor(() => expect(document.querySelector('[data-fake-viewfinder]')).toBeTruthy());
    await waitFor(() => expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Cancel' })));
    viewfinderModule.lastProps!.onCode!('9780345391803');
    await screen.findByRole('heading', { level: 2, name: 'Flip it' });
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    await waitFor(() => expect(document.activeElement?.closest('.result')).toBeTruthy());
    expect(document.activeElement).not.toBe(document.body);
  });

  it('Escape while the camera is live focuses the chrome Cancel button, not the input (dismiss stays camera-aware)', async () => {
    mockApi(() => jsonResponse(flip));
    renderApp();
    fireEvent.click(screen.getByRole('button', { name: 'Scan' }));
    await waitFor(() => expect(document.querySelector('[data-fake-viewfinder]')).toBeTruthy());

    viewfinderModule.lastProps!.onCode!('9780345391803');
    await screen.findByRole('heading', { level: 2, name: 'Flip it' });

    fireEvent.keyDown(document, { key: 'Escape' });

    // Dismissal via Escape (unlike "Check another") keeps the camera live and resumes decoding.
    await waitFor(() => expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Cancel' })));
    expect(document.querySelector('[data-fake-viewfinder]')).toBeTruthy();
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
