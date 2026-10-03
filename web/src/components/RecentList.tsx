// S13: device-local recent lookups. Selecting one re-shows it without a new lookup.
// R9: two presentations of the same list — a permanent pane at >= 1024px (`.col-recent`), and a
// full-height modal sheet below it, opened from the chrome. The App decides which; this component
// never queries the viewport itself.
import type { ComponentChildren } from 'preact';
import { useRef, useState } from 'preact/hooks';
import type { HistoryEntry } from '../lib/types';
import { useModal } from '../lib/use-modal';
import {
  entryTitle,
  formatCheckedAt,
  isTestEnv,
  recentProfitPhrase,
  STORAGE_UNAVAILABLE,
  TEST_DATA_LABEL,
  VERDICT_COPY,
} from '../lib/verdict-copy';
import { Icon } from './Icon';

type Props = {
  history: HistoryEntry[];
  storageOk: boolean;
  onSelect(entry: HistoryEntry): void;
  onClear(): void;
  /** `'pane'` (default): today's permanent `#recent` column. `'sheet'`: a modal below 1024px. */
  presentation?: 'sheet' | 'pane';
  /** Sheet presentation only: whether the modal is open. Ignored for `'pane'`. */
  open?: boolean;
  /** Sheet presentation only: called after the dialog closed by any route. */
  onClose?(): void;
};

export function RecentList({ history, storageOk, onSelect, onClear, presentation = 'pane', open, onClose }: Props) {
  const [confirming, setConfirming] = useState(false);
  const confirmRef = useRef<HTMLDialogElement>(null);
  const cancelRef = useRef<HTMLButtonElement>(null);
  const clearBtnRef = useRef<HTMLButtonElement>(null);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const confirmed = useRef(false);
  const sheetRef = useRef<HTMLDialogElement>(null);

  useModal(
    confirmRef,
    confirming,
    () => {
      setConfirming(false);
      // After clearing, the Clear button is gone: land on the Recent heading instead.
      (confirmed.current ? headingRef.current : clearBtnRef.current)?.focus();
      confirmed.current = false;
    },
    cancelRef,
  );

  // Sheet presentation only: the App mounts/renders us with `open`/`onClose`; the pane
  // presentation ignores both.
  useModal(sheetRef, presentation === 'sheet' && !!open, () => onClose?.(), headingRef);

  const now = new Date();

  const clearHistoryConfirm = (
    <dialog ref={confirmRef} class="dialog dialog--small" aria-labelledby="clear-title">
      <div class="dialog__body">
        <h2 id="clear-title" class="dialog__title">
          Clear all recent lookups on this device?
        </h2>
        <div class="dialog__actions">
          <button
            type="button"
            class="btn btn--primary"
            onClick={() => {
              confirmed.current = true;
              onClear();
              confirmRef.current?.close();
            }}
          >
            Clear
          </button>
          <button type="button" class="btn" ref={cancelRef} autoFocus onClick={() => confirmRef.current?.close()}>
            Cancel
          </button>
        </div>
      </div>
    </dialog>
  );

  const body: ComponentChildren = (
    <>
      <div class="recent__head">
        <h2 id="recent-heading" class="recent__title" tabIndex={-1} ref={headingRef}>
          Recent
        </h2>
        {history.length > 0 && (
          <button
            type="button"
            class="btn-text"
            ref={clearBtnRef}
            aria-haspopup="dialog"
            onClick={() => setConfirming(true)}
          >
            <Icon name="trash" class="icon--inline" />
            Clear history
          </button>
        )}
      </div>

      {!storageOk && <p class="recent__notice">{STORAGE_UNAVAILABLE}</p>}

      {history.length === 0 ? (
        <p class="recent__empty">Items you check will show up here.</p>
      ) : (
        <ul class="recent__list" role="list">
          {history.map((e) => {
            const copy = VERDICT_COPY[e.result.verdict];
            const title = entryTitle(e);
            const profit = recentProfitPhrase(e.result);
            const time = formatCheckedAt(e.checkedAt, now);
            const test = isTestEnv(e.ebayEnv);
            // Explicit name per S13: "{Verdict label}: {title}, {profit phrase}, checked {time}",
            // optionally prefixed "Test data: " (spec 007). It starts with the visible text, in
            // visual order, word for word (WCAG 2.5.3 label in name); only the separators differ.
            // Verified against Chromium's tree in e2e/a11y.spec.ts.
            return (
              <li key={e.id}>
                <button
                  type="button"
                  class="recent-item"
                  aria-label={`${test ? `${TEST_DATA_LABEL}: ` : ''}${copy.label}: ${title}, ${profit}, checked ${time}`}
                  onClick={() => onSelect(e)}
                >
                  {test && (
                    <span class="chip chip--test">
                      <Icon name="flask" class="icon--chip" />
                      {TEST_DATA_LABEL}
                    </span>
                  )}
                  <span class={`chip chip--${copy.treatment}`}>
                    <Icon name={copy.icon} class="icon--chip" />
                    {copy.label}
                  </span>
                  <span class="recent-item__title">{title}</span>
                  <span class="recent-item__meta">
                    <span class="money">{profit}</span>
                    <span aria-hidden="true"> · </span>
                    {/* "checked" is visible too, so the name contains the visible text in order (2.5.3). */}
                    <span>checked {time}</span>
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </>
  );

  if (presentation === 'sheet') {
    return (
      <>
        <dialog ref={sheetRef} class="sheet sheet--full recent-sheet" aria-labelledby="recent-heading">
          <div class="sheet__body">
            {body}
            <button type="button" class="btn" onClick={() => sheetRef.current?.close()}>
              Close
            </button>
          </div>
        </dialog>
        {/* A sibling of the sheet dialog, not a descendant of it: two native `<dialog>`s both open
            via `showModal()`, one nested inside the other, paint correctly (confirm on top) but
            leave axe's color-contrast check unable to resolve `#clear-title`'s background
            (`elmPartiallyObscuring` — it can't reconcile the ancestor dialog's own top-layer
            promotion against the descendant's). This component's sheet-presentation output is
            already rendered inside App's root fragment (app.tsx), not inside the sheet `<dialog>`
            itself, so returning it as a plain sibling here — no portal needed — keeps it out of
            the sheet's DOM subtree and removes the nested-dialog ambiguity entirely; `confirmRef`
            still points at the same element, so focus/`useModal` are unaffected. */}
        {clearHistoryConfirm}
      </>
    );
  }

  return (
    <section id="recent" class="recent" aria-labelledby="recent-heading" tabIndex={-1}>
      {body}
      {clearHistoryConfirm}
    </section>
  );
}
