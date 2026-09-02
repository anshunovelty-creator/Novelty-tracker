// src/app/admin/dispatch-notifications/page.tsx
// One page for the dispatch email: the pending queue, plus the two
// recipient lists it sends to — the party's contacts and the internal
// team. Previously three separate nav entries (/admin/party-contacts and
// /admin/notifications now redirect here) which crowded the header.
//
// The three tabs are three independently grantable feature keys, so each
// is gated on its own — a department sees only the tabs it holds, and
// reaching the page at all needs just one of them.

import { redirect } from 'next/navigation';
import { createServerSupabaseClient } from '@/lib/supabase/server';
import {
  getDeptPermissions,
  canDeptManageDispatchNotifications,
  canDeptManagePartyContacts,
  canDeptManageNotificationRecipients,
} from '@/lib/constants/departments';
import PendingDispatchNotifications from '@/components/admin/PendingDispatchNotifications';
import PartyContactsManager from '@/components/admin/PartyContactsManager';
import NotificationRecipientsManager from '@/components/admin/NotificationRecipientsManager';
import DispatchEmailTabs, { type DispatchTab, type DispatchTabId } from '@/components/admin/DispatchEmailTabs';

export const dynamic = 'force-dynamic';

export const metadata = {
  title: 'Dispatch Emails',
  robots: { index: false, follow: false },
};

export default async function DispatchNotificationsPage({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string }>;
}) {
  const supabase = await createServerSupabaseClient();
  const { data: { user } } = await supabase.auth.getUser();
  const perms = await getDeptPermissions(user?.user_metadata?.department);

  const canQueue = canDeptManageDispatchNotifications(perms);
  const canTeam  = canDeptManageNotificationRecipients(perms);
  // Dispatch can see who'll be emailed even when only Admin may edit it,
  // which is how /admin/party-contacts gated it before the fold-in.
  const canEditParties = canDeptManagePartyContacts(perms);
  const canParties     = canQueue || canEditParties;

  const tabs: DispatchTab[] = [
    canQueue && {
      id: 'queue' as const,
      label: 'Queue',
      caption:
        'Every Partial Dispatch / Dispatched update queues here by party instead of emailing '
        + 'instantly. Once a batch (e.g. a truck load) is complete, send one combined email '
        + 'covering everything in it.',
    },
    canParties && {
      id: 'parties' as const,
      label: 'Party contacts',
      caption:
        'Every dispatch email — single-job or consolidated — picks the party’s email from here '
        + 'automatically by matching the party name exactly. A party with nothing here simply '
        + 'doesn’t get emailed.',
    },
    canTeam && {
      id: 'team' as const,
      label: 'Team recipients',
      caption:
        'Internal addresses that get a copy of the consolidated dispatch email, sent whenever '
        + 'Dispatch/Admin sends a party’s batch.',
    },
  ].filter(Boolean) as DispatchTab[];

  // Holding none of the three keys means there is nothing here to show.
  if (tabs.length === 0) {
    redirect('/admin');
  }

  // Fall back to the first tab they can actually see, so a stale link or a
  // redirect from an old route never lands on a forbidden (or blank) tab.
  const requested = (await searchParams).tab;
  const active: DispatchTabId =
    tabs.find((t) => t.id === requested)?.id ?? tabs[0].id;

  return (
    <div className="space-y-4">
      <h1 className="text-xl font-semibold text-[var(--glass-ink)]">Dispatch Emails</h1>

      <DispatchEmailTabs tabs={tabs} active={active}>
        {active === 'queue'   && <PendingDispatchNotifications />}
        {active === 'parties' && <PartyContactsManager canEdit={canEditParties} />}
        {active === 'team'    && <NotificationRecipientsManager />}
      </DispatchEmailTabs>
    </div>
  );
}
