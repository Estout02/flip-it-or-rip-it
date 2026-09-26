import { fireEvent, render, screen, waitFor } from '@testing-library/preact';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const startScan = vi.fn<(video: HTMLVideoElement, onCode: (c: string) => void, signal: AbortSignal) => Promise<void>>();

vi.mock('./detect', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./detect')>();
  return { ...actual, startScan: (...args: Parameters<typeof startScan>) => startScan(...args) };
});

const { Scanner } = await import('./scanner');
const { ScanError } = await import('./detect');

function setup() {
  const props = { onCode: vi.fn(), onCancel: vi.fn(), onTypeInstead: vi.fn() };
  render(<Scanner {...props} />);
  const dialog = document.querySelector('dialog')!;
  return { props, dialog };
}

beforeEach(() => {
  startScan.mockReset();
  startScan.mockImplementation(() => new Promise(() => undefined));
  history.replaceState(null, '');
});

describe('Scanner', () => {
  it('opens as a modal with the prompt, a hidden video and Cancel focused first', async () => {
    const { dialog } = setup();
    await waitFor(() => expect(dialog.open).toBe(true));
    expect(screen.getByRole('dialog', { name: 'Point at a barcode' })).toBe(dialog);
    const video = dialog.querySelector('video')!;
    expect(video.getAttribute('aria-hidden')).toBe('true');
    expect(video.muted).toBe(true);
    expect(dialog.querySelector('.scanner__frame')).toBeTruthy();
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Cancel' }));
    expect(history.state).toEqual({ flipScanner: true });
  });

  it('Cancel stops the camera and reports a cancel', async () => {
    const { props, dialog } = setup();
    const signal = startScan.mock.calls[0]![2];
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    await waitFor(() => expect(props.onCancel).toHaveBeenCalled());
    expect(dialog.open).toBe(false);
    expect(signal.aborted).toBe(true);
    expect(props.onCode).not.toHaveBeenCalled();
  });

  it('a detected code closes the dialog and reports it', async () => {
    const { props, dialog } = setup();
    const onCode = startScan.mock.calls[0]![1];
    onCode('9780345391803');
    await waitFor(() => expect(props.onCode).toHaveBeenCalledWith('9780345391803'));
    expect(dialog.open).toBe(false);
  });

  it('closes when the page is hidden (FR-009)', async () => {
    const { props } = setup();
    const spy = vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('hidden');
    document.dispatchEvent(new Event('visibilitychange'));
    await waitFor(() => expect(props.onCancel).toHaveBeenCalled());
    spy.mockRestore();
  });

  it('closes on the back gesture (popstate)', async () => {
    const { props } = setup();
    window.dispatchEvent(new PopStateEvent('popstate', { state: null }));
    await waitFor(() => expect(props.onCancel).toHaveBeenCalled());
  });

  it.each([
    ['denied', 'Camera access was blocked. You can allow it in your browser settings, or type the number under the barcode.'],
    ['unsupported', "This browser can't scan barcodes. Type the number under the barcode instead."],
    ['no-camera', 'No camera was found. Type the number under the barcode instead.'],
  ] as const)('%s → explanation, and "Type it instead" returns to the input', async (reason, body) => {
    startScan.mockRejectedValue(new ScanError(reason));
    const { props } = setup();
    const typeBtn = await screen.findByRole('button', { name: 'Type it instead' });
    expect(screen.getByRole('heading', { name: 'Camera not available' })).toBeTruthy();
    expect(screen.getByText(body)).toBeTruthy();
    await waitFor(() => expect(document.activeElement).toBe(typeBtn));
    fireEvent.click(typeBtn);
    await waitFor(() => expect(props.onTypeInstead).toHaveBeenCalled());
    expect(props.onCancel).not.toHaveBeenCalled();
  });
});
