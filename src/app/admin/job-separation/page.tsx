// src/app/admin/job-separation/page.tsx
// The live Job Separation worksheet — every PO line item split out for job
// cards. Inside /admin, so it inherits the light theme and the layout's
// auth check.
//
// Readable by every department: this is the shop's shared view of what's
// been split off each PO. Only Prepress and Admin enter or correct rows
// — see canDeptManageJobSeparation.

import { createServerSupabaseClient } from '@/lib/supabase/server';
import { getDeptPermissions, canDeptManageJobSeparation, canDeptManagePrepressTodo, canDeptUseMeterCalculator } from '@/lib/constants/departments';
import JobSeparationManager from '@/components/admin/JobSeparationManager';

export const dynamic = 'force-dynamic';

export const metadata = {
  title: 'Job Separation',
  robots: { index: false, follow: false },
};

export default async function JobSeparationPage() {
  const supabase = await createServerSupabaseClient();
  const { data: { user } } = await supabase.auth.getUser();
  const perms = await getDeptPermissions(user?.user_metadata?.department);

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-xl font-semibold text-[var(--glass-ink)]">Job Separation</h1>
        <p className="text-sm text-[var(--glass-muted)] mt-0.5">
          Every PO split into job entries, live for the whole shop. Anyone can
          search the worksheet; Prepress and Admin add and correct rows.
        </p>
      </div>

      <JobSeparationManager
        canManage={canDeptManageJobSeparation(perms)}
        canManageTodo={canDeptManagePrepressTodo(perms)}
        canUseMeterCalculator={canDeptUseMeterCalculator(perms)}
        dept={perms?.key ?? null}
      />
    </div>
  );
}
