// src/app/admin/team/page.tsx
// Who can log in, and as which department. Admin-only — unlike Dies, Stock
// or Plates, there's no read-only view for other departments here, so the
// page itself redirects anyone who isn't Admin rather than just hiding a
// button (the API route enforces the same thing independently).

import { redirect } from 'next/navigation';
import Link from 'next/link';
import { ArrowLeft } from 'lucide-react';
import { createServerSupabaseClient } from '@/lib/supabase/server';
import { getDeptPermissions, canDeptManageTeam } from '@/lib/constants/departments';
import TeamManager from '@/components/admin/TeamManager';

export const dynamic = 'force-dynamic';

export const metadata = {
  title: 'Team',
  robots: { index: false, follow: false },
};

export default async function TeamPage() {
  const supabase = await createServerSupabaseClient();
  const { data: { user } } = await supabase.auth.getUser();
  const perms = await getDeptPermissions(user?.user_metadata?.department);

  if (!canDeptManageTeam(perms)) {
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
        <h1 className="text-lg font-semibold text-[var(--glass-ink)]">Team</h1>
        <p className="text-sm text-[var(--glass-muted)] mt-0.5">
          Every login this app has, and which department it belongs to. Add a
          member when someone joins; remove one when they leave.
        </p>
      </div>

      <TeamManager currentUserId={user!.id} />
    </div>
  );
}
