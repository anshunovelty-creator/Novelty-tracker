// src/app/admin/layout.tsx
import React from 'react';
import { redirect } from 'next/navigation';
import { createServerSupabaseClient } from '@/lib/supabase/server';
import { getDeptPermissions } from '@/lib/constants/departments';
import AdminHeader from '@/components/admin/AdminHeader';
import NotesFeed from '@/components/admin/NotesFeed';
import QueryProvider from '@/components/providers/QueryProvider';

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
  const { data: { user } } = await supabase.auth.getUser();

  if (!user) {
    redirect('/login');
  }

  const perms = await getDeptPermissions(user.user_metadata?.department);
  if (!perms) {
    // Valid Supabase user but no recognised department — mis-configured account
    redirect('/login?error=no_department');
  }

  return (
    <QueryProvider>
      <div className="admin-light min-h-screen">
        <AdminHeader dept={perms} displayName={perms.displayName} />
        <main className="max-w-screen-2xl 3xl:max-w-[1800px] 4xl:max-w-[2200px] mx-auto px-4 py-6">
          {children}
        </main>
        {/* Global internal-note feed. Mounted in the layout so the unread
            badge survives navigation between admin pages. */}
        <NotesFeed dept={perms.key} userEmail={user.email ?? ''} />
      </div>
    </QueryProvider>
  );
}
