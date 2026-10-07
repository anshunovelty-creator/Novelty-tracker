'use client';
// src/components/admin/DashboardBoard.tsx
// The dashboard below the summary: the page header (count, date, Add job),
// the machines strip with the full MachineBoard folded beneath it, and the
// jobs table. Owns the board's open/closed preference and the Add Job
// trigger, which opens the AddJobForm living inside JobsTable.

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { Plus, Settings } from 'lucide-react';
import { Button, buttonClass } from '@/components/ui/Button';
import type { DeptPermissions } from '@/lib/constants/departments';
import type { Job } from '@/lib/types';
import MachineBoard from './MachineBoard';
import MachinesStrip from './MachinesStrip';
import JobsTable from './JobsTable';
import FloorQueue from './FloorQueue';
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

  // The press floor's phone queue — for a department whose own stages
  // include In Printing (Production, Unit-1 Floor). Admin can set every
  // stage, so it would always qualify; it previews the queue with ?floor=1.
  const floorParam = useSearchParams()?.get('floor') === '1';
  const showFloor = (!dept.allStages && dept.stages.includes('In Printing')) || (dept.isSuperAdmin && floorParam);

  // Shown unless someone hid it: while the preference is still unknown the
  // tiles stay up (no flash on first paint), and MachineBoard itself waits
  // for the answer before loading.
  const isHidden = collapsed === true;

  // Today in the plant's own time zone, so the server render and the
  // browser agree on the date whatever the visitor's clock says.
  const today = new Intl.DateTimeFormat('en-GB', {
    weekday: 'short', day: '2-digit', month: 'short', timeZone: 'Asia/Kolkata',
  }).format(new Date());

  return (
    <div className="flex flex-col gap-7">
      {showFloor && (
        <div className="sm:hidden">
          <FloorQueue dept={dept} initialJobs={jobs} />
        </div>
      )}

      {/* Page header: what this page is, how much is in flight, and the two
          ways new work enters — a PO line in Job Separation, or a job. */}
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div className="flex flex-col gap-1.5">
          <h1 className="text-[30px] font-semibold leading-9 tracking-[-0.025em] text-brand-ink">Jobs</h1>
          <p className="text-sm text-brand-muted">
            <span className="font-mono font-semibold text-brand-ink">{jobs.length}</span> in production
            {' · '}
            <span className="font-mono">{today}</span>
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {dept.isSuperAdmin && (
            <Link
              href="/admin/settings#units"
              className="inline-flex min-h-11 items-center gap-1.5 rounded-lg px-3 text-sm font-medium text-brand-muted hover:bg-black/[0.04] hover:text-brand-ink"
            >
              <Settings className="h-4 w-4 shrink-0" aria-hidden="true" />
              Printing units
            </Link>
          )}
          <Link href="/admin/job-separation" className={buttonClass('ghost', 'md')}>
            Job Separation
          </Link>
          <Button
            intent="primary"
            icon={Plus}
            onClick={() => addJobFormRef.current?.open()}
          >
            Add job
          </Button>
        </div>
      </div>

      <div className="flex flex-col gap-4">
        <MachinesStrip
          boardOpen={!isHidden}
          onToggleBoard={() => applyCollapsed(!isHidden)}
          boardId="machine-board"
        />
        <div id="machine-board">
          <MachineBoard dept={dept} collapsed={collapsed} />
        </div>
      </div>

      <JobsTable
        initialJobs={jobs}
        dept={dept}
        addJobFormRef={addJobFormRef}
        hideAddTrigger
      />
    </div>
  );
}
