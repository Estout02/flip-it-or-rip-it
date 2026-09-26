// Native <dialog> as a modal: showModal() gives focus trapping, inertness, Escape and the
// top layer for free. Closing always goes through dialog.close() so there is one path:
// the `close` event → onClose().
import type { RefObject } from 'preact';
import { useEffect, useRef } from 'preact/hooks';

export function useModal(
  dialogRef: RefObject<HTMLDialogElement>,
  open: boolean,
  onClose: () => void,
  initialFocus?: RefObject<HTMLElement>,
): void {
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => {
    const d = dialogRef.current;
    if (!d) return;
    if (open && !d.open) {
      d.showModal();
      initialFocus?.current?.focus();
    } else if (!open && d.open) {
      d.close();
    }
  }, [open]);

  useEffect(() => {
    const d = dialogRef.current;
    if (!d) return;
    const handle = () => onCloseRef.current();
    d.addEventListener('close', handle);
    return () => d.removeEventListener('close', handle);
  }, []);
}
