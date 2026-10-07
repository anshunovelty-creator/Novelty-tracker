// src/app/admin/plates/page.tsx
// Plates — the printing plates mounted on press cylinders. Inside /admin, so
// it inherits the light theme and the layout's auth check.
//
// Readable by every department: anyone about to print needs to know whether a
// plate already exists and where it sits. Only Prepress and Admin can change
// the list — see canDeptManageDiesPlates.

import { createServerSupabaseClient } from '@/lib/supabase/server';
import { getClaimsUser } from '@/lib/supabase/claims';
import { getDeptPermissions, canDeptManageDiesPlates } from '@/lib/constants/departments';
import PlatesManager from '@/components/admin/PlatesManager';
import { deptKeyOf } from '@/lib/identity';

export const dynamic = 'force-dynamic';

export const metadata = {
  title: 'Plates',
  robots: { index: false, follow: false },
};

export default async function PlatesPage() {
  const supabase = await createServerSupabaseClient();
  const user = await getClaimsUser(supabase);
  const perms = await getDeptPermissions(deptKeyOf(user));

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-[30px] font-semibold leading-9 tracking-[-0.025em] text-brand-ink">Plates</h1>
        <p className="mt-1.5 max-w-[72ch] text-sm text-brand-muted">
          Plate sets on the racks, with the cylinder they run on. Search here before making a new one.
        </p>
      </div>

      <PlatesManager canManage={canDeptManageDiesPlates(perms)} />
    </div>
  );
}
