// src/app/admin/layout.tsx
import React from 'react';
import { redirect } from 'next/navigation';
import { createServerSupabaseClient } from '@/lib/supabase/server';
import { getClaimsUser } from '@/lib/supabase/claims';
import { getDeptPermissions } from '@/lib/constants/departments';
import AdminHeader from '@/components/admin/AdminHeader';
import { usernameOf } from '@/lib/username';
import NotesFeed from '@/components/admin/NotesFeed';
import OfflineBanner from '@/components/admin/OfflineBanner';
import MessagesWidget from '@/components/admin/MessagesWidget';
import { NotificationPrompt } from '@/components/ui/DesktopNotificationsToggle';
import QueryProvider from '@/components/providers/QueryProvider';
import { deptKeyOf, appMetaOf } from '@/lib/identity';

export const metadata = {
  title: 'Admin Panel',
  robots: { index: false, follow: false },
};

export default async function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const supabase = await createServerSupabaseClient();
  const user = await getClaimsUser(supabase);

  if (!user) {
    redirect('/login');
  }

  const perms = await getDeptPermissions(deptKeyOf(user));
  if (!perms) {
    // Valid Supabase user but no recognised department — mis-configured account
    redirect('/login?error=no_department');
  }

  return (
    <QueryProvider>
      <div className="admin-light min-h-screen">
        <AdminHeader
          dept={perms}
          displayName={perms.displayName}
          userName={usernameOf(appMetaOf(user), user.email)}
        />
        <OfflineBanner />
        <main className="max-w-screen-2xl 3xl:max-w-[1800px] 4xl:max-w-[2200px] mx-auto px-4 py-6">
          {children}
        </main>
        {/* Global internal-note feed + team messaging. Both mounted in the
            layout (not AdminHeader) so their unread badges survive
            navigation and their floating launchers stay thumb-reachable
            on every admin page — see the FAB stack rhythm documented in
            NotesFeed/PrepressTodoPanel/MeterCalculatorPanel. */}
        <NotesFeed deptName={perms.displayName} deptKey={perms.key} userEmail={user.email ?? ''} username={usernameOf(appMetaOf(user), user.email)} isAdmin={perms.isSuperAdmin} />
        <MessagesWidget userEmail={user.email ?? ''} isSuperAdmin={perms.isSuperAdmin} />
        <NotificationPrompt />
      </div>
    </QueryProvider>
  );
}
