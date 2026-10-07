// src/app/admin/settings/page.tsx
// Settings — company & branding, printing units, overdue alerts — on one
// page with a section list beside it. Super-admin only, same gate as
// /admin/departments. See src/lib/branding.ts for the branding store.

import { redirect } from 'next/navigation';
import { createServerSupabaseClient } from '@/lib/supabase/server';
import { getClaimsUser } from '@/lib/supabase/claims';
import { getDeptPermissions } from '@/lib/constants/departments';
import { getBranding } from '@/lib/branding';
import BrandingSettingsForm from '@/components/admin/BrandingSettingsForm';
import PrintingUnitsManager from '@/components/admin/PrintingUnitsManager';
import OverdueAlertsCard from '@/components/admin/OverdueAlertsCard';
import AdminSectionNav from '@/components/admin/AdminSectionNav';
import SettingsToc from '@/components/admin/SettingsToc';
import { deptKeyOf } from '@/lib/identity';

export const dynamic = 'force-dynamic';

export const metadata = {
  title: 'Settings',
  robots: { index: false, follow: false },
};

const SECTIONS = [
  { id: 'company', label: 'Company & branding' },
  { id: 'units',   label: 'Printing units' },
  { id: 'alerts',  label: 'Overdue alerts' },
];

export default async function SettingsPage() {
  const supabase = await createServerSupabaseClient();
  const user = await getClaimsUser(supabase);
  const perms = await getDeptPermissions(deptKeyOf(user));

  if (!perms?.isSuperAdmin) {
    redirect('/admin');
  }

  const branding = await getBranding();

  return (
    <div className="flex flex-col gap-6">
      <AdminSectionNav />
      <h1 className="text-[30px] font-semibold leading-9 tracking-[-0.025em] text-brand-ink">Settings</h1>

      <div className="flex flex-col gap-6 lg:flex-row lg:items-start">
        <div className="lg:sticky lg:top-24 lg:w-[220px] lg:shrink-0">
          <SettingsToc sections={SECTIONS} />
        </div>
        <div className="flex min-w-0 flex-1 flex-col gap-5">
          <BrandingSettingsForm initial={branding} />
          <div id="units" className="scroll-mt-24">
            <PrintingUnitsManager />
          </div>
          <OverdueAlertsCard />
        </div>
      </div>
    </div>
  );
}
