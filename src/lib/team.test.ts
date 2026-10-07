import { describe, expect, it } from 'vitest';
import { cleanName, initials, signedInWords } from './team';

describe('cleanName', () => {
  it('trims, caps and drops blanks', () => {
    expect(cleanName('  Ravi  ')).toBe('Ravi');
    expect(cleanName('   ')).toBeNull();
    expect(cleanName(42)).toBeNull();
    expect(cleanName('x'.repeat(80))).toHaveLength(60);
  });
});

describe('initials', () => {
  it('takes the first two words, or the email name', () => {
    expect(initials('Prepress Team')).toBe('PT');
    expect(initials('qc@noveltylabels.in')).toBe('QC');
    expect(initials('unit1.floor@x.in')).toBe('UF');
    expect(initials('Viewer (read-only)')).toBe('VR');
  });
});

describe('signedInWords', () => {
  const now = new Date('2026-10-05T10:00:00Z');
  const ago = (m: number) => new Date(now.getTime() - m * 60_000).toISOString();
  it('says how long ago, and whether it was today', () => {
    expect(signedInWords(null, now)).toEqual({ text: 'Never signed in', recent: false });
    expect(signedInWords(ago(1), now).text).toBe('Signed in just now');
    expect(signedInWords(ago(12), now)).toEqual({ text: 'Signed in 12 min ago', recent: true });
    expect(signedInWords(ago(180), now).text).toBe('Signed in 3 h ago');
    expect(signedInWords(ago(60 * 24 * 4), now)).toEqual({ text: 'Signed in 4 days ago', recent: false });
    expect(signedInWords(ago(60 * 24 * 1), now).text).toBe('Signed in 1 day ago');
  });
});
