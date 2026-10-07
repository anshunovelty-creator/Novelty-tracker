'use client';
// src/components/admin/NotYourStageToast.tsx
// Shown when the server refuses a stage change because the stage belongs to
// another department. Says who can, and offers the useful next step — leave
// that department a note on the job — instead of a dead-end error. The row
// itself never moved (the change only lands on success), so nothing has to
// snap back.

import Link from 'next/link';
import toast from 'react-hot-toast';
import { Lock } from 'lucide-react';

export function showNotYourStage({ title, signedInAs, jobId }: { title: string; signedInAs?: string; jobId: string }) {
  toast.custom(
    (t) => (
      <div
        role="alert"
        className="flex w-[min(92vw,460px)] items-start gap-3.5 rounded-[14px] bg-[#0C2A20] px-[18px] py-4 text-[#EAFFF5] shadow-[0_12px_32px_rgba(0,0,0,0.2)]"
      >
        <Lock className="mt-0.5 h-5 w-5 shrink-0 text-brand-mint" aria-hidden="true" />
        <div className="flex min-w-0 flex-1 flex-col gap-1">
          <strong className="text-[15px] font-semibold">{title}</strong>
          <span className="text-sm text-[#9FBCB0]">
            {signedInAs ? `You’re signed in as ${signedInAs}. ` : ''}Leave a note and they’ll see it right away.
          </span>
        </div>
        <Link
          href={`/admin/jobs/${jobId}#note-${jobId}`}
          onClick={() => toast.dismiss(t.id)}
          className="flex min-h-10 shrink-0 items-center whitespace-nowrap rounded-[10px] bg-white/10 px-3 text-[13px] font-semibold text-brand-mint transition-colors hover:bg-white/[0.16]"
        >
          Leave a note
        </Link>
      </div>
    ),
    { duration: 8000 },
  );
}
