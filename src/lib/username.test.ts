import { describe, it, expect } from 'vitest';
import { normalizeUsername, usernameProblem, suggestUsername, usernameOf, usernameClash, freeUsername } from './username';

describe('username rules', () => {
  it('normalizes what Admin types', () => {
    expect(normalizeUsername('  @Anshu ')).toBe('anshu');
    expect(normalizeUsername(42)).toBe('');
  });
  it('accepts handles and explains bad ones', () => {
    expect(usernameProblem('anshu')).toBeNull();
    expect(usernameProblem('qc_ravi-2')).toBeNull();
    expect(usernameProblem('ab')).toMatch(/at least 3/);
    expect(usernameProblem('a'.repeat(21))).toMatch(/at most 20/);
    expect(usernameProblem('ravi.qc')).toMatch(/lowercase/);
    expect(usernameProblem('_ravi')).toMatch(/start/);
  });
  it('suggests a valid handle from a name or email', () => {
    expect(suggestUsername('Anshu Pal')).toBe('anshu_pal');
    expect(suggestUsername('anshupal320@gmail.com')).toBe('anshupal320');
    expect(suggestUsername('qc@x.in')).toBe('qc1');
    expect(suggestUsername('')).toBe('user');
    for (const s of ['Prepress Team', 'x', 'A very long display name indeed']) expect(usernameProblem(suggestUsername(s))).toBeNull();
  });
  it('prefers the set username, then the old name, then the email', () => {
    expect(usernameOf({ username: 'anshu', name: 'Anshu Pal' }, 'a@x.in')).toBe('anshu');
    expect(usernameOf({ name: 'Prepress Team' }, 'p@x.in')).toBe('prepress_team');
    expect(usernameOf({}, 'dispatch1@x.in')).toBe('dispatch1');
  });
  it('rejects taken handles and department tags', () => {
    const depts = [{ key: 'qc', display_name: 'QC' }, { key: 'prepress', display_name: 'Prepress Team' }];
    expect(usernameClash('ravi', ['anshu'], depts)).toBeNull();
    expect(usernameClash('anshu', ['anshu'], depts)).toMatch(/taken/);
    expect(usernameClash('qc', [], depts)).toMatch(/QC department/);
    expect(usernameClash('prepress_team', [], depts)).toMatch(/Prepress Team/);
  });
});

describe('freeUsername — a blank username never fails the add', () => {
  const depts = [{ key: 'dispatch', display_name: 'Dispatch' }, { key: 'qc', display_name: 'QC' }];
  it('keeps the name made from the email when it is free', () => {
    expect(freeUsername('ravi', ['anshu'], depts)).toBe('ravi');
  });
  it("numbers it past a department's tag", () => {
    expect(freeUsername(suggestUsername('dispatch@novelty.in'), [], depts)).toBe('dispatch2');
  });
  it('numbers it past people who already have it', () => {
    expect(freeUsername('raj', ['raj', 'raj2'], depts)).toBe('raj3');
  });
  it('still fits in 20 characters', () => {
    const long = 'abcdefghijklmnopqrst';
    const u = freeUsername(long, [long], depts);
    expect(u).toBe('abcdefghijklmnopqrs2');
    expect(usernameProblem(u)).toBeNull();
  });
  it('never ends the stem in _ before the number', () => {
    expect(freeUsername('anshu_pal_aaaaaaaaaa', ['anshu_pal_aaaaaaaaaa'], [])).toBe('anshu_pal_aaaaaaaaa2');
    expect(freeUsername('ab_______________cd', ['ab_______________cd'], [])).toBe('ab_______________cd2');
  });
});
