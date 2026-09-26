// Barcode detection (research R3). Loaded only with the scanner chunk, on the first Scan tap.
//
// 1. Native BarcodeDetector where it exists and supports EAN-13 (Chromium on Android).
// 2. Otherwise the `barcode-detector` ponyfill (ZXing-C++ → WebAssembly). Verified against
//    barcode-detector 3.2.2: `prepareZXingModule` is re-exported from `barcode-detector/ponyfill`,
//    the package pins zxing-wasm 3.1.3, and its default `locateFile` points at the jsDelivr CDN.
//    We override `locateFile` so the .wasm is the hashed asset Vite emits from
//    `zxing-wasm/reader/zxing_reader.wasm` — served from our own origin; no CDN is contacted
//    (FR-010, CSP 'self'). Frames never leave the device.
import wasmUrl from 'zxing-wasm/reader/zxing_reader.wasm?url';

export const FORMATS = ['ean_13', 'ean_8', 'upc_a', 'upc_e'] as const;

export type ScanFailure = 'denied' | 'no-camera' | 'unsupported';

export class ScanError extends Error {
  constructor(readonly reason: ScanFailure) {
    super(reason);
    this.name = 'ScanError';
  }
}

export type Detector = { detect(source: HTMLVideoElement): Promise<ReadonlyArray<{ rawValue: string }>> };

type NativeCtor = {
  new (opts: { formats: string[] }): Detector;
  getSupportedFormats(): Promise<string[]>;
};

export { wasmUrl };

export function locateFile(path: string, prefix: string): string {
  return path.endsWith('.wasm') ? wasmUrl : prefix + path;
}

let prepared = false;

export async function createDetector(): Promise<Detector> {
  const Native = (globalThis as { BarcodeDetector?: NativeCtor }).BarcodeDetector;
  if (Native && typeof Native.getSupportedFormats === 'function') {
    try {
      const supported = await Native.getSupportedFormats();
      if (supported.includes('ean_13')) return new Native({ formats: [...FORMATS] });
    } catch {
      // fall through to the ponyfill
    }
  }
  const { BarcodeDetector, prepareZXingModule } = await import('barcode-detector/ponyfill');
  if (!prepared) {
    prepared = true;
    // fireImmediately starts fetching/compiling the wasm now, in parallel with the camera prompt.
    void prepareZXingModule({ overrides: { locateFile }, fireImmediately: true }).catch(() => {
      prepared = false;
    });
  }
  return new BarcodeDetector({ formats: [...FORMATS] });
}

export function classifyMediaError(err: unknown): ScanFailure {
  const name = (err as { name?: string } | null)?.name;
  if (name === 'NotAllowedError' || name === 'SecurityError' || name === 'PermissionDeniedError') return 'denied';
  if (name === 'NotFoundError' || name === 'OverconstrainedError' || name === 'NotReadableError' || name === 'DevicesNotFoundError')
    return 'no-camera';
  return 'unsupported';
}

const FRAME_INTERVAL_MS = 125; // ≈ 8 fps: plenty for a held barcode, easy on the battery

/**
 * Opens the rear camera into `video` and resolves once the loop is running. Calls `onCode`
 * once, after the same value is read twice in a row. All tracks stop on accept or abort.
 * Rejects with `ScanError` when scanning is impossible.
 */
export async function startScan(
  video: HTMLVideoElement,
  onCode: (code: string) => void,
  signal: AbortSignal,
  makeDetector: () => Promise<Detector> = createDetector,
): Promise<void> {
  if (!navigator.mediaDevices?.getUserMedia) throw new ScanError('unsupported');
  const detectorPromise = makeDetector();
  detectorPromise.catch(() => undefined); // handled below; avoid an unhandled rejection

  let stream: MediaStream;
  try {
    stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: 'environment' } }, audio: false });
  } catch (err) {
    throw new ScanError(classifyMediaError(err));
  }

  const stop = () => {
    for (const t of stream.getTracks()) t.stop();
    video.srcObject = null;
  };
  if (signal.aborted) return stop();
  signal.addEventListener('abort', stop, { once: true });

  let detector: Detector;
  try {
    detector = await detectorPromise;
  } catch {
    stop();
    throw new ScanError('unsupported');
  }
  if (signal.aborted) return;

  video.muted = true;
  video.playsInline = true;
  video.srcObject = stream;
  try {
    await video.play();
  } catch {
    // autoplay quirks: frames still arrive once the element is visible
  }

  let last: string | null = null;
  let lastRun = 0;

  const schedule = () => {
    if (signal.aborted) return;
    const v = video as HTMLVideoElement & { requestVideoFrameCallback?: (cb: () => void) => number };
    if (typeof v.requestVideoFrameCallback === 'function') v.requestVideoFrameCallback(() => void tick());
    else requestAnimationFrame(() => void tick());
  };

  const tick = async () => {
    if (signal.aborted) return;
    const now = performance.now();
    if (now - lastRun >= FRAME_INTERVAL_MS && video.readyState >= 2) {
      lastRun = now;
      try {
        const codes = await detector.detect(video);
        if (signal.aborted) return;
        const value = codes[0]?.rawValue ?? null;
        if (value !== null) {
          if (value === last) {
            signal.removeEventListener('abort', stop);
            stop();
            onCode(value);
            return;
          }
          last = value;
        }
      } catch {
        // a transient decode failure: keep scanning
      }
    }
    schedule();
  };

  schedule();
}
