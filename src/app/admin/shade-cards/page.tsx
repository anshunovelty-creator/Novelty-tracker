// src/app/admin/shade-cards/page.tsx
// Shade cards — the colour-approval cards sent to each party. Inside /admin,
// so it inherits the light theme and the layout's auth check.
//
// Readable by every department: anyone about to print needs to know whether
// the party has signed off the colour. Prepress, QC and Admin keep the list
// up to date; only Admin can delete a record.

import { createServerSupabaseClient } from '@/lib/supabase/server';
import { getClaimsUser } from '@/lib/supabase/claims';
import { getDeptPermissions, canDeptManageShadeCards } from '@/lib/constants/departments';
import ShadeCardsManager from '@/components/admin/ShadeCardsManager';

export const dynamic = 'force-dynamic';

export const metadata = {
  title: 'Shade Cards',
  robots: { index: false, follow: false },
};

export default async function ShadeCardsPage() {
  const supabase = await createServerSupabaseClient();
  const user = await getClaimsUser(supabase);
  const perms = await getDeptPermissions(user?.user_metadata?.department);

  return (
    // The register is a working list, not a document: on a desktop viewport the
    // page fills the screen exactly and only the table scrolls, so the search
    // controls and paging stay put while 3,000 cards are scanned.
    //
    // The subtracted height is the admin chrome above and below this element —
    // AdminHeader (h-14 plus its 1px border) and the layout <main>'s py-6.
    // Applied at lg and up only: below that the header can expand into its
    // mobile nav, which would push content out of a fixed-height box, and the
    // small-screen card list is meant to scroll with the page anyway.
    <div className="flex flex-col gap-4 lg:h-[calc(100dvh-105px)] lg:overflow-hidden">
      <div className="shrink-0">
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
        className="lg:flex-1 lg:min-h-0"
      />
    </div>
  );
}
