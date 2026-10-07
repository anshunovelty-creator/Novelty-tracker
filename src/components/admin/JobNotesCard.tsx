'use client';
// src/components/admin/JobNotesCard.tsx
// Internal notes on the job page — every stage comment on this job, newest
// first, with who wrote it and at which stage. A new note is filed against
// the stage the job is at now. Staff only; never shown on /track.

import { useState } from 'react';
import { Send } from 'lucide-react';
import toast from 'react-hot-toast';
import { formatAdminDate } from '@/lib/utils';
import type { Job, JobDetail, StageComment } from '@/lib/types';
import { useTeamDirectory } from '@/hooks/useReferenceData';
import { MentionText, MentionTextarea } from '@/components/ui/Mention';

const SHOW = 5;

export default function JobNotesCard({
  job, detail, onAdded,
}: {
  job:     Job;
  detail:  JobDetail | null;
  onAdded: (c: StageComment) => void;
}) {
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [all, setAll]   = useState(false);
  const { nameOf } = useTeamDirectory();

  const notes = [...(detail?.stage_comments ?? [])].sort((a, b) => b.created_at.localeCompare(a.created_at));
  const shown = all ? notes : notes.slice(0, SHOW);

  async function post() {
    const comment = text.trim();
    if (!comment) return;
    setBusy(true);
    try {
      const res  = await fetch(`/api/jobs/${job.id}/comments`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ stage: job.status, comment }),
      });
      const data = await res.json();
      if (!res.ok) { toast.error(data.error ?? 'Failed to add the note'); return; }
      onAdded(data.comment);
      setText('');
    } catch {
      toast.error('Network error');
    } finally {
      setBusy(false);
    }
  }

  return (
    <section aria-label="Internal notes" className="flex flex-col gap-3 rounded-2xl border border-brand-border bg-white p-5 shadow-[0_2px_8px_rgba(12,42,32,0.04)]">
      <div className="flex items-baseline justify-between gap-2">
        <h2 className="text-base font-semibold text-brand-ink">Internal notes</h2>
        <span className="text-xs text-brand-muted">Staff only</span>
      </div>

      {!detail ? (
        <div className="h-16 rounded-lg bg-brand-sunken" aria-hidden="true" />
      ) : notes.length === 0 ? (
        <p className="text-[13px] text-brand-muted">No notes yet. Anything the next department should know goes here.</p>
      ) : (
        <ul className="flex flex-col">
          {shown.map((n) => (
            <li key={n.id} className="flex flex-col gap-1 border-b border-brand-line-soft py-3 first:pt-0 last:border-0">
              <div className="flex gap-2 text-xs text-brand-muted">
                <span className="font-semibold text-brand-ink" title={n.created_by_email ?? undefined}>{nameOf(n.created_by_email) || n.created_by}</span>
                <span>· at {n.stage}</span>
                <span className="ml-auto font-mono">{formatAdminDate(n.created_at)}</span>
              </div>
              <p className="whitespace-pre-wrap break-words text-sm leading-relaxed text-brand-ink"><MentionText text={n.comment} /></p>
            </li>
          ))}
        </ul>
      )}
      {notes.length > SHOW && (
        <button type="button" onClick={() => setAll((v) => !v)} className="min-h-11 self-start text-[13px] font-semibold text-brand-primary">
          {all ? 'Show fewer' : `Show all ${notes.length} notes`}
        </button>
      )}

      <div className="flex items-end gap-2">
        <label htmlFor={`note-${job.id}`} className="sr-only">Add a note at {job.status}</label>
        <MentionTextarea
          id={`note-${job.id}`}
          rows={2}
          value={text}
          onValueChange={setText}
          wrapperClassName="flex-1"
          onKeyDown={(e) => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); post(); } }}
          placeholder="Add a note for the floor… type @ to tag someone"
          className="min-h-11 resize-none rounded-xl border border-brand-border bg-brand-surface-alt px-3 py-2.5 text-sm leading-relaxed text-brand-ink placeholder:text-brand-faint focus:border-brand-primary focus:bg-white focus:outline-none focus:shadow-[0_0_0_4px_rgba(16,85,63,0.12)]"
        />
        <button
          type="button"
          onClick={post}
          disabled={busy || !text.trim()}
          aria-label="Post note"
          className="flex h-11 w-11 shrink-0 items-center justify-center rounded-[10px] bg-brand-primary text-white transition-colors hover:bg-brand-primary-hover disabled:opacity-40"
        >
          <Send className="h-4 w-4" aria-hidden="true" />
        </button>
      </div>
    </section>
  );
}
