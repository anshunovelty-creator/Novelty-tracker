import { describe, it, expect } from 'vitest';
import { mentionQuery, applyMention, rankOptions, splitMentions, type MentionOption } from './mentionInput';

describe('mentionQuery', () => {
  it('finds the @word at the caret', () => {
    expect(mentionQuery('hi @an', 6)).toEqual({ start: 3, query: 'an' });
    expect(mentionQuery('@', 1)).toEqual({ start: 0, query: '' });
  });
  it('ignores emails and finished words', () => {
    expect(mentionQuery('mail qc@x', 9)).toBeNull();
    expect(mentionQuery('@anshu done', 11)).toBeNull();
  });
});

describe('applyMention', () => {
  it('inserts the handle with a trailing space', () => {
    expect(applyMention('hi @an', 3, 6, 'anshu')).toEqual({ text: 'hi @anshu ', caret: 10 });
  });
  it('replaces the rest of the word and reuses a following space', () => {
    expect(applyMention('hi @anxx there', 3, 6, 'anshu')).toEqual({ text: 'hi @anshu there', caret: 10 });
  });
});

describe('rankOptions', () => {
  const opts: MentionOption[] = [
    { handle: 'qc', hint: 'Department', kind: 'department' },
    { handle: 'ravi', hint: 'QC', kind: 'person' },
    { handle: 'anshu', hint: 'Admin', kind: 'person' },
    { handle: 'aqua', hint: 'Dispatch', kind: 'person' },
  ];
  it('lists people before departments, prefix matches first', () => {
    expect(rankOptions(opts, '').map((o) => o.handle)).toEqual(['anshu', 'aqua', 'ravi', 'qc']);
    expect(rankOptions(opts, 'qc').map((o) => o.handle)).toEqual(['ravi', 'qc']);
    expect(rankOptions(opts, 'an').map((o) => o.handle)).toEqual(['anshu']);
  });
});

describe('splitMentions', () => {
  it('marks tags but not emails', () => {
    expect(splitMentions('@qc check, mail a@x.in @anshu.')).toEqual([
      { text: '@qc', tag: true },
      { text: ' check, mail a@x.in ', tag: false },
      { text: '@anshu', tag: true },
      { text: '.', tag: false },
    ]);
  });
});

describe('# job tags', () => {
  it('finds a #word including - / and .', () => {
    expect(mentionQuery('fix #aug26-1', 12, '#')).toEqual({ start: 4, query: 'aug26-1' });
    expect(mentionQuery('see #3370/A', 11, '#')).toEqual({ start: 4, query: '3370/A' });
    expect(mentionQuery('a&#39', 5, '#')).toBeNull();
    expect(mentionQuery('hi @an', 6, '#')).toBeNull();
  });
  it('inserts the picked Sr No', () => {
    expect(applyMention('fix #aug', 4, 8, 'AUG26-1', '#')).toEqual({ text: 'fix #AUG26-1 ', caret: 13 });
  });
});
