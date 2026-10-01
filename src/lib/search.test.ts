// src/lib/search.test.ts
// The PostgREST filter strings the search boxes send. Size matching is the
// one the floor relies on: a die's length or width is found by its whole
// millimetre, whether the stored value or the search carries decimals.

import { describe, expect, it } from 'vitest';
import { containsPattern, orContains, orMatch, sizePatterns } from './search';

describe('sizePatterns', () => {
  it('matches the whole millimetre and anything after its decimal point', () => {
    expect(sizePatterns('210')).toEqual(['210', '210.%']);
  });

  it('drops the decimals from what is typed, so 210.84 finds 210 too', () => {
    expect(sizePatterns('210.84')).toEqual(['210', '210.%']);
    expect(sizePatterns('210.')).toEqual(['210', '210.%']);
  });

  it('ignores surrounding spaces and leading zeros', () => {
    expect(sizePatterns(' 082 ')).toEqual(['82', '82.%']);
    expect(sizePatterns('0')).toEqual(['0', '0.%']);
  });

  it('falls back to the whole value for text that is not a number', () => {
    expect(sizePatterns('abc')).toEqual(['abc']);
    expect(sizePatterns('50%')).toEqual(['50\\%']);
  });
});

/** Does a stored value match a LIKE pattern (case-insensitive), as Postgres would? */
function like(value: string, pattern: string): boolean {
  let re = '';
  for (let i = 0; i < pattern.length; i++) {
    const ch = pattern[i];
    if (ch === '\\') re += pattern[++i].replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    else if (ch === '%') re += '.*';
    else if (ch === '_') re += '.';
    else re += ch.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }
  return new RegExp(`^${re}$`, 'i').test(value);
}
const sizeMatches = (stored: string, typed: string) => sizePatterns(typed).some((p) => like(stored, p));

describe('size matching against stored values', () => {
  it('treats 210 and 210.84 as the same size, either way round', () => {
    expect(sizeMatches('210.84', '210')).toBe(true);
    expect(sizeMatches('210', '210.84')).toBe(true);
    expect(sizeMatches('210', '210')).toBe(true);
    expect(sizeMatches('210.5', '210.84')).toBe(true);
  });

  it('does not match other sizes that merely contain the digits', () => {
    expect(sizeMatches('1210', '210')).toBe(false);
    expect(sizeMatches('2100', '210')).toBe(false);
    expect(sizeMatches('211.84', '210')).toBe(false);
    expect(sizeMatches('21.084', '210')).toBe(false);
  });
});

describe('orMatch', () => {
  it('ORs contains-matches and size-matches into one quoted filter', () => {
    expect(orMatch(['shape'], ['length', 'width'], '87')).toBe(
      'shape.ilike."%87%",length.ilike."87",length.ilike."87.%",width.ilike."87",width.ilike."87.%"',
    );
  });

  it('keeps orContains output unchanged for the other searches', () => {
    expect(orContains(['party', 'job_name'], 'ABC, Ltd')).toBe('party.ilike."%ABC, Ltd%",job_name.ilike."%ABC, Ltd%"');
    expect(containsPattern('50%')).toBe('%50\\%%');
  });
});
