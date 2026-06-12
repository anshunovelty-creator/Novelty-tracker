// src/app/admin/jobs/[id]/page.tsx
// Server component — fetches job server-side so direct URL sharing works.
// Auth guard is inherited from admin/layout.tsx.

import Link from 'next/link';
import { redirect } from 'next/navigation';
import { createServerSupabaseClient } from '@/lib/supabase/server';
import { parseDepartment } from '@/lib/constants/departments';
import JobDetailClient from '@/components/admin/JobDetailClient';
import type { Job } from '@/lib/types';

type Props = {
  params: Promise<{ id: string }>;
};

export default async function JobDetailPage({ params }: Props) {
  const { id } = await params;
  const supabase = await createServerSupabaseClient();

  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect('/login');

  const dept = parseDepartment(user.user_metadata?.department);
  if (!dept) redirect('/login');

  const { data: job, error } = await supabase
    .from('jobs')
    .select('*, job_stage_timestamps(stage)')
    .eq('id', id)
    .single();

  if (error || !job) {
    return (
      <div className="flex flex-col items-center justify-center py-24 gap-3 text-center">
        <p className="text-brand-accent font-medium">Job not found</p>
        <p className="text-sm text-brand-muted">
          No job exists with this ID, or it may have been deleted.
        </p>
        <Link
          href="/admin"
          className="mt-2 text-sm text-brand-accent underline underline-offset-2 hover:opacity-70 transition-opacity"
        >
          ← Back to Dashboard
        </Link>
      </div>
    );
  }

  return <JobDetailClient initialJob={job as Job} dept={dept} />;
}
