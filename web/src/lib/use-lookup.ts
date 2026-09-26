// Lookup state machine (research R6): idle → loading → success | error.
// Each new submit aborts the previous request and bumps a sequence number; a response whose
// sequence is no longer current is discarded, so a stale answer never overwrites a newer one
// (FR-007). An identical submit while one is in flight is ignored (double-tap).
import { useCallback, useEffect, useRef, useState } from 'preact/hooks';
import { announce } from './announce';
import { lookup, LookupFailure } from './api';
import { addToHistory, clearHistory as clearStored, loadHistory, newId } from './storage';
import type { HistoryEntry, LookupInput, LookupState } from './types';
import { CHECKING } from './verdict-copy';

function sameInput(a: LookupInput, b: LookupInput): boolean {
  return (
    a.identifier === b.identifier &&
    a.title === b.title &&
    a.costBasisCents === b.costBasisCents &&
    a.profitThresholdCents === b.profitThresholdCents
  );
}

export type UseLookup = {
  /** The true machine state. */
  state: LookupState;
  /**
   * What the result area shows. A validation error (S7) is shown inline at the input, so the
   * result area keeps its previous content.
   */
  shown: LookupState;
  /** S7 message from the server, shown inline at the input. */
  fieldError: string | null;
  history: HistoryEntry[];
  submit(input: LookupInput): void;
  retry(): void;
  showEntry(entry: HistoryEntry): void;
  reset(): void;
  clearHistory(): void;
  clearFieldError(): void;
};

export function useLookup(): UseLookup {
  const [state, setState] = useState<LookupState>({ status: 'idle' });
  const [shown, setShown] = useState<LookupState>({ status: 'idle' });
  const [fieldError, setFieldError] = useState<string | null>(null);
  const [history, setHistory] = useState<HistoryEntry[]>(() => loadHistory());

  const seq = useRef(0);
  const controller = useRef<AbortController | null>(null);
  const inFlight = useRef<LookupInput | null>(null);
  const lastInput = useRef<LookupInput | null>(null);
  const beforeLoading = useRef<LookupState>({ status: 'idle' });
  const shownRef = useRef(shown);
  shownRef.current = shown;

  const cancel = () => {
    controller.current?.abort();
    controller.current = null;
    inFlight.current = null;
  };

  useEffect(() => cancel, []);

  const submit = useCallback((input: LookupInput) => {
    if (inFlight.current && sameInput(inFlight.current, input)) return;
    cancel();
    const mySeq = ++seq.current;
    const ac = new AbortController();
    controller.current = ac;
    inFlight.current = input;
    lastInput.current = input;
    if (shownRef.current.status !== 'loading') beforeLoading.current = shownRef.current;

    const loading: LookupState = { status: 'loading', input };
    setFieldError(null);
    setState(loading);
    setShown(loading);
    announce(CHECKING, 'polite');

    lookup(input, ac.signal).then(
      (result) => {
        if (mySeq !== seq.current) return;
        inFlight.current = null;
        const entry: HistoryEntry = {
          id: newId(),
          checkedAt: new Date().toISOString(),
          query: { identifier: input.identifier ?? null, title: input.title ?? null },
          costBasisCents: input.costBasisCents ?? 0,
          result,
        };
        setHistory(addToHistory(entry));
        const next: LookupState = { status: 'success', entry, fromHistory: false };
        setState(next);
        setShown(next);
      },
      (err: unknown) => {
        if (mySeq !== seq.current) return;
        if ((err as { name?: string })?.name === 'AbortError') return;
        inFlight.current = null;
        const error = err instanceof LookupFailure ? err.error : ({ kind: 'unexpected' } as const);
        const next: LookupState = { status: 'error', error, input };
        setState(next);
        if (error.kind === 'validation') {
          setFieldError(error.message);
          setShown(beforeLoading.current);
        } else {
          setShown(next);
        }
      },
    );
  }, []);

  const retry = useCallback(() => {
    if (lastInput.current) submit(lastInput.current);
  }, [submit]);

  const showEntry = useCallback((entry: HistoryEntry) => {
    cancel();
    seq.current++;
    const next: LookupState = { status: 'success', entry, fromHistory: true };
    setFieldError(null);
    setState(next);
    setShown(next);
  }, []);

  const reset = useCallback(() => {
    cancel();
    seq.current++;
    const idle: LookupState = { status: 'idle' };
    setState(idle);
    setShown(idle);
  }, []);

  const clearHistory = useCallback(() => {
    clearStored();
    setHistory([]);
  }, []);

  const clearFieldError = useCallback(() => setFieldError(null), []);

  return { state, shown, fieldError, history, submit, retry, showEntry, reset, clearHistory, clearFieldError };
}
