// src/app/display/rotate/page.tsx
// Supervisor screen: cycles through every machine on one display. Static
// segment, so it never collides with /display/[id].
// Auth is enforced in middleware — the screen signs in once.

import type { Metadata } from 'next';
import { getAllMachineDisplayData } from '@/lib/api/machineDisplay';
import RotatingDisplay from '@/components/display/RotatingDisplay';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'All Machines — Live',
  robots: { index: false, follow: false },
};

export default async function RotatingDisplayPage() {
  const boards = await getAllMachineDisplayData();
  return <RotatingDisplay initial={boards} />;
}
