// Pipeline step 1: raw lookup input → validated ItemQuery. Rejecting bad input
// here — before any external call — protects eBay quota and gives instant
// feedback (FR-002, SC-006).

export class ValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ValidationError';
  }
}

export interface ItemQuery {
  /** gtin when a valid identifier was supplied — identifier takes precedence. */
  kind: 'gtin' | 'title';
  /** Normalized digits; ISBN-10 already converted to ISBN-13. */
  gtin?: string;
  /** Original-casing title for the eBay query (title lookups and gtin fallback). */
  titleQuery?: string;
  /** `gtin:<digits>` or `title:<normalized title>` (FR-011). */
  cacheKey: string;
}

export interface IdentifyInput {
  identifier?: string;
  title?: string;
}

const MAX_TITLE_LENGTH = 200;

/** EAN-13 check digit: alternating ×1/×3 weights over the first 12 digits. */
function ean13CheckDigit(first12: string): number {
  let sum = 0;
  for (let i = 0; i < 12; i++) {
    const digit = Number(first12[i]);
    sum += i % 2 === 0 ? digit : digit * 3;
  }
  return (10 - (sum % 10)) % 10;
}

/**
 * ISBN-10 → ISBN-13/GTIN: prefix 978 to the 9 data digits and recompute the
 * check digit. Conversion is deterministic math; we don't re-verify the ISBN-10
 * check digit — scanners already did (research R3).
 */
function isbn10ToIsbn13(isbn10: string): string {
  const first12 = `978${isbn10.slice(0, 9)}`;
  return `${first12}${ean13CheckDigit(first12)}`;
}

/** Classify a normalized code as a GTIN eBay accepts, or null when malformed. */
function toGtin(normalized: string): string | null {
  if (/^\d{10}$/.test(normalized) || /^\d{9}[Xx]$/.test(normalized)) {
    return isbn10ToIsbn13(normalized);
  }
  if (/^\d{8}$/.test(normalized)) return normalized; // EAN-8
  if (/^\d{12}$/.test(normalized)) return normalized; // UPC-A
  if (/^\d{13}$/.test(normalized)) return normalized; // EAN/ISBN-13
  if (/^\d{14}$/.test(normalized)) return normalized; // GTIN-14
  return null;
}

/** Title normalization for cache keys: trim, collapse whitespace, lowercase. */
function normalizeTitle(title: string): string {
  return title.trim().replace(/\s+/g, ' ').toLowerCase();
}

export function identify(input: IdentifyInput): ItemQuery {
  const rawIdentifier = input.identifier?.trim() ?? '';
  const rawTitle = input.title?.trim() ?? '';

  let titleQuery: string | undefined;
  if (rawTitle.length > 0) {
    if (rawTitle.length > MAX_TITLE_LENGTH) {
      throw new ValidationError(`Title must be at most ${MAX_TITLE_LENGTH} characters.`);
    }
    titleQuery = rawTitle;
  }

  if (rawIdentifier.length > 0) {
    const normalized = rawIdentifier.replace(/[-\s]/g, '');
    const gtin = toGtin(normalized);
    if (gtin === null) {
      throw new ValidationError(
        'Identifier is not a recognizable UPC/ISBN/EAN (expected 8, 10, 12, 13, or 14 digits).',
      );
    }
    return {
      kind: 'gtin',
      gtin,
      ...(titleQuery !== undefined ? { titleQuery } : {}),
      cacheKey: `gtin:${gtin}`,
    };
  }

  if (titleQuery !== undefined) {
    return {
      kind: 'title',
      titleQuery,
      cacheKey: `title:${normalizeTitle(titleQuery)}`,
    };
  }

  throw new ValidationError('Provide a title or an identifier (UPC/ISBN/EAN).');
}
