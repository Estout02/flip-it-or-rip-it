import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { classifyMediaError, locateFile, ScanError, startScan, wasmUrl } from './detect';

afterEach(() => vi.unstubAllGlobals());

describe('self-hosted decoder wasm', () => {
  it('locateFile points the .wasm at our own bundled asset, never a CDN', () => {
    expect(locateFile('zxing_reader.wasm', 'https://cdn.jsdelivr.net/npm/zxing-wasm@3.1.3/dist/reader/')).toBe(wasmUrl);
    expect(wasmUrl).not.toMatch(/^https?:/);
    expect(wasmUrl).toMatch(/zxing_reader\.wasm/);
  });

  it('the bundled wasm is exactly the build barcode-detector expects (sha256)', async () => {
    const { ZXING_WASM_SHA256, ZXING_WASM_VERSION } = await import('barcode-detector/ponyfill');
    // The package's exports map hides package.json, so read it from the install directly.
    const dir = join(process.cwd(), 'node_modules', 'zxing-wasm');
    const version = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8')).version;
    expect(version).toBe(ZXING_WASM_VERSION);
    const wasm = readFileSync(join(dir, 'dist', 'reader', 'zxing_reader.wasm'));
    expect(createHash('sha256').update(wasm).digest('hex')).toBe(ZXING_WASM_SHA256);
  });
});

describe('classifyMediaError', () => {
  it.each([
    ['NotAllowedError', 'denied'],
    ['SecurityError', 'denied'],
    ['NotFoundError', 'no-camera'],
    ['OverconstrainedError', 'no-camera'],
    ['NotReadableError', 'no-camera'],
    ['TypeError', 'unsupported'],
  ])('%s → %s', (name, reason) => {
    expect(classifyMediaError({ name })).toBe(reason);
  });
});

describe('startScan', () => {
  it('missing mediaDevices → unsupported', async () => {
    vi.stubGlobal('navigator', { ...navigator, mediaDevices: undefined });
    const video = document.createElement('video');
    await expect(startScan(video, vi.fn(), new AbortController().signal)).rejects.toEqual(new ScanError('unsupported'));
  });

  it('permission denied → denied', async () => {
    const getUserMedia = vi.fn().mockRejectedValue(Object.assign(new Error('no'), { name: 'NotAllowedError' }));
    vi.stubGlobal('navigator', { ...navigator, mediaDevices: { getUserMedia } });
    const video = document.createElement('video');
    const err = await startScan(video, vi.fn(), new AbortController().signal, async () => ({ detect: async () => [] })).catch(
      (e: unknown) => e,
    );
    expect((err as ScanError).reason).toBe('denied');
    expect(getUserMedia).toHaveBeenCalledWith({ video: { facingMode: { ideal: 'environment' } }, audio: false });
  });

  /**
   * Sets up a fake stream + detector that yields `reads` in order, then repeats the last item
   * forever (steady state) once exhausted — so a test can wait past its scripted frames without
   * the detector ever returning to "no code" behind its back. Drives ticks via a fake rAF.
   */
  function harness(reads: Array<Array<{ rawValue: string }>>) {
    const stop = vi.fn();
    const track = { stop, readyState: 'live' as const };
    const stream = { getTracks: () => [track, { ...track }] } as unknown as MediaStream;
    vi.stubGlobal('navigator', { ...navigator, mediaDevices: { getUserMedia: vi.fn().mockResolvedValue(stream) } });
    const queue = [...reads];
    let steady: Array<{ rawValue: string }> = [];
    const detector = {
      detect: vi.fn(async () => {
        if (queue.length) steady = queue.shift()!;
        return steady;
      }),
    };
    const video = document.createElement('video');
    Object.defineProperty(video, 'readyState', { value: 4 });
    video.play = vi.fn().mockResolvedValue(undefined);
    let t = 0;
    vi.spyOn(performance, 'now').mockImplementation(() => (t += 200));
    vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => setTimeout(() => cb(0), 0));
    return { stop, video, detector };
  }

  /** Lets a handful of real ticks elapse (the fake rAF chains via setTimeout(0)). */
  const settle = () => new Promise((resolve) => setTimeout(resolve, 30));

  it('emits after two identical consecutive reads and keeps the stream live', async () => {
    const { stop, video, detector } = harness([[{ rawValue: '111' }], [{ rawValue: '9780345391803' }], [], [{ rawValue: '9780345391803' }]]);
    const onCode = vi.fn();
    await startScan(video, onCode, new AbortController().signal, async () => detector);
    await vi.waitFor(() => expect(onCode).toHaveBeenCalledWith('9780345391803'));
    expect(onCode).toHaveBeenCalledTimes(1);
    expect(stop).not.toHaveBeenCalled();
    const stream = video.srcObject as MediaStream;
    expect((stream.getTracks()[0] as unknown as { readyState: string }).readyState).toBe('live');
    expect(video.srcObject).toBe(stream);
  });

  it('abort stops the camera', async () => {
    const stop = vi.fn();
    const stream = { getTracks: () => [{ stop }] } as unknown as MediaStream;
    vi.stubGlobal('navigator', { ...navigator, mediaDevices: { getUserMedia: vi.fn().mockResolvedValue(stream) } });
    vi.stubGlobal('requestAnimationFrame', () => 0);
    const video = document.createElement('video');
    video.play = vi.fn().mockResolvedValue(undefined);
    const ac = new AbortController();
    await startScan(video, vi.fn(), ac.signal, async () => ({ detect: async () => [] }));
    ac.abort();
    expect(stop).toHaveBeenCalled();
    expect(video.srcObject).toBeNull();
  });

  describe('suspendFor / resume (FR-010)', () => {
    it('suspendFor(code) then two more identical frames → onCode still called once', async () => {
      const { video, detector } = harness([[{ rawValue: '9780345391803' }], [{ rawValue: '9780345391803' }]]);
      const onCode = vi.fn();
      const handle = await startScan(video, onCode, new AbortController().signal, async () => detector);
      await vi.waitFor(() => expect(onCode).toHaveBeenCalledTimes(1));
      handle.suspendFor('9780345391803');
      await settle(); // several more identical frames elapse under steady state
      expect(onCode).toHaveBeenCalledTimes(1);
    });

    it('a different code decoded while suspended emits normally', async () => {
      const { video, detector } = harness([[{ rawValue: '9780345391803' }], [{ rawValue: '9780345391803' }]]);
      const onCode = vi.fn();
      const handle = await startScan(video, onCode, new AbortController().signal, async () => detector);
      await vi.waitFor(() => expect(onCode).toHaveBeenCalledTimes(1));
      handle.suspendFor('9780345391803');
      detector.detect.mockImplementation(async () => [{ rawValue: '9780000000002' }]);
      await vi.waitFor(() => expect(onCode).toHaveBeenCalledWith('9780000000002'));
      expect(onCode).toHaveBeenCalledTimes(2);
    });

    it('after resume(), two more identical frames of the suspended code still do not emit', async () => {
      const { video, detector } = harness([[{ rawValue: '9780345391803' }], [{ rawValue: '9780345391803' }]]);
      const onCode = vi.fn();
      const handle = await startScan(video, onCode, new AbortController().signal, async () => detector);
      await vi.waitFor(() => expect(onCode).toHaveBeenCalledTimes(1));
      handle.suspendFor('9780345391803');
      handle.resume();
      await settle(); // the code never leaves the frame, so the suppression is never cleared
      expect(onCode).toHaveBeenCalledTimes(1);
    });

    it('after resume() plus one code-free frame, the same code emits a second time', async () => {
      const { video, detector } = harness([[{ rawValue: '9780345391803' }], [{ rawValue: '9780345391803' }]]);
      const onCode = vi.fn();
      const handle = await startScan(video, onCode, new AbortController().signal, async () => detector);
      await vi.waitFor(() => expect(onCode).toHaveBeenCalledTimes(1));
      handle.suspendFor('9780345391803');
      handle.resume();
      detector.detect.mockImplementationOnce(async () => []); // the code-free frame that lifts the suppression
      await vi.waitFor(() => expect(onCode).toHaveBeenCalledTimes(2));
    });
  });
});
