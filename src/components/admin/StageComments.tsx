'use client';
// src/components/admin/StageComments.tsx

import { useState } from 'react';
import { cn, formatAdminDate } from '@/lib/utils';
import type { StageComment } from '@/lib/types';
import type { Stage } from '@/lib/constants/stages';
import type { Department } from '@/lib/constants/departments';
import toast from 'react-hot-toast';

type Props = {
  jobId:             string;
  stage:             Stage;
  dept:              Department;
  existingComments:  StageComment[];
  onCommentAdded:    (comment: StageComment) => void;
};

export default function StageComments({ jobId, stage, dept, existingComments, onCommentAdded }: Props) {
  const [adding,  setAdding]  = useState(false);
  const [text,    setText]    = useState('');
  const [loading, setLoading] = useState(false);

  async function handleAdd() {
    if (!text.trim()) return;
    setLoading(true);
    try {
      const res = await fetch(`/api/jobs/${jobId}/comments`, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ stage, comment: text.trim() }),
      });
      const data = await res.json();
      if (res.ok) {
        onCommentAdded(data.comment);
        setText('');
        setAdding(false);
      } else {
        toast.error(data.error ?? 'Failed to add comment');
      }
    } catch {
      toast.error('Network error');
    } finally {
      setLoading(false);
    }
  }

  if (!adding) {
    return (
      <button
        onClick={() => setAdding(true)}
        className="text-xs text-brand-muted hover:text-brand-accent transition-colors mt-1"
      >
        + Add internal note
      </button>
    );
  }

  return (
    <div className="mt-2 space-y-2">
      <textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder="Internal note (staff only — never shown to client)…"
        rows={2}
        autoFocus
        className={cn(
          'w-full px-2 py-1.5 rounded-lg border text-xs resize-none',
          'border-brand-border focus:outline-none focus:ring-1 focus:ring-brand-accent/20 focus:border-brand-accent',
          'transition-colors'
        )}
      />
      <div className="flex gap-2">
        <button
          onClick={handleAdd}
          disabled={loading || !text.trim()}
          className="px-3 py-1 text-xs font-medium bg-brand-primary text-white rounded disabled:opacity-40 transition-colors"
        >
          {loading ? 'Adding…' : 'Add Note'}
        </button>
        <button
          onClick={() => { setAdding(false); setText(''); }}
          className="px-3 py-1 text-xs text-brand-muted hover:text-brand-accent transition-colors"
        >
          Cancel
        </button>
      </div>
    </div>
  );
}
