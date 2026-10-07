'use client';
// src/hooks/useJobDetail.ts
// One fetch of GET /api/jobs/[id] — stage timestamps, status logs, stage
// comments and dispatch schedules — shared by the job page's cards (Pipeline,
// Internal notes, Releases) so they don't each load it. Re-fetches when
// `refreshKey` changes; pass job.updated_at so a stage change shows at once.

import { useCallback, useEffect, useState } from 'react';
import type { JobDetail } from '@/lib/types';

export function useJobDetail(jobId: string, refreshKey?: string) {
  const [detail,  setDetail]  = useState<JobDetail | null>(null);
  const [error,   setError]   = useState<string | null>(null);
  const [tick,    setTick]    = useState(0);

  useEffect(() => {
    let live = true;
    (async () => {
      try {
        const res  = await fetch(`/api/jobs/${jobId}`);
        const data = await res.json();
        if (!live) return;
        if (res.ok) { setDetail(data.job); setError(null); }
        else setError(data.error ?? 'Failed to load the job history');
      } catch {
        if (live) setError('Failed to load the job history');
      }
    })();
    return () => { live = false; };
  }, [jobId, refreshKey, tick]);

  const reload = useCallback(() => setTick((t) => t + 1), []);
  return { detail, error, reload, setDetail };
}
