// S13: device-local recent lookups. Selecting one re-shows it without a new lookup.
import { useRef, useState } from 'preact/hooks';
import type { HistoryEntry } from '../lib/types';
import { useModal } from '../lib/use-modal';
import {
  entryTitle,
  formatCheckedAt,
  recentProfitPhrase,
  STORAGE_UNAVAILABLE,
  VERDICT_COPY,
} from '../lib/verdict-copy';
import { Icon } from './Icon';

type Props = {
  history: HistoryEntry[];
  storageOk: boolean;
  onSelect(entry: HistoryEntry): void;
  onClear(): void;
};

export function RecentList({ history, storageOk, onSelect, onClear }: Props) {
  const [confirming, setConfirming] = useState(false);
  const dialogRef = useRef<HTMLDialogElement>(null);
  const cancelRef = useRef<HTMLButtonElement>(null);
  const clearBtnRef = useRef<HTMLButtonElement>(null);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const confirmed = useRef(false);

  useModal(
    dialogRef,
    confirming,
    () => {
      setConfirming(false);
      // After clearing, the Clear button is gone: land on the Recent heading instead.
      (confirmed.current ? headingRef.current : clearBtnRef.current)?.focus();
      confirmed.current = false;
    },
    cancelRef,
  );

  const now = new Date();

  return (
    <section id="recent" class="card recent" aria-labelledby="recent-heading" tabIndex={-1}>
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
            // Explicit name per S13: "{Verdict label}: {title}, {profit phrase}, checked {time}".
            // It starts with the visible text, in visual order, word for word (WCAG 2.5.3 label in
            // name); only the separators differ. Verified against Chromium's tree in e2e/a11y.spec.ts.
            return (
              <li key={e.id}>
                <button
                  type="button"
                  class="recent-item"
                  aria-label={`${copy.label}: ${title}, ${profit}, checked ${time}`}
                  onClick={() => onSelect(e)}
                >
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

      <dialog ref={dialogRef} class="dialog dialog--small" aria-labelledby="clear-title">
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
                dialogRef.current?.close();
              }}
            >
              Clear
            </button>
            <button type="button" class="btn" ref={cancelRef} autoFocus onClick={() => dialogRef.current?.close()}>
              Cancel
            </button>
          </div>
        </div>
      </dialog>
    </section>
  );
}
