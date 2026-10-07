// src/app/admin/dies/page.tsx
// The die library — every cutting die the shop owns. Inside /admin, so it
// inherits the light theme and the layout's auth check.
//
// Readable by every department: knowing a die already exists is what stops a
// second one being ordered. Only Prepress and Admin enter or correct records
// — see canDeptManageDiesPlates.

import { createServerSupabaseClient } from '@/lib/supabase/server';
import { getClaimsUser } from '@/lib/supabase/claims';
import { getDeptPermissions, canDeptManageDiesPlates } from '@/lib/constants/departments';
import DiesTabs from '@/components/admin/DiesTabs';
import { deptKeyOf } from '@/lib/identity';

export const dynamic = 'force-dynamic';

export const metadata = {
  title: 'Dies',
  robots: { index: false, follow: false },
};

export default async function DiesPage() {
  const supabase = await createServerSupabaseClient();
  const user = await getClaimsUser(supabase);
  const perms = await getDeptPermissions(deptKeyOf(user));

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-[30px] font-semibold leading-9 tracking-[-0.025em] text-brand-ink">Dies</h1>
        <p className="mt-1.5 max-w-[72ch] text-sm text-brand-muted">
          Find the right die before making a new one. Search by size — it&rsquo;s what you know from the artwork.
        </p>
      </div>

      <DiesTabs canManage={canDeptManageDiesPlates(perms)} />
    </div>
  );
}
