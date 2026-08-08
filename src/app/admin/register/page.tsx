// src/app/admin/register/page.tsx
// Server component — Admin-only gate for Follow-ups (the customer CRM,
// internally "Register"). Mirrors /admin/team's pattern (the only other
// Admin-only page): non-Admin departments are bounced straight back to
// the dashboard, not shown an access-denied page, since there's no reason
// to advertise a section they'll never be able to open.

import { redirect } from 'next/navigation';
import { createServerSupabaseClient } from '@/lib/supabase/server';
import { parseDepartment } from '@/lib/constants/departments';
import RegisterManager from '@/components/admin/RegisterManager';

export default async function RegisterPage() {
  const supabase = await createServerSupabaseClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect('/login');

  const dept = parseDepartment(user.user_metadata?.department);
  if (dept !== 'Admin') redirect('/admin');

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-[var(--glass-ink)]">Follow-ups</h1>
        <p className="text-sm text-[var(--glass-muted)] mt-1">
          Customer accounts, enquiries, and follow-up history — Admin only.
        </p>
      </div>
      <RegisterManager />
    </div>
  );
}
