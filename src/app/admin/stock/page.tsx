// src/app/admin/stock/page.tsx
// Label stock — printed labels physically on the shelf. Inside /admin, so it
// inherits the light theme and the layout's auth check.
//
// Readable by every department: anyone may need to know whether labels for a
// job already exist before printing more. Only Dispatch and Admin can move
// stock (add, correct, mark dispatched) — see canDeptManageStock.

import Link from 'next/link';
import { ArrowLeft } from 'lucide-react';
import { createServerSupabaseClient } from '@/lib/supabase/server';
import { getDeptPermissions, canDeptManageStock } from '@/lib/constants/departments';
import LabelStockManager from '@/components/admin/LabelStockManager';

export const dynamic = 'force-dynamic';

export const metadata = {
  title: 'Label Stock',
  robots: { index: false, follow: false },
};

export default async function LabelStockPage() {
  const supabase = await createServerSupabaseClient();
  const { data: { user } } = await supabase.auth.getUser();
  const perms = await getDeptPermissions(user?.user_metadata?.department);

  return (
    <div className="space-y-4">
      <Link
        href="/admin"
        className="inline-flex min-h-11 items-center gap-1.5 text-sm text-[var(--glass-muted)] hover:text-[var(--glass-ink)]"
      >
        <ArrowLeft className="h-4 w-4" aria-hidden="true" />
        Back to dashboard
      </Link>

      <div>
        <h1 className="text-lg font-semibold text-[var(--glass-ink)]">Label Stock</h1>
        <p className="text-sm text-[var(--glass-muted)] mt-0.5">
          Printed labels currently on the shelf. Balances land here on a partial
          dispatch, surplus is added at full dispatch, and marking a row
          dispatched moves it out.
        </p>
      </div>

      <LabelStockManager canManage={canDeptManageStock(perms)} />
    </div>
  );
}
