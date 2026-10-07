// src/app/admin/bom/page.tsx
// Server component — Production + Admin gate for Bill of Material: Job
// Separation's orders priced against their raw material, and the material
// requests the floor sends the owner from that sheet.
//
// Mirrors /admin/register and /admin/team: a department that may not open
// this is bounced to the dashboard rather than shown an access-denied page,
// since there's no reason to advertise a section they'll never open. The
// same rule is enforced again in every /api/bom-requests route and once
// more by RLS on the bom_* tables.

import { redirect } from 'next/navigation';
import { createServerSupabaseClient } from '@/lib/supabase/server';
import { getClaimsUser } from '@/lib/supabase/claims';
import { getDeptPermissions, canDeptUseBOM, canDeptDecideBOM, canDeptManagePaperStock, canDeptSeeMoneyTotals } from '@/lib/constants/departments';
import BomTabs from '@/components/admin/BomTabs';
import { deptKeyOf } from '@/lib/identity';

export default async function BomPage() {
  const supabase = await createServerSupabaseClient();
  const user = await getClaimsUser(supabase);
  if (!user) redirect('/login');

  const perms = await getDeptPermissions(deptKeyOf(user));
  if (!canDeptUseBOM(perms)) redirect('/admin');

  const canDecide = canDeptDecideBOM(perms);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-[30px] font-semibold leading-9 tracking-[-0.025em] text-brand-ink">Bill of Material</h1>
        <p className="text-sm text-[var(--glass-muted)] mt-1">
          {canDecide
            ? 'Order value against material cost for every job, and the material requests Production sends you.'
            : 'Pick the material, enter its width and running metres, use paper from stock when it’s there, and send Admin a request when it isn’t.'}
        </p>
      </div>
      <BomTabs canDecide={canDecide} canManageStock={canDeptManagePaperStock(perms)} canSeeTotals={canDeptSeeMoneyTotals(perms)} />
    </div>
  );
}
