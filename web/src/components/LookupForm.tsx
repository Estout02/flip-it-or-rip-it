// The lookup form: one input for barcode or title (FR-001), Check, optional Scan, and the
// optional cost. Validates client-side before anything is sent (S7).
import type { Ref } from 'preact';
import { useEffect, useImperativeHandle, useRef, useState } from 'preact/hooks';
import { announce } from '../lib/announce';
import { classify } from '../lib/classify';
import { parseDollarsToCents } from '../lib/money';
import type { LookupInput } from '../lib/types';
import { CHECKING } from '../lib/verdict-copy';
import { CostField } from './CostField';
import { Icon } from './Icon';

export const INPUT_ID = 'lookup-input';
export const INPUT_ERROR_ID = 'lookup-error';

export type LookupFormHandle = {
  focusInput(): void;
  setValue(value: string): void;
  /** Clears the query and the cost, then focuses the input ("Check another"). */
  clear(): void;
  /** Validates and submits the current value (used after a scan). */
  submit(): void;
};

type Props = {
  handle?: Ref<LookupFormHandle>;
  loading: boolean;
  /** Server-side validation message (S7). */
  serverError: string | null;
  onFieldEdit(): void;
  onSubmit(input: Omit<LookupInput, 'profitThresholdCents'>): void;
  /** Rendered only when the device can open a camera. */
  onScan?: () => void;
  scanButtonRef?: Ref<HTMLButtonElement>;
};

export function LookupForm({ handle, loading, serverError, onFieldEdit, onSubmit, onScan, scanButtonRef }: Props) {
  const [value, setValue] = useState('');
  const [cost, setCost] = useState('');
  const [costOpen, setCostOpen] = useState(false);
  const [clientError, setClientError] = useState<string | null>(null);
  const [costError, setCostError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const costRef = useRef<HTMLInputElement>(null);
  const valueRef = useRef(value);
  valueRef.current = value;
  const costValueRef = useRef(cost);
  costValueRef.current = cost;

  const error = clientError ?? serverError;

  // Autofocus only on wide screens: on phones it would pop the keyboard over Scan (S0).
  useEffect(() => {
    if (typeof matchMedia === 'function' && matchMedia('(min-width: 1024px)').matches) inputRef.current?.focus();
  }, []);

  // A server-side validation error: announce it and put the user back in the field.
  useEffect(() => {
    if (!serverError) return;
    announce(serverError, 'assertive');
    inputRef.current?.focus();
  }, [serverError]);

  const trySubmit = (query: string, costText: string) => {
    const c = classify(query);
    if (!c.ok) {
      setClientError(c.error);
      announce(c.error, 'assertive');
      inputRef.current?.focus();
      return;
    }
    let costBasisCents: number | undefined;
    if (costText.trim() !== '') {
      const p = parseDollarsToCents(costText);
      if (!p.ok) {
        const msg = `What I paid: ${p.error}.`;
        setCostOpen(true);
        setCostError(msg);
        announce(msg, 'assertive');
        costRef.current?.focus();
        return;
      }
      if (p.cents > 0) costBasisCents = p.cents;
    }
    setClientError(null);
    setCostError(null);
    const input: Omit<LookupInput, 'profitThresholdCents'> =
      c.kind === 'identifier' ? { identifier: c.value } : { title: c.value };
    if (costBasisCents !== undefined) input.costBasisCents = costBasisCents;
    onSubmit(input);
  };

  useImperativeHandle(
    handle ?? null,
    () => ({
      focusInput: () => inputRef.current?.focus(),
      setValue: (v: string) => {
        setValue(v);
        valueRef.current = v;
        setClientError(null);
      },
      clear: () => {
        setValue('');
        setCost('');
        setClientError(null);
        setCostError(null);
        onFieldEdit();
        inputRef.current?.focus();
      },
      submit: () => trySubmit(valueRef.current, costValueRef.current),
    }),
    [onFieldEdit, onSubmit],
  );

  return (
    <form
      class="lookup card"
      aria-label="Look up an item"
      noValidate
      onSubmit={(e) => {
        e.preventDefault();
        trySubmit(value, cost);
      }}
    >
      <div class="field">
        <label for={INPUT_ID} class="field__label field__label--lead">
          Barcode or item name
        </label>
        <input
          id={INPUT_ID}
          ref={inputRef}
          class="input input--lead"
          type="text"
          inputMode="search"
          enterKeyHint="go"
          autocomplete="off"
          autoCapitalize="off"
          spellcheck={false}
          value={value}
          aria-invalid={error ? 'true' : undefined}
          aria-describedby={error ? INPUT_ERROR_ID : undefined}
          onInput={(e) => {
            setValue((e.currentTarget as HTMLInputElement).value);
            if (clientError) setClientError(null);
            if (serverError) onFieldEdit();
          }}
        />
        {error && (
          <p id={INPUT_ERROR_ID} class="field__error">
            <Icon name="alert" class="icon--inline" />
            {error}
          </p>
        )}
      </div>

      <CostField
        value={cost}
        onInput={(v) => {
          setCost(v);
          if (costError) setCostError(null);
        }}
        error={costError}
        inputRef={costRef}
        open={costOpen}
        onToggle={setCostOpen}
      />

      <div class="lookup__actions">
        <button type="submit" class="btn btn--primary btn--wide" aria-disabled={loading ? 'true' : undefined}>
          {loading && <span class="spinner" aria-hidden="true" />}
          {loading ? CHECKING : 'Check'}
        </button>
        {onScan && (
          <button type="button" class="btn btn--scan scan-dock" ref={scanButtonRef} onClick={onScan}>
            <Icon name="scan" />
            Scan
          </button>
        )}
      </div>
    </form>
  );
}
