// S15: full-screen modal scanner. Lazy-loaded on the first Scan tap; never in the initial bundle.
import { useEffect, useRef, useState } from 'preact/hooks';
import { Icon } from '../components/Icon';
import { SCANNER_COPY } from '../lib/verdict-copy';
import { ScanError, startScan, type ScanFailure } from './detect';

type Props = {
  onCode(code: string): void;
  /** Cancel button, Escape, back gesture or page hidden: focus goes back to Scan. */
  onCancel(): void;
  /** "Type it instead": focus goes to the input. */
  onTypeInstead(): void;
};

type Outcome = { kind: 'code'; code: string } | { kind: 'cancel' } | { kind: 'type' };

const NO_CAMERA = 'No camera was found. Type the number under the barcode instead.';

function failureBody(f: ScanFailure): string {
  if (f === 'denied') return SCANNER_COPY.denied;
  if (f === 'no-camera') return NO_CAMERA;
  return SCANNER_COPY.unsupported;
}

export function Scanner({ onCode, onCancel, onTypeInstead }: Props) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const cancelRef = useRef<HTMLButtonElement>(null);
  const typeRef = useRef<HTMLButtonElement>(null);
  const outcome = useRef<Outcome | null>(null);
  const popped = useRef(false);
  const [failure, setFailure] = useState<ScanFailure | null>(null);
  const cb = useRef({ onCode, onCancel, onTypeInstead });
  cb.current = { onCode, onCancel, onTypeInstead };

  const finish = (o: Outcome) => {
    if (outcome.current) return;
    outcome.current = o;
    dialogRef.current?.close();
  };

  useEffect(() => {
    const dialog = dialogRef.current!;
    const ac = new AbortController();

    const onClose = () => {
      ac.abort(); // stops the camera immediately (FR-009)
      if (!popped.current && (history.state as { flipScanner?: boolean } | null)?.flipScanner) history.back();
      const o = outcome.current ?? { kind: 'cancel' };
      outcome.current = o;
      if (o.kind === 'code') cb.current.onCode(o.code);
      else if (o.kind === 'type') cb.current.onTypeInstead();
      else cb.current.onCancel();
    };
    const onPop = () => {
      popped.current = true;
      finish({ kind: 'cancel' });
    };
    const onVisibility = () => {
      if (document.visibilityState === 'hidden') finish({ kind: 'cancel' });
    };

    dialog.addEventListener('close', onClose);
    window.addEventListener('popstate', onPop);
    document.addEventListener('visibilitychange', onVisibility);

    history.pushState({ flipScanner: true }, '');
    dialog.showModal();
    cancelRef.current?.focus();

    startScan(videoRef.current!, (code) => finish({ kind: 'code', code }), ac.signal).catch((err: unknown) => {
      if (ac.signal.aborted) return;
      setFailure(err instanceof ScanError ? err.reason : 'unsupported');
    });

    return () => {
      ac.abort();
      dialog.removeEventListener('close', onClose);
      window.removeEventListener('popstate', onPop);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, []);

  useEffect(() => {
    if (failure) typeRef.current?.focus();
  }, [failure]);

  return (
    <dialog
      ref={dialogRef}
      class={failure ? 'scanner scanner--failed' : 'scanner'}
      aria-labelledby="scanner-title"
      aria-describedby={failure ? 'scanner-body' : undefined}
    >
      {failure ? (
        <div class="scanner__failed">
          <Icon name="alert" class="scanner__failed-icon" />
          <h2 id="scanner-title" class="dialog__title">
            {SCANNER_COPY.unavailableHeading}
          </h2>
          <p id="scanner-body">{failureBody(failure)}</p>
          <button type="button" ref={typeRef} class="btn btn--primary" onClick={() => finish({ kind: 'type' })}>
            {SCANNER_COPY.typeInstead}
          </button>
        </div>
      ) : (
        <>
          <div class="scanner__stage">
            <video ref={videoRef} class="scanner__video" playsInline muted autoPlay aria-hidden="true" />
            <div class="scanner__frame" aria-hidden="true" />
          </div>
          <div class="scanner__bar">
            <h2 id="scanner-title" class="scanner__prompt">
              <Icon name="scan" class="icon--inline" />
              {SCANNER_COPY.prompt}
            </h2>
            <button type="button" ref={cancelRef} class="btn scanner__cancel" onClick={() => finish({ kind: 'cancel' })}>
              {SCANNER_COPY.cancel}
            </button>
          </div>
        </>
      )}
    </dialog>
  );
}

export default Scanner;
