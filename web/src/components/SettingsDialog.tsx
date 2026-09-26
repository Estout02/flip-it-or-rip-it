// S14: device-local minimum profit. Native modal <dialog>; Escape closes it.
import { useEffect, useRef, useState } from 'preact/hooks';
import { announce } from '../lib/announce';
import { centsToDollarInput, formatCents, parseDollarsToCents } from '../lib/money';
import type { Meta, Settings } from '../lib/types';
import { useModal } from '../lib/use-modal';

type Props = {
  open: boolean;
  settings: Settings;
  meta: Meta;
  onSave(profitThresholdCents: number | null): void;
  /** Called after the dialog closed by any route (Save, Use default, Close, Escape). */
  onClose(): void;
};

export function SettingsDialog({ open, settings, meta, onSave, onClose }: Props) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const [value, setValue] = useState('');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setValue(settings.profitThresholdCents === null ? '' : centsToDollarInput(settings.profitThresholdCents));
    setError(null);
  }, [open]);

  useModal(dialogRef, open, onClose, inputRef);

  const close = () => dialogRef.current?.close();

  const save = (cents: number | null) => {
    onSave(cents);
    announce('Saved', 'polite');
    close();
  };

  const describedBy = error ? 'threshold-help threshold-error' : 'threshold-help';

  return (
    <dialog ref={dialogRef} class="dialog" aria-labelledby="settings-title">
      <form
        class="dialog__body"
        noValidate
        onSubmit={(e) => {
          e.preventDefault();
          if (value.trim() === '') return save(null);
          const p = parseDollarsToCents(value);
          if (!p.ok) {
            setError(`Minimum profit: ${p.error}.`);
            announce(`Minimum profit: ${p.error}.`, 'assertive');
            inputRef.current?.focus();
            return;
          }
          save(p.cents);
        }}
      >
        <h2 id="settings-title" class="dialog__title">
          Your settings
        </h2>
        <div class="field">
          <label for="threshold-input" class="field__label">
            Minimum profit to flip ($)
          </label>
          <div class="money-input">
            <span class="money-input__prefix" aria-hidden="true">
              $
            </span>
            <input
              id="threshold-input"
              ref={inputRef}
              class="input"
              type="text"
              inputMode="decimal"
              autocomplete="off"
              value={value}
              aria-invalid={error ? 'true' : undefined}
              aria-describedby={describedBy}
              onInput={(e) => {
                setValue((e.currentTarget as HTMLInputElement).value);
                if (error) setError(null);
              }}
            />
          </div>
          <p id="threshold-help" class="field__help">
            Default: {formatCents(meta.defaultProfitThresholdCents)}. Items below this come back as Rip it.
          </p>
          {error && (
            <p id="threshold-error" class="field__error">
              {error}
            </p>
          )}
        </div>
        <div class="dialog__actions">
          <button type="submit" class="btn btn--primary">
            Save
          </button>
          <button type="button" class="btn" onClick={() => save(null)}>
            Use default
          </button>
          <button type="button" class="btn" onClick={close}>
            Close
          </button>
        </div>
      </form>
    </dialog>
  );
}
