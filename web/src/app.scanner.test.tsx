// T027: the scanner module is imported only on the first Scan click; a read fills the input,
// announces, vibrates and submits.
import { fireEvent, screen, waitFor } from '@testing-library/preact';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { mockApi, renderApp } from './test/app-harness';
import { flip, jsonResponse, uncertain } from './test/fixtures';

const scannerModule = vi.hoisted(() => ({ loads: 0, lastProps: null as null | Record<string, (v?: string) => void> }));

vi.mock('./scanner/scanner', () => {
  scannerModule.loads++;
  const Scanner = (props: Record<string, (v?: string) => void>) => {
    scannerModule.lastProps = props;
    return <div data-fake-scanner />;
  };
  return { Scanner, default: Scanner };
});

const vibrate = vi.fn();

beforeAll(() => {
  Object.defineProperty(navigator, 'mediaDevices', { value: { getUserMedia: vi.fn() }, configurable: true });
  Object.defineProperty(navigator, 'vibrate', { value: vibrate, configurable: true });
});
afterAll(() => {
  Object.defineProperty(navigator, 'mediaDevices', { value: undefined, configurable: true });
});

describe('App: lazy scanner', () => {
  it('does not import the scanner until Scan is clicked', async () => {
    const { lookups } = mockApi(() => jsonResponse(flip));
    const { input } = renderApp();
    const scan = screen.getByRole('button', { name: 'Scan' });
    expect(scan.classList.contains('scan-dock')).toBe(true);
    expect(scannerModule.loads).toBe(0);

    fireEvent.click(scan);
    await waitFor(() => expect(document.querySelector('[data-fake-scanner]')).toBeTruthy());
    expect(scannerModule.loads).toBe(1);

    scannerModule.lastProps!.onCode!('9780345391803');
    await waitFor(() => expect(input.value).toBe('9780345391803'));
    expect(vibrate).toHaveBeenCalledWith(50);
    expect(lookups).toEqual([{ identifier: '9780345391803' }]);
    await waitFor(() => expect(screen.getByRole('status').textContent).toBe('Scanned 9780345391803. Checking…'));
    expect(document.querySelector('[data-fake-scanner]')).toBeNull();
  });

  it('cancel returns focus to Scan; "Type it instead" focuses the input', async () => {
    mockApi(() => jsonResponse(flip));
    const { input } = renderApp();
    const scan = screen.getByRole('button', { name: 'Scan' });
    fireEvent.click(scan);
    await waitFor(() => expect(document.querySelector('[data-fake-scanner]')).toBeTruthy());
    scannerModule.lastProps!.onCancel!();
    await waitFor(() => expect(document.activeElement).toBe(scan));
    fireEvent.click(scan);
    await waitFor(() => expect(document.querySelector('[data-fake-scanner]')).toBeTruthy());
    scannerModule.lastProps!.onTypeInstead!();
    await waitFor(() => expect(document.activeElement).toBe(input));
  });

  it("UNCERTAIN's scan suggestion opens the scanner", async () => {
    mockApi(() => jsonResponse(uncertain));
    const { input } = renderApp();
    fireEvent.input(input, { target: { value: 'Chrono Trigger' } });
    fireEvent.submit(input.form!);
    fireEvent.click(await screen.findByRole('button', { name: 'Scan the barcode if it has one' }));
    await waitFor(() => expect(document.querySelector('[data-fake-scanner]')).toBeTruthy());
  });
});
