'use client';
// src/components/admin/JobActionModals.tsx
// The modal set behind a job's stage change, rendered identically for the
// desk table (JobRow) and the phone card (JobCard). Every modal portals to
// document.body, so this is safe to render from inside a <tbody>.

import React from 'react';
import type { Job } from '@/lib/types';
import type { DeptPermissions } from '@/lib/constants/departments';
import type { JobActions } from '@/hooks/useJobActions';
import {
  SequentialWarningModal,
  OnHoldModal,
  QCModal,
  PartialDispatchModal,
  FullDispatchModal,
  ClosePOModal,
  ConfirmModal,
} from './modals';

type Props = {
  job:     Job;
  dept:    DeptPermissions;
  actions: JobActions;
};

export default function JobActionModals({ job, dept, actions }: Props) {
  const { modal } = actions;

  return (
    <>
      {modal.type === 'warning' && (
        <SequentialWarningModal
          targetStage={modal.targetStage}
          missingStage={modal.missingStage}
          isAdmin={dept.isSuperAdmin}
          onCancel={actions.cancelOverride}
          onOverride={(overrideRemark) =>
            actions.confirmOverride(overrideRemark, modal.targetStage)
          }
        />
      )}

      {modal.type === 'on_hold' && (
        <OnHoldModal
          onCancel={actions.closeModal}
          onConfirm={(remark) =>
            actions.submitStatusChange({ new_status: 'On Hold', remark })
          }
        />
      )}

      {modal.type === 'qc' && (
        <QCModal
          onCancel={actions.closeQCModal}
          onConfirm={actions.confirmQC}
        />
      )}

      {modal.type === 'partial_dispatch' && (
        <PartialDispatchModal
          remaining={actions.remainingQty}
          onCancel={actions.closeModal}
          onConfirm={(qty, stockRemaining) =>
            actions.submitStatusChange({
              new_status:          'Partial Dispatch',
              qty_dispatched:      qty,
              stock_remaining_qty: stockRemaining,
            })
          }
        />
      )}

      {modal.type === 'full_dispatch' && (
        <FullDispatchModal
          remaining={actions.remainingQty}
          onCancel={actions.closeModal}
          onConfirm={(extraQty, location, remark) =>
            actions.submitStatusChange({
              new_status: 'Dispatched',
              // 0 is the "no extras" answer — the route ignores it.
              extra_label_qty:      extraQty,
              extra_label_location: location || undefined,
              extra_label_remark:   remark   || undefined,
            })
          }
        />
      )}

      {modal.type === 'close_po' && (
        <ClosePOModal
          job={job}
          onCancel={actions.closeModal}
          onConfirm={() => actions.submitStatusChange({ new_status: 'PO Closed' })}
        />
      )}

      {modal.type === 'delete' && (
        <ConfirmModal
          title={`Delete job ${job.po_number}?`}
          message="This permanently removes the job and its history. This cannot be undone."
          confirmLabel="Delete job"
          tone="danger"
          busy={actions.deleting}
          onCancel={actions.closeModal}
          onConfirm={actions.handleDelete}
        />
      )}
    </>
  );
}
