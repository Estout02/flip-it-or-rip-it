// The verdict siblings placed directly in `.result__body` (R-C): optional saved/env notes, then
// the capsule (dot + icon + label only — never text below the large-text threshold on the tint,
// color-contract rule 1), then the reason, then the eyebrow. Text, icon and color together carry
// the verdict — never color alone (FR-003).
import type { Ref } from 'preact';
import type { VerdictResult } from '../lib/types';
import { historyNote, reasonFor, TEST_DATA_LABEL, TEST_DATA_WIDE, VERDICT_COPY } from '../lib/verdict-copy';
import { Icon } from './Icon';

export const RESULT_HEADING_ID = 'result-heading';
const SAVED_NOTE_ID = 'result-saved-note';
const ENV_NOTE_ID = 'result-env-note';

type Props = {
  result: VerdictResult;
  headingRef?: Ref<HTMLHeadingElement>;
  /** ISO time; renders the S12 "Saved result" note when set. */
  savedAt?: string;
  /** Spec 007: history result checked in a non-production environment. Only shown with savedAt. */
  testData?: boolean;
};

export function VerdictBanner({ result, headingRef, savedAt, testData }: Props) {
  const copy = VERDICT_COPY[result.verdict];
  const describedBy = savedAt ? (testData ? `${SAVED_NOTE_ID} ${ENV_NOTE_ID}` : SAVED_NOTE_ID) : undefined;
  return (
    <>
      {savedAt && (
        <p id={SAVED_NOTE_ID} class="verdict__saved">
          <Icon name="clock" class="icon--inline" />
          {historyNote(savedAt)}
        </p>
      )}
      {savedAt && testData && (
        <p id={ENV_NOTE_ID} class="env-note">
          <Icon name="flask" class="icon--chip" />
          {TEST_DATA_LABEL}
          {TEST_DATA_WIDE}
        </p>
      )}
      <div class={`capsule capsule--${copy.treatment}`}>
        <span class="capsule__dot" aria-hidden="true" />
        <Icon name={copy.icon} class="capsule__icon" />
        {/* The saved note sits above the capsule, i.e. before the focus target in reading order,
            so it would be skipped when focus lands here: describe the heading with it (S12). */}
        <h2 id={RESULT_HEADING_ID} class="capsule__label" tabIndex={-1} ref={headingRef} aria-describedby={describedBy}>
          {copy.label}
        </h2>
      </div>
      <p class="verdict__reason">{reasonFor(result)}</p>
      <p class="verdict__eyebrow">{copy.eyebrow}</p>
    </>
  );
}
