// src/app/admin/shade-cards/page.tsx
// Shade cards — the colour-approval cards sent to each party. Inside /admin,
// so it inherits the light theme and the layout's auth check.
//
// Readable by every department: anyone about to print needs to know whether
// the party has signed off the colour. Prepress, QC and Admin keep the list
// up to date; only Admin can delete a record.

import { createServerSupabaseClient } from '@/lib/supabase/server';
import { getDeptPermissions, canDeptManageShadeCards } from '@/lib/constants/departments';
import ShadeCardsManager from '@/components/admin/ShadeCardsManager';

export const dynamic = 'force-dynamic';

export const metadata = {
  title: 'Shade Cards',
  robots: { index: false, follow: false },
};

export default async function ShadeCardsPage() {
  const supabase = await createServerSupabaseClient();
  const { data: { user } } = await supabase.auth.getUser();
  const perms = await getDeptPermissions(user?.user_metadata?.department);

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-xl font-semibold text-[var(--glass-ink)]">Shade Cards</h1>
        <p className="text-sm text-[var(--glass-muted)] mt-0.5">
          Colour-approval cards sent to each party, with the approval status and
          whether the physical card has been made. Every department can search
          this list; Prepress, QC and Admin keep it up to date.
        </p>
      </div>

      <ShadeCardsManager
        canManage={canDeptManageShadeCards(perms)}
        canDelete={perms?.isSuperAdmin ?? false}
      />
    </div>
  );
}
