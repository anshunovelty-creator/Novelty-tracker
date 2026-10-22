// src/app/admin/cylinders/page.tsx
// Cylinders — the press cylinders plates and dies run on. Readable by every
// department; only those with the cylinders_edit feature (and Admin) can
// change the list — see canDeptManageCylinders.

import { createServerSupabaseClient } from '@/lib/supabase/server';
import { getClaimsUser } from '@/lib/supabase/claims';
import { getDeptPermissions, canDeptManageCylinders } from '@/lib/constants/departments';
import CylindersManager from '@/components/admin/CylindersManager';
import { deptKeyOf } from '@/lib/identity';

export const dynamic = 'force-dynamic';

export const metadata = {
  title: 'Cylinders',
  robots: { index: false, follow: false },
};

export default async function CylindersPage() {
  const supabase = await createServerSupabaseClient();
  const user = await getClaimsUser(supabase);
  const perms = await getDeptPermissions(deptKeyOf(user));

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-[30px] font-semibold leading-9 tracking-[-0.025em] text-brand-ink">Cylinders</h1>
        <p className="mt-1.5 max-w-[72ch] text-sm text-brand-muted">
          Every press cylinder by serial number, with its teeth and repeat length. Check here before ordering a new one.
        </p>
      </div>

      <CylindersManager canManage={canDeptManageCylinders(perms)} />
    </div>
  );
}
