import { BASIS_NOTE } from '../lib/verdict-copy';

/** FR-005: always visible on every result. */
export function BasisNote() {
  return <p class="basis-note">{BASIS_NOTE}</p>;
}
