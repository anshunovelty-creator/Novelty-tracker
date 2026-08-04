// src/app/admin/plates/page.tsx
// Plates — the printing plates mounted on press cylinders. Inside /admin, so
// it inherits the light theme and the layout's auth check.
//
// Readable by every department: anyone about to print needs to know whether a
// plate already exists and where it sits. Only Prepress and Admin can change
// the list — see canDeptManageDiesPlates.

import Link from 'next/link';
import { ArrowLeft } from 'lucide-react';
import { createServerSupabaseClient } from '@/lib/supabase/server';
import { parseDepartment, canDeptManageDiesPlates } from '@/lib/constants/departments';
import PlatesManager from '@/components/admin/PlatesManager';

export const dynamic = 'force-dynamic';

export const metadata = {
  title: 'Plates',
  robots: { index: false, follow: false },
};

export default async function PlatesPage() {
  const supabase = await createServerSupabaseClient();
  const { data: { user } } = await supabase.auth.getUser();
  const dept = parseDepartment(user?.user_metadata?.department);

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
        <h1 className="text-lg font-semibold text-[var(--glass-ink)]">Plates</h1>
        <p className="text-sm text-[var(--glass-muted)] mt-0.5">
          Printing plates made for each party&apos;s item, with the cylinder they
          run on and the rack they sit on. Every department can search this
          list; Prepress and Admin keep it up to date.
        </p>
      </div>

      <PlatesManager canManage={canDeptManageDiesPlates(dept)} />
    </div>
  );
}
