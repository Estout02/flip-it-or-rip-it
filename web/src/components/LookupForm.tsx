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
  /** Clears the cost field only — the query lives in the caller's state (App) and is cleared
   * there via `onQueryChange('')`, since this component no longer owns it. */
  resetCost(): void;
};

type Props = {
  handle?: Ref<LookupFormHandle>;
  /** The draft query text. Lifted into the caller's state (App) so it survives this component
   * being unmounted and remounted as the sheet moves between resting and expanded. */
  query: string;
  onQueryChange(value: string): void;
  loading: boolean;
  /** Server-side validation message (S7). */
  serverError: string | null;
  onFieldEdit(): void;
  onSubmit(input: Omit<LookupInput, 'profitThresholdCents'>): void;
  /** Rendered only when the device can open a camera. */
  onScan?: () => void;
  scanButtonRef?: Ref<HTMLButtonElement>;
  /** Focus the input as soon as it mounts — the caller knows *why* it's mounting (desktop, or
   * returning to rest after a dismissal) in a way this component can't infer on its own. */
  autoFocus?: boolean;
};

export function LookupForm({
  handle,
  query,
  onQueryChange,
  loading,
  serverError,
  onFieldEdit,
  onSubmit,
  onScan,
  scanButtonRef,
  autoFocus,
}: Props) {
  const [cost, setCost] = useState('');
  const [costOpen, setCostOpen] = useState(false);
  const [clientError, setClientError] = useState<string | null>(null);
  const [costError, setCostError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const costRef = useRef<HTMLInputElement>(null);

  const error = clientError ?? serverError;

  // Mount-only: the caller decides whether this instance deserves focus on arrival (desktop, or a
  // return to rest after "Check another"/Escape) — never on the very first paint at narrow widths,
  // where it would pop the keyboard over Scan (S0).
  useEffect(() => {
    if (autoFocus) inputRef.current?.focus();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // A server-side validation error: announce it and put the user back in the field.
  useEffect(() => {
    if (!serverError) return;
    announce(serverError, 'assertive');
    inputRef.current?.focus();
  }, [serverError]);

  const trySubmit = (queryText: string, costText: string) => {
    const c = classify(queryText);
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
      resetCost: () => {
        setCost('');
        setCostError(null);
      },
    }),
    [],
  );

  return (
    <form
      class="lookup card"
      aria-label="Look up an item"
      noValidate
      onSubmit={(e) => {
        e.preventDefault();
        trySubmit(query, cost);
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
          value={query}
          aria-invalid={error ? 'true' : undefined}
          aria-describedby={error ? INPUT_ERROR_ID : undefined}
          onInput={(e) => {
            onQueryChange((e.currentTarget as HTMLInputElement).value);
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
          <button type="button" class="btn btn--scan" ref={scanButtonRef} onClick={onScan}>
            <Icon name="scan" />
            Scan
          </button>
        )}
      </div>
    </form>
  );
}
