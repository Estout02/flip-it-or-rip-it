import { describe, expect, it } from 'vitest';
import { identify, ValidationError } from './identify.js';

describe('identify — identifier path', () => {
  it('strips hyphens and spaces from a scanned code', () => {
    const query = identify({ identifier: '978-0-345-39180 3' });
    expect(query.kind).toBe('gtin');
    expect(query.gtin).toBe('9780345391803');
  });

  it('classifies an EAN-8', () => {
    expect(identify({ identifier: '96385074' }).gtin).toBe('96385074');
  });

  it('classifies a UPC-A (12 digits)', () => {
    expect(identify({ identifier: '045496830434' }).gtin).toBe('045496830434');
  });

  it('classifies an EAN/ISBN-13', () => {
    expect(identify({ identifier: '9780345391803' }).gtin).toBe('9780345391803');
  });

  it('classifies a GTIN-14', () => {
    expect(identify({ identifier: '00012345678905' }).gtin).toBe('00012345678905');
  });

  it('converts ISBN-10 to ISBN-13 with a recomputed check digit', () => {
    // Hitchhiker's Guide: ISBN-10 0345391802 → ISBN-13 9780345391803
    expect(identify({ identifier: '0-345-39180-2' }).gtin).toBe('9780345391803');
  });

  it('converts an ISBN-10 with an X check digit', () => {
    expect(identify({ identifier: '155404295X' }).gtin).toBe('9781554042951');
  });

  it('builds the cache key as gtin:<digits>', () => {
    expect(identify({ identifier: '9780345391803' }).cacheKey).toBe('gtin:9780345391803');
  });

  it.each(['not-a-barcode!', '12345', '12345678901a', '979_0345391803', ''])(
    'rejects malformed identifier %j',
    (identifier) => {
      expect(() => identify({ identifier })).toThrow(ValidationError);
    },
  );

  it('rejects a malformed identifier even when a title is present', () => {
    expect(() => identify({ identifier: 'nope!', title: 'Some Item' })).toThrow(
      ValidationError,
    );
  });

  it('rejects when both identifier and title are missing', () => {
    expect(() => identify({})).toThrow(ValidationError);
  });
});

describe('identify — title path (US2)', () => {
  it('classifies a title-only input with the original casing preserved', () => {
    const query = identify({ title: 'Chrono Trigger SNES' });
    expect(query.kind).toBe('title');
    expect(query.titleQuery).toBe('Chrono Trigger SNES');
    expect(query.gtin).toBeUndefined();
  });

  it('normalizes the cache key: lowercased, trimmed, whitespace-collapsed', () => {
    const query = identify({ title: '  CHRONO  Trigger\tSNES ' });
    expect(query.cacheKey).toBe('title:chrono trigger snes');
    expect(query.titleQuery).toBe('CHRONO  Trigger\tSNES');
  });

  it('produces the same cache key across casing/whitespace variants (FR-011)', () => {
    const a = identify({ title: 'Chrono Trigger SNES' });
    const b = identify({ title: 'CHRONO  TRIGGER snes' });
    expect(a.cacheKey).toBe(b.cacheKey);
  });

  it('accepts a 1-char title and a 200-char title', () => {
    expect(identify({ title: 'x' }).kind).toBe('title');
    expect(identify({ title: 'y'.repeat(200) }).kind).toBe('title');
  });

  it('rejects a title over 200 chars after trim', () => {
    expect(() => identify({ title: `  ${'z'.repeat(201)}  ` })).toThrow(ValidationError);
  });

  it('treats a whitespace-only title as missing', () => {
    expect(() => identify({ title: '   ' })).toThrow(ValidationError);
  });

  it('keeps identifier precedence but retains the title for fallback (US2-AS3)', () => {
    const query = identify({ identifier: '9780345391803', title: 'Hitchhiker Guide' });
    expect(query.kind).toBe('gtin');
    expect(query.gtin).toBe('9780345391803');
    expect(query.titleQuery).toBe('Hitchhiker Guide');
    expect(query.cacheKey).toBe('gtin:9780345391803');
  });
});
