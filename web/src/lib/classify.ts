// Barcode vs title (FR-001, data-model "Input classification").

export const EMPTY_INPUT_ERROR = 'Enter a barcode or an item name.';
export const TITLE_TOO_LONG_ERROR = 'Item names can be up to 200 characters. Shorten it and try again.';
export const TITLE_MAX = 200;

export type Classified =
  | { ok: true; kind: 'identifier'; value: string }
  | { ok: true; kind: 'title'; value: string }
  | { ok: false; error: string };

const BARCODE = /^\d{8}$|^\d{12,14}$|^\d{9}[\dXx]$/;

export function classify(raw: string): Classified {
  const trimmed = raw.trim();
  if (trimmed === '') return { ok: false, error: EMPTY_INPUT_ERROR };
  const compact = trimmed.replace(/[\s-]/g, '');
  // Send the original (trimmed) string: the server normalises hyphens and spaces.
  if (BARCODE.test(compact)) return { ok: true, kind: 'identifier', value: trimmed };
  if (trimmed.length > TITLE_MAX) return { ok: false, error: TITLE_TOO_LONG_ERROR };
  return { ok: true, kind: 'title', value: trimmed };
}
