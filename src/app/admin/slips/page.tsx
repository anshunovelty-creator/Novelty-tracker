// src/app/admin/slips/page.tsx
// The in-app replacement for the whole BarTender slip set: BOX SLIP 4X6
// INCH.btw, the three roll slips (ROLL SLIP 4X6 INCH, ROLL SLIP SMALL NEW
// 4 X 6 INCH, ROLL SMALL SLIP 2 X 3 MM) and ADDRESS 4 X 6.btw. Inside
// /admin, so it inherits the light theme and the layout's auth check.
//
// Readable by every department (anyone may need to check what was printed
// on a carton or roll that came back); only Dispatch and Admin can print,
// since they are the ones who know the box and roll counts.

import { createServerSupabaseClient } from '@/lib/supabase/server';
import { getClaimsUser } from '@/lib/supabase/claims';
import {
  getDeptPermissions,
  canDeptPrintBoxSlips,
  canDeptPrintRollSlips,
} from '@/lib/constants/departments';
import SlipsManager from '@/components/admin/SlipsManager';

export const dynamic = 'force-dynamic';

export const metadata = {
  title: 'Slips',
  robots: { index: false, follow: false },
};

export default async function SlipsPage() {
  const supabase = await createServerSupabaseClient();
  const user = await getClaimsUser(supabase);
  const perms = await getDeptPermissions(user?.user_metadata?.department);

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-xl font-semibold text-[var(--glass-ink)]">Slips</h1>
        <p className="text-sm text-[var(--glass-muted)] mt-0.5">
          Prints the carton, roll and address slips on the TSC P210. The job
          supplies the party, product and PM code — you add the counts and the
          date.
        </p>
      </div>

      <SlipsManager
        canPrintBox={canDeptPrintBoxSlips(perms)}
        canPrintRoll={canDeptPrintRollSlips(perms)}
      />
    </div>
  );
}
