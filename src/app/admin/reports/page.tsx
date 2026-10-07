// src/app/admin/reports/page.tsx
// How the floor performed in a month — on-time delivery, where jobs wait,
// who orders most — plus that month's dispatches as a CSV. Admin only, the
// same gate as Settings; GET /api/reports enforces it again.

import { redirect } from 'next/navigation';
import { createServerSupabaseClient } from '@/lib/supabase/server';
import { getClaimsUser } from '@/lib/supabase/claims';
import { getDeptPermissions } from '@/lib/constants/departments';
import ReportsView from '@/components/admin/ReportsView';
import { deptKeyOf } from '@/lib/identity';

export const dynamic = 'force-dynamic';

export const metadata = {
  title: 'Reports',
  robots: { index: false, follow: false },
};

export default async function ReportsPage() {
  const supabase = await createServerSupabaseClient();
  const user = await getClaimsUser(supabase);
  const perms = await getDeptPermissions(deptKeyOf(user));
  if (!perms?.isSuperAdmin) redirect('/admin');

  return <ReportsView />;
}
