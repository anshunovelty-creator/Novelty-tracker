// src/app/display/[id]/page.tsx
// One production room's wall display. Server-renders the machine's current
// state so the screen is correct the instant it loads (a room display may sit
// untouched for hours after a power cycle), then the client polls.
// Auth is enforced in middleware — the room PC signs in once.

import { notFound } from 'next/navigation';
import type { Metadata } from 'next';
import { getMachineDisplayData } from '@/lib/api/machineDisplay';
import MachineDisplay from '@/components/display/MachineDisplay';

// Always live — never serve a build-time or cached board to a wall screen.
export const dynamic = 'force-dynamic';

type Params = { params: Promise<{ id: string }> };

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const { id } = await params;
  const data = await getMachineDisplayData(id);
  return {
    title: data ? `${data.machine.name} — Live` : 'Machine Display',
    robots: { index: false, follow: false },
  };
}

export default async function MachineDisplayPage({ params }: Params) {
  const { id } = await params;
  const data = await getMachineDisplayData(id);
  if (!data) notFound();

  return <MachineDisplay initial={data} />;
}
