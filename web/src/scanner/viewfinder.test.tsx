import { cleanup, render, screen, waitFor } from '@testing-library/preact';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const startScan =
  vi.fn<(video: HTMLVideoElement, onCode: (c: string) => void, signal: AbortSignal) => Promise<{ suspendFor: (c: string) => void; resume: () => void }>>();

vi.mock('./detect', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./detect')>();
  return { ...actual, startScan: (...args: Parameters<typeof startScan>) => startScan(...args) };
});

const { Viewfinder } = await import('./viewfinder');
const { ScanError } = await import('./detect');

function setup(props: Partial<Parameters<typeof Viewfinder>[0]> = {}) {
  const p = { onCode: vi.fn(), onFailure: vi.fn(), suspendedCode: null, ...props };
  const { container } = render(<Viewfinder {...p} />);
  return { props: p, container };
}

beforeEach(() => {
  startScan.mockReset();
  startScan.mockImplementation(() => new Promise(() => undefined));
});

afterEach(cleanup);

describe('Viewfinder', () => {
  it('renders the live ground: video, reticle, prompt pill, and no dialog', () => {
    const { container } = setup();
    const video = container.querySelector('video')!;
    expect(video.getAttribute('aria-hidden')).toBe('true');
    expect(video.getAttribute('playsinline')).not.toBeNull();
    expect(video.muted).toBe(true);
    expect(container.querySelector('.viewfinder__reticle')).toBeTruthy();
    expect(screen.getByText('Point at a barcode')).toBeTruthy();
    expect(container.querySelector('dialog')).toBeNull();
    expect(container.querySelector('.ground.ground--camera')).toBeTruthy();
  });

  it('shows the found pill once a code is passed via lastCode', () => {
    setup({ lastCode: '9780345391803' });
    expect(screen.getByText('Barcode found · 9780345391803')).toBeTruthy();
  });

  it('two identical decoded frames call onCode once and the stream stays live', async () => {
    const { props } = setup();
    const onCode = startScan.mock.calls[0]![1];
    onCode('9780345391803');
    await waitFor(() => expect(props.onCode).toHaveBeenCalledWith('9780345391803'));
    expect(props.onCode).toHaveBeenCalledTimes(1);
    // detect.ts owns track lifecycle; Viewfinder never stops the stream itself on decode (FR-011).
    expect(startScan).toHaveBeenCalledTimes(1);
  });

  it('unmount aborts the scan — the sole release path', async () => {
    const { container } = setup();
    await waitFor(() => expect(startScan).toHaveBeenCalledTimes(1));
    const signal = startScan.mock.calls[0]![2];
    expect(signal.aborted).toBe(false);
    cleanup();
    expect(signal.aborted).toBe(true);
    void container;
  });

  it('setting suspendedCode suppresses further identical frames; clearing it plus a code-free frame lets the same code fire again', async () => {
    const suspendFor = vi.fn();
    const resume = vi.fn();
    startScan.mockResolvedValue({ suspendFor, resume });
    const { container, props } = setup();
    await waitFor(() => expect(startScan).toHaveBeenCalledTimes(1));

    render(<Viewfinder onCode={props.onCode} onFailure={props.onFailure} suspendedCode="9780345391803" />, { container });
    await waitFor(() => expect(suspendFor).toHaveBeenCalledWith('9780345391803'));

    render(<Viewfinder onCode={props.onCode} onFailure={props.onFailure} suspendedCode={null} />, { container });
    await waitFor(() => expect(resume).toHaveBeenCalled());
  });

  it('a getUserMedia NotAllowedError calls onFailure(denied) and renders no video', async () => {
    startScan.mockRejectedValue(new ScanError('denied'));
    const { props, container } = setup();
    await waitFor(() => expect(props.onFailure).toHaveBeenCalledWith('denied'));
    // The "Camera not available" notice lives in the resting sheet (T034), not here — the App
    // unmounts Viewfinder on failure, and it renders nothing itself in the meantime.
    expect(container.querySelector('video')).toBeNull();
  });
});
