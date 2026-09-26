// The verdict hero: icon + eyebrow + label (h2, focus target) + reason. Text, icon and color
// together carry the verdict — never color alone (FR-003).
import type { Ref } from 'preact';
import type { VerdictResult } from '../lib/types';
import { historyNote, reasonFor, VERDICT_COPY } from '../lib/verdict-copy';
import { Icon } from './Icon';

export const RESULT_HEADING_ID = 'result-heading';
const SAVED_NOTE_ID = 'result-saved-note';

type Props = {
  result: VerdictResult;
  headingRef?: Ref<HTMLHeadingElement>;
  /** ISO time; renders the S12 "Saved result" note when set. */
  savedAt?: string;
};

export function VerdictBanner({ result, headingRef, savedAt }: Props) {
  const copy = VERDICT_COPY[result.verdict];
  return (
    <div class={`verdict verdict--${copy.treatment}`}>
      <Icon name={copy.icon} class="verdict__icon" />
      <div class="verdict__text">
        <p class="verdict__eyebrow">{copy.eyebrow}</p>
        {savedAt && (
          <p id={SAVED_NOTE_ID} class="verdict__saved">
            <Icon name="clock" class="icon--inline" />
            {historyNote(savedAt)}
          </p>
        )}
        {/* The saved note sits above the heading, i.e. before the focus target in reading order,
            so it would be skipped when focus lands here: describe the heading with it (S12). */}
        <h2
          id={RESULT_HEADING_ID}
          class="verdict__label"
          tabIndex={-1}
          ref={headingRef}
          aria-describedby={savedAt ? SAVED_NOTE_ID : undefined}
        >
          {copy.label}
        </h2>
        <p class="verdict__reason">{reasonFor(result)}</p>
      </div>
    </div>
  );
}
