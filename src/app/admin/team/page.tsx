// src/app/admin/team/page.tsx
// Who can log in, and as which department. Admin-only — unlike Dies, Stock
// or Plates, there's no read-only view for other departments here, so the
// page itself redirects anyone who isn't Admin rather than just hiding a
// button (the API route enforces the same thing independently).

import { redirect } from 'next/navigation';
import { createServerSupabaseClient } from '@/lib/supabase/server';
import { getClaimsUser } from '@/lib/supabase/claims';
import { getDeptPermissions, canDeptManageTeam } from '@/lib/constants/departments';
import TeamManager from '@/components/admin/TeamManager';
import AdminSectionNav from '@/components/admin/AdminSectionNav';
import { deptKeyOf } from '@/lib/identity';

export const dynamic = 'force-dynamic';

export const metadata = {
  title: 'Team',
  robots: { index: false, follow: false },
};

export default async function TeamPage() {
  const supabase = await createServerSupabaseClient();
  const user = await getClaimsUser(supabase);
  const perms = await getDeptPermissions(deptKeyOf(user));

  if (!canDeptManageTeam(perms)) {
    redirect('/admin');
  }

  return (
    <div className="flex flex-col gap-6">
      {perms?.isSuperAdmin && <AdminSectionNav />}
      <div className="flex flex-col gap-1.5">
        <h1 className="text-[30px] font-semibold leading-9 tracking-[-0.025em] text-brand-ink">Team</h1>
        <p className="max-w-[72ch] text-sm text-brand-muted">
          Who can sign in, and as which department. The department decides what they can change.
        </p>
      </div>

      <TeamManager currentUserId={user!.id} />
    </div>
  );
}
