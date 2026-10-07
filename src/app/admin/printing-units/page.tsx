// src/app/admin/printing-units/page.tsx
// Admin-only management of printing units. Inside /admin, so it inherits
// the light theme and the layout's auth check.

import { createServerSupabaseClient } from '@/lib/supabase/server';
import { getClaimsUser } from '@/lib/supabase/claims';
import { getDeptPermissions } from '@/lib/constants/departments';
import PrintingUnitsManager from '@/components/admin/PrintingUnitsManager';
import { deptKeyOf } from '@/lib/identity';

export const dynamic = 'force-dynamic';

export const metadata = {
  title: 'Printing Units',
  robots: { index: false, follow: false },
};

export default async function PrintingUnitsPage() {
  // The write endpoints already reject non-Admins, but gating here too
  // means non-Admins never see a screen whose every control 403s.
  const supabase = await createServerSupabaseClient();
  const user = await getClaimsUser(supabase);
  const perms = await getDeptPermissions(deptKeyOf(user));
  // TODO(dept-migration): this page gates the printing-UNITS master list
  // (create/rename a unit), a distinct concept from 'printing_edit' (who
  // may set a JOB's printing method — Prepress/Production). No named
  // feature_key covers "manage the printing-units list" specifically yet;
  // preserved as super-admin-only for now. Consider adding a
  // 'printing_units_manage' feature_key if this should become grantable.
  const isAdmin = perms?.isSuperAdmin ?? false;

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-[30px] font-semibold leading-9 tracking-[-0.025em] text-brand-ink">Printing Units</h1>
        <p className="mt-1.5 max-w-[72ch] text-sm text-brand-muted">
          Each unit runs one printing method. New jobs start on Flexo and are
          assigned that method&apos;s default unit automatically.
        </p>
      </div>

      {isAdmin ? (
        <PrintingUnitsManager />
      ) : (
        <div className="rounded-xl border border-amber-200 bg-amber-50 p-4">
          <p className="text-sm font-medium text-amber-900">Admin access required</p>
          <p className="text-sm text-amber-800 mt-1">
            Printing units are managed by Admin. Your department is{' '}
            {perms?.displayName ?? 'not recognised'}.
          </p>
        </div>
      )}
    </div>
  );
}
