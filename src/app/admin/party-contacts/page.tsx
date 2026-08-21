// src/app/admin/party-contacts/page.tsx
// Party -> email/WhatsApp mapping used automatically whenever a dispatch
// email goes out. Dispatch can view (so they know who'll actually get
// emailed); only Admin can add/edit/remove, matching party_contacts' RLS.

import { redirect } from 'next/navigation';
import Link from 'next/link';
import { ArrowLeft } from 'lucide-react';
import { createServerSupabaseClient } from '@/lib/supabase/server';
import { getDeptPermissions, canDeptManageDispatchNotifications, canDeptManagePartyContacts } from '@/lib/constants/departments';
import PartyContactsManager from '@/components/admin/PartyContactsManager';

export const dynamic = 'force-dynamic';

export const metadata = {
  title: 'Party Contacts',
  robots: { index: false, follow: false },
};

export default async function PartyContactsPage() {
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
        <h1 className="text-lg font-semibold text-[var(--glass-ink)]">Party Contacts</h1>
        <p className="text-sm text-[var(--glass-muted)] mt-0.5">
          Every dispatch email — single-job or consolidated — picks the party&rsquo;s
          email from here automatically by matching the party name exactly.
          A party with nothing here simply doesn&rsquo;t get emailed.
        </p>
      </div>

      <PartyContactsManager canEdit={canDeptManagePartyContacts(perms)} />
    </div>
  );
}
