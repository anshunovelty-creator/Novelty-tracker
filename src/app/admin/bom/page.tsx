// src/app/admin/bom/page.tsx
// Server component — Production + Admin gate for Bill of Material, the
// material requisitions Production used to raise by mailing the owner.
//
// Mirrors /admin/register and /admin/team: a department that may not open
// this is bounced to the dashboard rather than shown an access-denied page,
// since there's no reason to advertise a section they'll never open. The
// same rule is enforced again in every /api/bom-requests route and once
// more by RLS on the bom_* tables.

import { redirect } from 'next/navigation';
import { createServerSupabaseClient } from '@/lib/supabase/server';
import { getDeptPermissions, canDeptUseBOM, canDeptDecideBOM } from '@/lib/constants/departments';
import BomManager from '@/components/admin/BomManager';

export default async function BomPage() {
  const supabase = await createServerSupabaseClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect('/login');

  const perms = await getDeptPermissions(user.user_metadata?.department);
  if (!canDeptUseBOM(perms)) redirect('/admin');

  const canDecide = canDeptDecideBOM(perms);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-[var(--glass-ink)]">Bill of Material</h1>
        <p className="text-sm text-[var(--glass-muted)] mt-1">
          {canDecide
            ? 'Material requests from Production — order, part-order, substitute, or decline each line.'
            : 'Request paper, rolls and other raw material. Admin answers each line here.'}
        </p>
      </div>
      <BomManager canDecide={canDecide} />
    </div>
  );
}
