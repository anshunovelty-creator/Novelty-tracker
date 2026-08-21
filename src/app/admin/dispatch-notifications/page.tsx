// src/app/admin/dispatch-notifications/page.tsx
// Pending dispatch events, grouped by party — send one consolidated email
// per party (client + internal team) once a batch (e.g. a truck load) is
// complete. Dispatch/Admin only, same gating shape as /admin/stock.

import { redirect } from 'next/navigation';
import Link from 'next/link';
import { ArrowLeft } from 'lucide-react';
import { createServerSupabaseClient } from '@/lib/supabase/server';
import { getDeptPermissions, canDeptManageDispatchNotifications } from '@/lib/constants/departments';
import PendingDispatchNotifications from '@/components/admin/PendingDispatchNotifications';

export const dynamic = 'force-dynamic';

export const metadata = {
  title: 'Dispatch Emails',
  robots: { index: false, follow: false },
};

export default async function DispatchNotificationsPage() {
  const supabase = await createServerSupabaseClient();
  const { data: { user } } = await supabase.auth.getUser();
  const perms = await getDeptPermissions(user?.user_metadata?.department);

  if (!canDeptManageDispatchNotifications(perms)) {
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
        <h1 className="text-lg font-semibold text-[var(--glass-ink)]">Dispatch Emails</h1>
        <p className="text-sm text-[var(--glass-muted)] mt-0.5">
          Every Partial Dispatch / Dispatched update queues here by party instead of
          emailing instantly. Once a batch (e.g. a truck load) is complete, send one
          combined email covering everything in it.
        </p>
      </div>

      <PendingDispatchNotifications />
    </div>
  );
}
