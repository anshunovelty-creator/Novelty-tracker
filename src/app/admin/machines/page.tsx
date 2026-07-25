// src/app/admin/machines/page.tsx
// Machine utilisation report. Inside /admin, so it inherits the light theme
// and the layout's auth check.

import Link from 'next/link';
import { ArrowLeft } from 'lucide-react';
import { getMachineUtilisation, istToday, istDaysBefore } from '@/lib/api/machineAnalytics';
import MachineUtilisationReport from '@/components/admin/MachineUtilisationReport';

export const dynamic = 'force-dynamic';

export const metadata = {
  title: 'Machine Utilisation',
  robots: { index: false, follow: false },
};

export default async function MachineReportPage() {
  // Default window: the last 7 IST days, today included.
  const today  = istToday();
  const report = await getMachineUtilisation(istDaysBefore(today, 6), today);

  return (
    <div className="space-y-4">
      <Link
        href="/admin"
        className="inline-flex min-h-11 items-center gap-1.5 text-sm text-[var(--glass-muted)] hover:text-[var(--glass-ink)]"
      >
        <ArrowLeft className="h-4 w-4" aria-hidden="true" />
        Back to dashboard
      </Link>

      <MachineUtilisationReport initial={report} />
    </div>
  );
}
