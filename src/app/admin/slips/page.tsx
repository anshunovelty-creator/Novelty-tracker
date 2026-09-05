// src/app/admin/slips/page.tsx
// Box slips and roll slips — the in-app replacement for BarTender's
// BOX SLIP 4X6 INCH.btw and ROLL SLIP 4X6 INCH.btw. Inside /admin, so it
// inherits the light theme and the layout's auth check.
//
// Readable by every department (anyone may need to check what was printed
// on a carton or roll that came back); only Dispatch and Admin can print,
// since they are the ones who know the box and roll counts.

import { createServerSupabaseClient } from '@/lib/supabase/server';
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
  const { data: { user } } = await supabase.auth.getUser();
  const perms = await getDeptPermissions(user?.user_metadata?.department);

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-xl font-semibold text-[var(--glass-ink)]">Slips</h1>
        <p className="text-sm text-[var(--glass-muted)] mt-0.5">
          Prints the carton and roll slips on the TSC P210. The job supplies the
          party, product and PM code — you add the counts and the date.
        </p>
      </div>

      <SlipsManager
        canPrintBox={canDeptPrintBoxSlips(perms)}
        canPrintRoll={canDeptPrintRollSlips(perms)}
      />
    </div>
  );
}
