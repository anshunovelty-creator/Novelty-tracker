// src/app/admin/printing-units/page.tsx
// Admin-only management of printing units. Inside /admin, so it inherits
// the light theme and the layout's auth check.

import Link from 'next/link';
import { ArrowLeft } from 'lucide-react';
import { createServerSupabaseClient } from '@/lib/supabase/server';
import { parseDepartment } from '@/lib/constants/departments';
import PrintingUnitsManager from '@/components/admin/PrintingUnitsManager';

export const dynamic = 'force-dynamic';

export const metadata = {
  title: 'Printing Units',
  robots: { index: false, follow: false },
};

export default async function PrintingUnitsPage() {
  // The write endpoints already reject non-Admins, but gating here too
  // means non-Admins never see a screen whose every control 403s.
  const supabase = await createServerSupabaseClient();
  const { data: { user } } = await supabase.auth.getUser();
  const dept = parseDepartment(user?.user_metadata?.department);
  const isAdmin = dept === 'Admin';

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
        <h1 className="text-lg font-semibold text-[var(--glass-ink)]">Printing Units</h1>
        <p className="text-sm text-[var(--glass-muted)] mt-0.5">
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
            {dept ?? 'not recognised'}.
          </p>
        </div>
      )}
    </div>
  );
}
