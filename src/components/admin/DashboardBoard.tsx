'use client';
// src/components/admin/DashboardBoard.tsx
// Coordinates the dashboard's Machine Board visibility and the Add Job
// trigger, both of which used to be owned by MachineBoard and AddJobForm
// respectively — each in its own spot on the page. Lifted here so all three
// toolbar actions (Manage Printing Units, Show/Hide Machine Board, Add Job)
// can sit together in one row instead of three unrelated locations.

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { ChevronDown, ChevronUp, Plus, Settings } from 'lucide-react';
import { Button, buttonClass } from '@/components/ui/Button';
import type { DeptPermissions } from '@/lib/constants/departments';
import type { Job } from '@/lib/types';
import MachineBoard from './MachineBoard';
import JobsTable from './JobsTable';
import type { AddJobFormHandle } from './AddJobForm';

// Whether the board is collapsed, remembered per browser — same convention as
// the floating panels' stored size (see hooks/useResizablePanel.ts) and the
// same key MachineBoard used when it owned this state itself, so an existing
// preference still applies. A view preference belongs to the machine someone
// works at, not to their account: the office screen and the shop-floor
// terminal want different answers.
const COLLAPSED_KEY = 'meterlabels.dashboard.machinesCollapsed';

function readCollapsed(): boolean {
  try { return window.localStorage.getItem(COLLAPSED_KEY) === '1'; }
  catch { return false; }
}

function writeCollapsed(collapsed: boolean): void {
  try { window.localStorage.setItem(COLLAPSED_KEY, collapsed ? '1' : '0'); }
  catch { /* ignored — the board still collapses for this visit */ }
}

type Props = {
  dept: DeptPermissions;
  jobs: Job[];
};

export default function DashboardBoard({ dept, jobs }: Props) {
  // null = the stored preference has not been read yet — localStorage can't
  // be read during render, so MachineBoard keeps its board query disabled
  // until the answer is known (see its `collapsed` prop doc).
  const [collapsed, setCollapsed] = useState<boolean | null>(null);
  useEffect(() => { setCollapsed(readCollapsed()); }, []);

  function applyCollapsed(next: boolean) {
    setCollapsed(next);
    writeCollapsed(next);
  }

  const addJobFormRef = useRef<AddJobFormHandle>(null);

  // Treat "not yet known" the same as hidden for the toggle's own label/icon
  // — matches MachineBoard rendering nothing until the preference resolves.
  const isHidden = collapsed !== false;

  // Manage Printing Units, Show/Hide Machine Board, Add Job — clustered
  // together and handed to JobsTable to render on the "Active Jobs" heading
  // row, rather than taking a row of their own above the table.
  const toolbar = (
    <div className="flex items-center gap-2">
      {dept.isSuperAdmin && (
        <Link href="/admin/printing-units" className={buttonClass('ghost', 'sm')}>
          <Settings className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
          Manage Printing Units
        </Link>
      )}

      <Button
        size="sm"
        icon={isHidden ? ChevronDown : ChevronUp}
        onClick={() => applyCollapsed(!isHidden)}
        aria-expanded={!isHidden}
      >
        {isHidden ? 'Show Machine Board' : 'Hide Machine Board'}
      </Button>

      <Button
        size="sm"
        intent="primary"
        icon={Plus}
        onClick={() => addJobFormRef.current?.open()}
      >
        Add Job
      </Button>
    </div>
  );

  return (
    <div className="space-y-6">
      <MachineBoard dept={dept} collapsed={collapsed} />

      <JobsTable
        initialJobs={jobs}
        dept={dept}
        addJobFormRef={addJobFormRef}
        hideAddTrigger
        toolbarExtra={toolbar}
      />
    </div>
  );
}
