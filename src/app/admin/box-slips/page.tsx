// src/app/admin/box-slips/page.tsx
// Box slips — the in-app replacement for BarTender's BOX SLIP 4X6 INCH.btw.
// Inside /admin, so it inherits the light theme and the layout's auth check.
//
// Readable by every department (anyone may need to check what was printed on
// a box that came back); only Dispatch and Admin can actually print, since
// they are the ones who know the box counts — see canDeptPrintBoxSlips.

import { createServerSupabaseClient } from '@/lib/supabase/server';
import { getDeptPermissions, canDeptPrintBoxSlips } from '@/lib/constants/departments';
import BoxSlipManager from '@/components/admin/BoxSlipManager';

export const dynamic = 'force-dynamic';

export const metadata = {
  title: 'Box Slips',
  robots: { index: false, follow: false },
};

export default async function BoxSlipsPage() {
  const supabase = await createServerSupabaseClient();
  const { data: { user } } = await supabase.auth.getUser();
  const perms = await getDeptPermissions(user?.user_metadata?.department);

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-xl font-semibold text-[var(--glass-ink)]">Box Slips</h1>
        <p className="text-sm text-[var(--glass-muted)] mt-0.5">
          Prints the 6″ × 4″ carton slip on the TSC P210. The job supplies the
          party, material name and PM code — you add the box maths and the date.
        </p>
      </div>

      <BoxSlipManager canPrint={canDeptPrintBoxSlips(perms)} />
    </div>
  );
}
