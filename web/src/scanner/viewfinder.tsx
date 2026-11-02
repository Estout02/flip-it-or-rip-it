// Native sheet UI (008): the camera is the ground itself, not a modal. Lazy-loaded on the first
// Scan tap; never in the initial bundle. Failure UI moved to the resting sheet (T034) — this
// component only ever renders the live viewfinder.
import { useEffect, useRef, useState } from 'preact/hooks';
import { SCANNER_COPY } from '../lib/verdict-copy';
import { ScanError, startScan, type ScanFailure, type ScanHandle } from './detect';

type Props = {
  onCode(code: string): void;
  onFailure(reason: ScanFailure): void;
  /** The code to keep suppressed while the result sheet for it is open. */
  suspendedCode: string | null;
  lastCode?: string | null;
  presentation?: 'ground' | 'card';
};

export function Viewfinder({ onCode, onFailure, suspendedCode, lastCode, presentation = 'ground' }: Props) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const handleRef = useRef<ScanHandle | null>(null);
  const cb = useRef({ onCode, onFailure });
  cb.current = { onCode, onFailure };
  // Once startScan rejects there is no stream to show; the App unmounts this component in
  // response to onFailure, but rendering nothing here too keeps a lone unit test honest.
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    const ac = new AbortController();
    startScan(videoRef.current!, (code) => cb.current.onCode(code), ac.signal)
      .then((handle) => {
        if (ac.signal.aborted) return;
        handleRef.current = handle;
      })
      .catch((err: unknown) => {
        if (ac.signal.aborted) return;
        setFailed(true);
        cb.current.onFailure(err instanceof ScanError ? err.reason : 'unsupported');
      });

    // `signal.abort()` — on unmount here — is the sole release path (data-model §1).
    return () => ac.abort();
  }, []);

  useEffect(() => {
    const handle = handleRef.current;
    if (!handle) return;
    if (suspendedCode) handle.suspendFor(suspendedCode);
    else handle.resume();
  }, [suspendedCode]);

  if (failed) return null;

  return (
    <div class={presentation === 'card' ? 'ground ground--camera ground--card' : 'ground ground--camera'}>
      <video ref={videoRef} class="viewfinder__video" playsInline muted autoPlay aria-hidden="true" />
      <div class="viewfinder__reticle" aria-hidden="true" />
      <p class="pill">{lastCode ? SCANNER_COPY.found(lastCode) : SCANNER_COPY.prompt}</p>
    </div>
  );
}

export default Viewfinder;
