// src/app/admin/stock/page.tsx
// Label stock — printed labels physically on the shelf. Inside /admin, so it
// inherits the light theme and the layout's auth check.
//
// Two department features (migration 071): stock_view to see this page,
// stock_edit to change the shelf (add, correct, dispatch out, delete).
// Admin holds both. A department without either is sent back to the
// dashboard — there is no reason to advertise a page it can't open.

import { createServerSupabaseClient } from '@/lib/supabase/server';
import { getClaimsUser } from '@/lib/supabase/claims';
import { redirect } from 'next/navigation';
import { getDeptPermissions, canDeptManageStock, canDeptViewStock } from '@/lib/constants/departments';
import LabelStockManager from '@/components/admin/LabelStockManager';
import { deptKeyOf } from '@/lib/identity';

export const dynamic = 'force-dynamic';

export const metadata = {
  title: 'Label Stock',
  robots: { index: false, follow: false },
};

export default async function LabelStockPage() {
  const supabase = await createServerSupabaseClient();
  const user = await getClaimsUser(supabase);
  if (!user) redirect('/login');

  const perms = await getDeptPermissions(deptKeyOf(user));
  if (!canDeptViewStock(perms)) redirect('/admin');

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-[30px] font-semibold leading-9 tracking-[-0.025em] text-brand-ink">Label Stock</h1>
        <p className="mt-1.5 max-w-[72ch] text-sm text-brand-muted">
          Printed labels currently on the shelf. Balances land here on a partial
          dispatch, surplus is added at full dispatch, and marking a row
          dispatched moves it out.
        </p>
      </div>

      <LabelStockManager
        canManage={canDeptManageStock(perms)}
        canClearHistory={Boolean(perms?.isSuperAdmin)}
      />
    </div>
  );
}
