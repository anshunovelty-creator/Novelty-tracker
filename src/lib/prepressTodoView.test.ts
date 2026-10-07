import { describe, it, expect } from 'vitest';
import { jobTags, splitTags, groupTodos, tagOption, tagLink, type TagRow } from './prepressTodoView';
import type { PrepressTodo } from './types';

const todo = (id: string, task: string, marked_read_at: string | null = null): PrepressTodo =>
  ({ id, task, created_by: 'prepress', created_at: '2026-10-01T00:00:00Z', marked_read_at });

describe('jobTags', () => {
  it('finds #job tags', () => {
    expect(jobTags('Remake magenta plate #SEP26-41 and #PO3370')).toEqual(['SEP26-41', 'PO3370']);
    expect(jobTags('#OCT26-15')).toEqual(['OCT26-15']);
  });
  it('ignores a lone #, HTML entities and repeats', () => {
    expect(jobTags('Order 2 # cylinders')).toEqual([]);
    expect(jobTags('a&#39;b')).toEqual([]);
    expect(jobTags('#A1 then #A1')).toEqual(['A1']);
  });
});

describe('splitTags', () => {
  it('keeps the text around each tag', () => {
    expect(splitTags('Send AW #OCT26-15 today.')).toEqual([
      { text: 'Send AW ' }, { text: '#OCT26-15', tag: 'OCT26-15' }, { text: ' today.' },
    ]);
  });
});

describe('groupTodos', () => {
  const now = new Date(2026, 9, 6, 15);
  it('puts job-tagged open tasks first and splits done by day', () => {
    const g = groupTodos([
      todo('1', 'Re-label rack B'),
      todo('2', 'Plate for #OCT26-14'),
      todo('3', 'Done now', new Date(2026, 9, 6, 9).toISOString()),
      todo('4', 'Done before', new Date(2026, 9, 2, 9).toISOString()),
    ], now);
    expect(g.blocking.map((t) => t.id)).toEqual(['2']);
    expect(g.general.map((t) => t.id)).toEqual(['1']);
    expect(g.doneToday.map((t) => t.id)).toEqual(['3']);
    expect(g.doneEarlier.map((t) => t.id)).toEqual(['4']);
  });
});

describe('job separation tags', () => {
  const row = (over: Partial<TagRow> = {}): TagRow => ({
    id: 's1', sr_no: 'AUG26-1', party: 'Tapi Pharma', po_no: '905', pm_code: 'PM9', material_name: 'Ointment label',
    linked_job_id: null, linked_job_card_number: null, cancelled_at: null, ...over,
  });
  it('names a row for the # list', () => {
    expect(tagOption(row())).toEqual({ handle: 'AUG26-1', hint: 'Tapi Pharma · Ointment label', kind: 'job' });
    expect(tagOption(row({ material_name: null, linked_job_card_number: 'AUG26-4' })).hint).toBe('Tapi Pharma · PM9 · Job AUG26-4');
  });
  it('links to the job once made, else to the Job Separation row', () => {
    const made = new Map([['AUG26-1', row({ linked_job_id: 'j1', linked_job_card_number: 'AUG26-4' })]]);
    expect(tagLink('aug26-1', made)).toMatchObject({ href: '/admin/jobs/j1', known: true });
    const notMade = new Map([['AUG26-1', row()]]);
    expect(tagLink('AUG26-1', notMade)).toMatchObject({ href: '/admin/job-separation?q=AUG26-1', known: true });
  });
  it('falls back to a dashboard search for unknown tags', () => {
    expect(tagLink('PO3370', new Map())).toMatchObject({ href: '/admin?q=PO3370', known: false });
  });
});
