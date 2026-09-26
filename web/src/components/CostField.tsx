// "What I paid (optional)": collapsed by default, used for one lookup only (US3-1).
import type { Ref } from 'preact';

export const COST_ERROR_ID = 'cost-error';

type Props = {
  value: string;
  onInput(value: string): void;
  error: string | null;
  inputRef: Ref<HTMLInputElement>;
  open: boolean;
  onToggle(open: boolean): void;
};

export function CostField({ value, onInput, error, inputRef, open, onToggle }: Props) {
  return (
    <details class="cost" open={open} onToggle={(e) => onToggle((e.currentTarget as HTMLDetailsElement).open)}>
      <summary>What I paid (optional)</summary>
      <div class="field cost__field">
        <label for="cost-input" class="field__label">
          Amount paid ($)
        </label>
        <div class="money-input">
          <span class="money-input__prefix" aria-hidden="true">
            $
          </span>
          <input
            id="cost-input"
            ref={inputRef}
            class="input"
            type="text"
            inputMode="decimal"
            autocomplete="off"
            value={value}
            aria-invalid={error ? 'true' : undefined}
            aria-describedby={error ? COST_ERROR_ID : undefined}
            onInput={(e) => onInput((e.currentTarget as HTMLInputElement).value)}
          />
        </div>
        {error && (
          <p id={COST_ERROR_ID} class="field__error">
            {error}
          </p>
        )}
      </div>
    </details>
  );
}
