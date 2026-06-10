// src/app/admin/layout.tsx
import React from 'react';
import { redirect } from 'next/navigation';
import { createServerSupabaseClient } from '@/lib/supabase/server';
import { parseDepartment, DEPT_DISPLAY_NAME } from '@/lib/constants/departments';
import AdminHeader from '@/components/admin/AdminHeader';

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

  const dept = parseDepartment(user.user_metadata?.department);
  if (!dept) {
    // Valid Supabase user but no department — mis-configured account
    redirect('/login?error=no_department');
  }

  const displayName = DEPT_DISPLAY_NAME[dept];

  return (
    <div className="min-h-screen bg-brand-bg">
      <AdminHeader dept={dept} displayName={displayName} />
      <main className="max-w-screen-2xl mx-auto px-4 py-6">
        {children}
      </main>
    </div>
  );
}
