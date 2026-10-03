// The result sheet is an in-page surface, not a <dialog> (research R1): a modal sheet would make
// the chrome (Recent, Settings, the sandbox badge, Cancel) unreachable while a result is open,
// which breaks FR-026 by construction. Dismissal is therefore wired by hand — a visible control
// (owned by the caller), Escape, and the back gesture — following the pattern already proven by
// `web/src/scanner/scanner.tsx` (`popped` guards a stray history.back() after a real pop).
import type { ComponentChildren } from 'preact';
import { useEffect, useRef } from 'preact/hooks';

type Presentation = 'bottom' | 'pane';
type View = 'resting' | 'expanded';

type Props = {
  view: View;
  onDismiss(): void;
  /** ≥ 1024 px passes 'pane' (desktop rule 2): no grabber, no history entry, no Escape listener —
   *  otherwise a desktop page load would push a `flipSheet` entry the user can never step back out
   *  of, and Escape would look broken. */
  presentation?: Presentation;
  /** Unused by the result sheet: `ResultPanel` keeps its own labelled region (desktop rule 7). Kept
   *  here only so the prop exists for callers that do want a labelled `.sheet` one day. */
  labelledBy?: string;
  label?: string;
  children: ComponentChildren;
};

export function Sheet({ view, onDismiss, presentation = 'bottom', labelledBy, label, children }: Props) {
  const dismiss = useRef(onDismiss);
  dismiss.current = onDismiss;
  const prevView = useRef(view);
  // Set once a popstate has actually fired, so the resting-transition effect below doesn't call
  // history.back() a second time for a pop the user already performed.
  const popped = useRef(false);

  useEffect(() => {
    if (presentation === 'pane') return;

    if (view === 'expanded' && prevView.current !== 'expanded') {
      popped.current = false;
      history.pushState({ flipSheet: true }, '');
    } else if (view === 'resting' && prevView.current === 'expanded' && !popped.current) {
      if ((history.state as { flipSheet?: boolean } | null)?.flipSheet) history.back();
    }
    prevView.current = view;
  }, [view, presentation]);

  useEffect(() => {
    if (presentation === 'pane' || view !== 'expanded') return undefined;

    const onPopState = () => {
      popped.current = true;
      dismiss.current();
    };
    window.addEventListener('popstate', onPopState);
    return () => window.removeEventListener('popstate', onPopState);
  }, [presentation, view]);

  useEffect(() => {
    if (presentation === 'pane' || view !== 'expanded') return undefined;

    const onKeydown = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      // Recent and Settings are their own <dialog>s with their own Escape handling; don't
      // double-dismiss underneath them.
      if (document.querySelector('dialog[open]')) return;
      dismiss.current();
    };
    document.addEventListener('keydown', onKeydown);
    return () => document.removeEventListener('keydown', onKeydown);
  }, [presentation, view]);

  const classes = ['sheet', view === 'expanded' ? 'sheet--expanded' : 'sheet--resting'];
  if (presentation === 'pane') classes.push('sheet--pane');

  return (
    <section class={classes.join(' ')} aria-labelledby={labelledBy} aria-label={label}>
      {presentation !== 'pane' && <div class="sheet__grabber" aria-hidden="true" />}
      <div class="sheet__body">{children}</div>
    </section>
  );
}

export default Sheet;
export type { Props as SheetProps };
