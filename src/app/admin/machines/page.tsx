// src/app/admin/machines/page.tsx
// Machines: live cards, the chosen machine's queue (drag to reorder), this
// month's utilisation, and the date-range utilisation report below. Inside
// /admin, so it inherits the light theme and the layout's auth check.

import { getMachineUtilisation, istToday, istDaysBefore } from '@/lib/api/machineAnalytics';
import { createServerSupabaseClient } from '@/lib/supabase/server';
import { getClaimsUser } from '@/lib/supabase/claims';
import { getDeptPermissions, canDeptManageMachineBoard } from '@/lib/constants/departments';
import MachinesView from '@/components/admin/MachinesView';
import MachineUtilisationReport from '@/components/admin/MachineUtilisationReport';
import { deptKeyOf } from '@/lib/identity';

export const dynamic = 'force-dynamic';

export const metadata = {
  title: 'Machines',
  robots: { index: false, follow: false },
};

export default async function MachinesPage() {
  const supabase = await createServerSupabaseClient();
  const user  = await getClaimsUser(supabase);
  const perms = await getDeptPermissions(deptKeyOf(user));

  // Month to date for the card; the last 7 IST days for the report's default.
  const today = istToday();
  const [month, week] = await Promise.all([
    getMachineUtilisation(`${today.slice(0, 8)}01`, today),
    getMachineUtilisation(istDaysBefore(today, 6), today),
  ]);

  return (
    <div className="flex flex-col gap-10">
      <MachinesView canManage={canDeptManageMachineBoard(perms)} utilisation={month} />

      <section aria-labelledby="util-report-title" className="flex flex-col gap-4">
        <div className="flex flex-col gap-1">
          <h2 id="util-report-title" className="text-lg font-semibold text-brand-ink">Utilisation report</h2>
          <p className="max-w-[72ch] text-sm text-brand-muted">
            What each machine did over any dates you pick, and how close the finish estimates came.
          </p>
        </div>
        <MachineUtilisationReport initial={week} />
      </section>
    </div>
  );
}
