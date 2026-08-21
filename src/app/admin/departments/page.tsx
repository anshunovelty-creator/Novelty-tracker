// src/app/admin/departments/page.tsx
// Create departments and configure exactly which features, job-pipeline
// stages, and print-run stages each one may touch — the admin UI on top
// of migrations 039/040. Super-admin only: this page edits the
// permission system itself, so it's gated on isSuperAdmin rather than
// any single named feature.

import { redirect } from 'next/navigation';
import Link from 'next/link';
import { ArrowLeft } from 'lucide-react';
import { createServerSupabaseClient } from '@/lib/supabase/server';
import { getDeptPermissions } from '@/lib/constants/departments';
import DepartmentsManager from '@/components/admin/DepartmentsManager';

export const dynamic = 'force-dynamic';

export const metadata = {
  title: 'Departments',
  robots: { index: false, follow: false },
};

export default async function DepartmentsPage() {
  const supabase = await createServerSupabaseClient();
  const { data: { user } } = await supabase.auth.getUser();
  const perms = await getDeptPermissions(user?.user_metadata?.department);

  if (!perms?.isSuperAdmin) {
    redirect('/admin');
  }

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
        <h1 className="text-lg font-semibold text-[var(--glass-ink)]">Departments</h1>
        <p className="text-sm text-[var(--glass-muted)] mt-0.5">
          Create departments and choose exactly which features, job-pipeline stages, and
          print-run stages each one can touch. Changes take effect within a minute (or
          immediately on next login) everywhere in the app and in the database itself.
        </p>
      </div>

      <DepartmentsManager />
    </div>
  );
}
