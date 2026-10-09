import { describe, it, expect } from 'vitest';
import { mentions, filterNotes, dayLabel, groupByDay, parseNoteId, canEditNote, EDIT_WINDOW_MS, isNewerThan } from './notesView';

const note = (id: string, comment: string, created_at: string, by: string | null = 'a@x.in') =>
  ({ id, comment, created_at, created_by_email: by });

describe('mentions', () => {
  it('matches a tagged department without case or punctuation', () => {
    expect(mentions('Hold 2 rolls, @QC please check', ['QC'])).toBe(true);
    expect(mentions('@qc ping', ['QC'])).toBe(true);
    expect(mentions('@prepress-team revised AW', ['Prepress Team'])).toBe(true);
  });
  it('ignores untagged names and emails', () => {
    expect(mentions('QC will check', ['QC'])).toBe(false);
    expect(mentions('mail qc@novelty.in', ['novelty'])).toBe(false);
    expect(mentions('@Dispatch', ['QC'])).toBe(false);
  });
});

describe('filterNotes', () => {
  const notes = [note('1', '@QC look', '2026-10-05T05:00:00Z'), note('2', 'mine', '2026-10-05T04:00:00Z', 'me@x.in'), note('3', 'old', '2026-10-04T04:00:00Z')];
  const read = new Set(['3']);
  const opts = { isRead: (n: { id: string }) => read.has(n.id), me: 'me@x.in', myNames: ['QC'] };
  it('unread leaves out read notes and my own', () => {
    expect(filterNotes(notes, 'unread', opts).map((n) => n.id)).toEqual(['1']);
  });
  it('mentions keeps notes that tag me', () => {
    expect(filterNotes(notes, 'mentions', opts).map((n) => n.id)).toEqual(['1']);
  });
  it('all keeps everything', () => {
    expect(filterNotes(notes, 'all', opts)).toHaveLength(3);
  });
  it('mentions keeps replies to my notes, untagged, but not my own replies', () => {
    const replies = [
      { ...note('4', 'done', '2026-10-05T06:00:00Z'), reply_to: { created_by_email: 'me@x.in' } },
      { ...note('5', 'me again', '2026-10-05T07:00:00Z', 'me@x.in'), reply_to: { created_by_email: 'me@x.in' } },
    ];
    expect(filterNotes(replies, 'mentions', opts).map((n) => n.id)).toEqual(['4']);
  });
});

describe('days', () => {
  const now = new Date(2026, 9, 5, 15, 0);
  it('labels today, yesterday and older days', () => {
    expect(dayLabel(new Date(2026, 9, 5, 9).toISOString(), now)).toBe('Today');
    expect(dayLabel(new Date(2026, 9, 4, 23).toISOString(), now)).toBe('Yesterday');
    expect(dayLabel(new Date(2026, 9, 1, 12).toISOString(), now)).toBe('01 Oct');
  });
  it('groups consecutive notes under one heading', () => {
    const g = groupByDay([
      note('1', '', new Date(2026, 9, 5, 10).toISOString()),
      note('2', '', new Date(2026, 9, 5, 9).toISOString()),
      note('3', '', new Date(2026, 9, 4, 18).toISOString()),
    ], now);
    expect(g.map((x) => [x.label, x.notes.length])).toEqual([['Today', 2], ['Yesterday', 1]]);
  });
});

describe('parseNoteId', () => {
  it('accepts a note id and nothing else', () => {
    expect(parseNoteId('0b5c6f9e-1d2a-4c3b-9e8f-7a6b5c4d3e2f')).toBe('0b5c6f9e-1d2a-4c3b-9e8f-7a6b5c4d3e2f');
    expect(parseNoteId('not-a-uuid')).toBeNull();
    expect(parseNoteId(42)).toBeNull();
    expect(parseNoteId(undefined)).toBeNull();
  });
});

describe('canEditNote', () => {
  const at = '2026-10-09T05:00:00Z';
  const now = Date.parse(at);
  const note = { created_by_email: 'me@x.in', created_at: at };
  it('lets the author edit within the window', () => {
    expect(canEditNote(note, 'me@x.in', now + 60_000)).toBe(true);
    expect(canEditNote(note, 'me@x.in', now + EDIT_WINDOW_MS)).toBe(true);
  });
  it('refuses after the window, or anyone but the author', () => {
    expect(canEditNote(note, 'me@x.in', now + EDIT_WINDOW_MS + 1)).toBe(false);
    expect(canEditNote(note, 'other@x.in', now + 60_000)).toBe(false);
    expect(canEditNote({ ...note, created_by_email: null }, '', now)).toBe(false);
  });
});

describe('isNewerThan', () => {
  const seen = Date.parse('2026-10-09T05:00:00Z');
  it('a note posted after the last one seen is new', () => {
    expect(isNewerThan('2026-10-09T05:00:01Z', seen)).toBe(true);
  });
  it('the same or an older note is not — e.g. the next-newest after an admin delete', () => {
    expect(isNewerThan('2026-10-09T05:00:00Z', seen)).toBe(false);
    expect(isNewerThan('2026-10-08T11:09:00Z', seen)).toBe(false);
  });
  it('anything is newer than nothing seen yet', () => {
    expect(isNewerThan('2026-10-09T05:00:00Z', null)).toBe(true);
  });
});
