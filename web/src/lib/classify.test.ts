import { describe, expect, it } from 'vitest';
import { classify, EMPTY_INPUT_ERROR, TITLE_TOO_LONG_ERROR } from './classify';

describe('classify', () => {
  it.each(['9780345391803', '978-0-345-39180-3', '0345391802', '034539180X', '045496830434', '12345678', ' 9780345391803 '])(
    '%j → identifier',
    (input) => {
      expect(classify(input)).toEqual({ ok: true, kind: 'identifier', value: input.trim() });
    },
  );

  it.each(['1984', 'Chrono Trigger SNES', '12345'])('%j → title', (input) => {
    expect(classify(input)).toEqual({ ok: true, kind: 'title', value: input });
  });

  it('accepts a 200-character title and rejects 201', () => {
    expect(classify('a'.repeat(200))).toMatchObject({ ok: true, kind: 'title' });
    expect(classify('a'.repeat(201))).toEqual({ ok: false, error: TITLE_TOO_LONG_ERROR });
  });

  it.each(['', '   '])('blank %j → validation error', (input) => {
    expect(classify(input)).toEqual({ ok: false, error: EMPTY_INPUT_ERROR });
  });
});
