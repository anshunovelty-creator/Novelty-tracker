// src/app/admin/job-separation/page.tsx
// The live Job Separation worksheet — every PO line item split out for job
// cards. Inside /admin, so it inherits the light theme and the layout's
// auth check.
//
// Readable by every department: this is the shop's shared view of what's
// been split off each PO. Only Prepress and Admin enter or correct rows
// — see canDeptManageJobSeparation.

import { createServerSupabaseClient } from '@/lib/supabase/server';
import { getClaimsUser } from '@/lib/supabase/claims';
import { getDeptPermissions, canDeptManageJobSeparation, canDeptManagePrepressTodo, canDeptUseMeterCalculator, canDeptSeeMoneyTotals } from '@/lib/constants/departments';
import JobSeparationManager from '@/components/admin/JobSeparationManager';
import { deptKeyOf } from '@/lib/identity';

export const dynamic = 'force-dynamic';

export const metadata = {
  title: 'Job Separation',
  robots: { index: false, follow: false },
};

export default async function JobSeparationPage() {
  const supabase = await createServerSupabaseClient();
  const user = await getClaimsUser(supabase);
  const perms = await getDeptPermissions(deptKeyOf(user));

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-[30px] font-semibold leading-9 tracking-[-0.025em] text-brand-ink">Job Separation</h1>
        <p className="mt-1.5 max-w-[72ch] text-sm text-brand-muted">
          Every PO split into job entries, live for the whole shop. Anyone can
          search the worksheet; Prepress and Admin add and correct rows.
        </p>
      </div>

      <JobSeparationManager
        canManage={canDeptManageJobSeparation(perms)}
        canManageTodo={canDeptManagePrepressTodo(perms)}
        canUseMeterCalculator={canDeptUseMeterCalculator(perms)}
        canSeeTotal={canDeptSeeMoneyTotals(perms)}
        dept={perms?.key ?? null}
      />
    </div>
  );
}
