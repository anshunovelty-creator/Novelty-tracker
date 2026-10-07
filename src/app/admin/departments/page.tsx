// src/app/admin/departments/page.tsx
// Create departments and configure exactly which features, job-pipeline
// stages, and print-run stages each one may touch — the admin UI on top
// of migrations 039/040. Super-admin only: this page edits the
// permission system itself, so it's gated on isSuperAdmin rather than
// any single named feature.

import { redirect } from 'next/navigation';
import { createServerSupabaseClient } from '@/lib/supabase/server';
import { getClaimsUser } from '@/lib/supabase/claims';
import { getDeptPermissions } from '@/lib/constants/departments';
import DepartmentsManager from '@/components/admin/DepartmentsManager';
import AdminSectionNav from '@/components/admin/AdminSectionNav';
import { deptKeyOf } from '@/lib/identity';

export const dynamic = 'force-dynamic';

export const metadata = {
  title: 'Departments',
  robots: { index: false, follow: false },
};

export default async function DepartmentsPage() {
  const supabase = await createServerSupabaseClient();
  const user = await getClaimsUser(supabase);
  const perms = await getDeptPermissions(deptKeyOf(user));

  if (!perms?.isSuperAdmin) {
    redirect('/admin');
  }

  return (
    <div className="flex flex-col gap-6">
      <AdminSectionNav />
      <div className="flex flex-col gap-1.5">
        <h1 className="text-[30px] font-semibold leading-9 tracking-[-0.025em] text-brand-ink">Departments</h1>
        <p className="max-w-[72ch] text-sm text-brand-muted">
          What each department may change. The server checks this on every request — the screen only hides buttons.
          Changes apply within a minute, or at next sign-in.
        </p>
      </div>

      <DepartmentsManager />
    </div>
  );
}
