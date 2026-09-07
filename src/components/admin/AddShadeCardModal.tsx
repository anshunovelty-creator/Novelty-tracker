'use client';
// src/components/admin/AddShadeCardModal.tsx
// Adding a shade card, correcting one, or superseding one with a revision.
//
// All three use the same field set, so they share one form and differ only in
// where it posts and what it says. Revising deliberately starts from the
// current values: a revision is nearly always a small correction to the card
// that came back from the party, not a blank re-entry.
//
// `status` is absent by design. Approval moves through the status control on
// the card itself, so adding or editing a card can never double as approving
// one — the rule the source app enforced in its server actions.

import React, { useState, useId } from 'react';
import { Check, X } from 'lucide-react';
import toast from 'react-hot-toast';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/Button';
import { ModalShell } from './modals';
import { MAKING_STATUSES } from '@/lib/constants/shadeCards';
import type { ShadeCard } from '@/lib/types';

const inputCls = cn(
  'w-full px-3 py-2 rounded-lg text-sm bg-[var(--field-bg)] border border-[var(--field-border)]',
  'text-[var(--glass-ink)] placeholder:text-[var(--glass-muted)]',
  'focus:outline-none focus:border-emerald-300/70 focus:bg-white/[0.14]',
  'focus:shadow-[0_0_0_4px_rgba(124,240,190,0.22)] transition-all',
);
const labelCls = 'block text-xs font-medium text-[var(--glass-muted)] mb-1';

export type ShadeCardModalMode = 'create' | 'edit' | 'revise';

type Props = {
  mode:    ShadeCardModalMode;
  /** The card being edited or revised. Absent when creating. */
  card?:   ShadeCard;
  onClose: () => void;
  onSaved: () => void;
};

const COPY: Record<ShadeCardModalMode, { title: string; blurb: string; save: string; done: string }> = {
  create: {
    title: 'Add shade card',
    blurb: 'A new card starts as Pending Approval — set the approval status from the card itself once the party responds.',
    save:  'Add card',
    done:  'Shade card added',
  },
  edit: {
    title: 'Edit shade card',
    blurb: 'Corrects this version in place. Use Revise instead if the party has been sent a new card.',
    save:  'Save changes',
    done:  'Shade card updated',
  },
  revise: {
    title: 'Revise shade card',
    blurb: 'Creates the next version and retires this one. The approval status carries over; the old version stays readable in the lineage.',
    save:  'Create revision',
    done:  'Revision created',
  },
};

export default function AddShadeCardModal({ mode, card, onClose, onSaved }: Props) {
  const titleId = useId();
  const copy = COPY[mode];

  const [party,            setParty]            = useState(card?.party ?? '');
  const [productName,      setProductName]      = useState(card?.product_name ?? '');
  const [pmCode,           setPmCode]           = useState(card?.pm_code ?? '');
  const [shadeCardNumber,  setShadeCardNumber]  = useState(card?.shade_card_number ?? '');
  const [docketNumber,     setDocketNumber]     = useState(card?.docket_number ?? '');
  const [makingStatus,     setMakingStatus]     = useState(card?.making_status ?? 'Pending');
  const [preparedDate,     setPreparedDate]     = useState(card?.prepared_date ?? '');
  const [approvalDate,     setApprovalDate]     = useState(card?.approval_date ?? '');
  const [sentToPartyDate,  setSentToPartyDate]  = useState(card?.sent_to_party_date ?? '');
  const [receivedBackDate, setReceivedBackDate] = useState(card?.received_back_date ?? '');
  const [qnapPath,         setQnapPath]         = useState(card?.qnap_path ?? '');
  const [notes,            setNotes]            = useState(card?.notes ?? '');
  const [saving,           setSaving]           = useState(false);

  // Already-made is one-way, so the control is locked rather than merely
  // ignored — the API rejects the downgrade either way, and a disabled field
  // explains that up front instead of at save time.
  const makingLocked = card?.making_status === 'Already Made';

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();

    if (!party.trim()) {
      toast.error('Enter the party this shade card is for');
      return;
    }
    if (!productName.trim()) {
      toast.error('Enter the product name');
      return;
    }

    setSaving(true);
    try {
      const payload = {
        action:             'fields',
        party:              party.trim(),
        product_name:       productName.trim(),
        pm_code:            pmCode.trim(),
        shade_card_number:  shadeCardNumber.trim(),
        docket_number:      docketNumber.trim(),
        making_status:      makingStatus,
        prepared_date:      preparedDate,
        approval_date:      approvalDate,
        sent_to_party_date: sentToPartyDate,
        received_back_date: receivedBackDate,
        qnap_path:          qnapPath.trim(),
        notes:              notes.trim(),
      };

      // create -> POST the collection; edit -> PATCH the card;
      // revise -> POST the card, which supersedes it.
      const [url, method] =
        mode === 'create' ? ['/api/shade-cards', 'POST'] :
        mode === 'edit'   ? [`/api/shade-cards/${card!.id}`, 'PATCH'] :
                            [`/api/shade-cards/${card!.id}`, 'POST'];

      const res = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const data = await res.json();

      if (!res.ok && res.status !== 207) {
        toast.error(data.error ?? 'Failed to save shade card');
        return;
      }
      // 207: the revision saved but the old version could not be retired.
      // Surface that instead of a plain success — the list will show both.
      if (data.warning) toast(data.warning, { icon: '⚠️', duration: 8000 });
      else toast.success(copy.done);

      onSaved();
    } catch {
      toast.error('Network error');
    } finally {
      setSaving(false);
    }
  }

  return (
    <ModalShell titleId={titleId} onClose={saving ? undefined : onClose}>
      <form onSubmit={handleSubmit} className="space-y-4">
        <div>
          <h2 id={titleId} className="text-base font-semibold text-[var(--glass-ink)]">
            {copy.title}
          </h2>
          <p className="text-xs text-[var(--glass-muted)] mt-1">{copy.blurb}</p>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div className="sm:col-span-2">
            <label htmlFor="sc-party" className={labelCls}>Party <span aria-hidden="true">*</span></label>
            <input
              id="sc-party" className={inputCls} value={party} required autoFocus
              onChange={(e) => setParty(e.target.value)}
              placeholder="Who the card goes to"
            />
          </div>

          <div className="sm:col-span-2">
            <label htmlFor="sc-product" className={labelCls}>Product name <span aria-hidden="true">*</span></label>
            <input
              id="sc-product" className={inputCls} value={productName} required
              onChange={(e) => setProductName(e.target.value)}
              placeholder="The label this card is for"
            />
          </div>

          <div>
            <label htmlFor="sc-pm" className={labelCls}>PM code</label>
            <input
              id="sc-pm" className={inputCls} value={pmCode}
              onChange={(e) => setPmCode(e.target.value)}
            />
            <p className="text-[11px] text-[var(--glass-muted)] mt-1">
              Used to match this card to its job.
            </p>
          </div>

          <div>
            <label htmlFor="sc-number" className={labelCls}>Shade card #</label>
            <input
              id="sc-number" className={inputCls} value={shadeCardNumber}
              onChange={(e) => setShadeCardNumber(e.target.value)}
            />
          </div>

          <div>
            <label htmlFor="sc-docket" className={labelCls}>Docket #</label>
            <input
              id="sc-docket" className={inputCls} value={docketNumber}
              onChange={(e) => setDocketNumber(e.target.value)}
            />
          </div>

          <div>
            <label htmlFor="sc-making" className={labelCls}>Card made?</label>
            <select
              id="sc-making" className={inputCls} value={makingStatus} disabled={makingLocked}
              onChange={(e) => setMakingStatus(e.target.value as ShadeCard['making_status'])}
            >
              {MAKING_STATUSES.map((m) => <option key={m} value={m}>{m}</option>)}
            </select>
            {makingLocked && (
              <p className="text-[11px] text-[var(--glass-muted)] mt-1">
                Already made — this can&apos;t be moved back to pending.
              </p>
            )}
          </div>

          <div>
            <label htmlFor="sc-prepared" className={labelCls}>Prepared</label>
            <input
              id="sc-prepared" type="date" className={inputCls} value={preparedDate}
              onChange={(e) => setPreparedDate(e.target.value)}
            />
          </div>

          <div>
            <label htmlFor="sc-approval" className={labelCls}>Approved</label>
            <input
              id="sc-approval" type="date" className={inputCls} value={approvalDate}
              onChange={(e) => setApprovalDate(e.target.value)}
            />
          </div>

          <div>
            <label htmlFor="sc-sent" className={labelCls}>Sent to party</label>
            <input
              id="sc-sent" type="date" className={inputCls} value={sentToPartyDate}
              onChange={(e) => setSentToPartyDate(e.target.value)}
            />
          </div>

          <div>
            <label htmlFor="sc-received" className={labelCls}>Received back</label>
            <input
              id="sc-received" type="date" className={inputCls} value={receivedBackDate}
              onChange={(e) => setReceivedBackDate(e.target.value)}
            />
          </div>

          <div className="sm:col-span-2">
            <label htmlFor="sc-qnap" className={labelCls}>File location</label>
            <input
              id="sc-qnap" className={inputCls} value={qnapPath}
              onChange={(e) => setQnapPath(e.target.value)}
              placeholder="Reference only — where the artwork sits"
            />
          </div>

          <div className="sm:col-span-2">
            <label htmlFor="sc-notes" className={labelCls}>Notes</label>
            <textarea
              id="sc-notes" rows={3} className={inputCls} value={notes}
              onChange={(e) => setNotes(e.target.value)}
            />
          </div>
        </div>

        <div className="flex items-center justify-end gap-2 pt-1">
          <Button type="button" intent="ghost" icon={X} onClick={onClose} disabled={saving}>
            Cancel
          </Button>
          <Button type="submit" intent="primary" icon={Check} busy={saving}>
            {copy.save}
          </Button>
        </div>
      </form>
    </ModalShell>
  );
}
