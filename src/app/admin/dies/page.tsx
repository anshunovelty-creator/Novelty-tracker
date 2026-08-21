// src/app/admin/dies/page.tsx
// The die library — every cutting die the shop owns. Inside /admin, so it
// inherits the light theme and the layout's auth check.
//
// Readable by every department: knowing a die already exists is what stops a
// second one being ordered. Only Prepress and Admin enter or correct records
// — see canDeptManageDiesPlates.

import Link from 'next/link';
import { ArrowLeft } from 'lucide-react';
import { createServerSupabaseClient } from '@/lib/supabase/server';
import { getDeptPermissions, canDeptManageDiesPlates } from '@/lib/constants/departments';
import DiesTabs from '@/components/admin/DiesTabs';

export const dynamic = 'force-dynamic';

export const metadata = {
  title: 'Dies',
  robots: { index: false, follow: false },
};

export default async function DiesPage() {
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
        <h1 className="text-lg font-semibold text-[var(--glass-ink)]">Dies</h1>
        <p className="text-sm text-[var(--glass-muted)] mt-0.5">
          The cutting dies that punch each label&rsquo;s shape — rotary and flatbed,
          each with their own geometry. Anyone can search the library; Prepress
          and Admin add and correct the records.
        </p>
      </div>

      <DiesTabs canManage={canDeptManageDiesPlates(perms)} />
    </div>
  );
}
