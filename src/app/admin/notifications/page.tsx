// src/app/admin/notifications/page.tsx
// Who gets a copy of the dispatch email internally. Admin-only, same
// gating shape as /admin/team.

import { redirect } from 'next/navigation';
import Link from 'next/link';
import { ArrowLeft } from 'lucide-react';
import { createServerSupabaseClient } from '@/lib/supabase/server';
import { parseDepartment } from '@/lib/constants/departments';
import NotificationRecipientsManager from '@/components/admin/NotificationRecipientsManager';

export const dynamic = 'force-dynamic';

export const metadata = {
  title: 'Dispatch Alerts',
  robots: { index: false, follow: false },
};

export default async function NotificationsPage() {
  const supabase = await createServerSupabaseClient();
  const { data: { user } } = await supabase.auth.getUser();
  const dept = parseDepartment(user?.user_metadata?.department);

  if (dept !== 'Admin') {
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
        <h1 className="text-lg font-semibold text-[var(--glass-ink)]">Dispatch Alerts</h1>
        <p className="text-sm text-[var(--glass-muted)] mt-0.5">
          Internal addresses that get a copy of the consolidated dispatch email —
          sent from Dispatch Emails whenever Dispatch/Admin sends a party&rsquo;s batch.
        </p>
      </div>

      <NotificationRecipientsManager />
    </div>
  );
}
