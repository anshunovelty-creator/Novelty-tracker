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
import { getDeptPermissions, canDeptUseBOM, canDeptDecideBOM } from '@/lib/constants/departments';
import BomTabs from '@/components/admin/BomTabs';

export default async function BomPage() {
  const supabase = await createServerSupabaseClient();
  const user = await getClaimsUser(supabase);
  if (!user) redirect('/login');

  const perms = await getDeptPermissions(user.user_metadata?.department);
  if (!canDeptUseBOM(perms)) redirect('/admin');

  const canDecide = canDeptDecideBOM(perms);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold text-[var(--glass-ink)]">Bill of Material</h1>
        <p className="text-sm text-[var(--glass-muted)] mt-1">
          {canDecide
            ? 'Order value against material cost for every job, and the material requests Production sends you.'
            : 'Pick the material, enter its width and running metres, and send Admin a request when stock is needed.'}
        </p>
      </div>
      <BomTabs canDecide={canDecide} />
    </div>
  );
}
