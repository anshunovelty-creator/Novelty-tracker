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

import React, { useState, useEffect, useId } from 'react';
import Link from 'next/link';
import { Check, X } from 'lucide-react';
import toast from 'react-hot-toast';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/Button';
import { ModalShell } from './modals';
import { MAKING_STATUSES, SHADE_CARD_STATUS_COLORS } from '@/lib/constants/shadeCards';
import type { ShadeCard } from '@/lib/types';

// Matches the shared field style used by every other modal and form in the
// admin panel (see modals/index.tsx and AddJobForm.tsx) — this form used to
// define its own, smaller variant (px-3 py-2, no backdrop-blur, no option
// styling), which made it the one form in the app with undersized fields and
// unstyled <select> options.
const inputCls = cn(
  'w-full px-3.5 py-2.5 rounded-xl text-sm bg-[var(--field-bg)] border border-[var(--field-border)]',
  'text-[var(--glass-ink)] placeholder:text-[var(--glass-muted)] backdrop-blur-md',
  'focus:outline-none focus:border-emerald-300/70 focus:bg-white/[0.14]',
  'focus:shadow-[0_0_0_4px_rgba(124,240,190,0.22)] transition-all',
  '[&>option]:bg-white [&>option]:text-[var(--glass-ink)]',
);
const labelCls = 'block text-xs font-medium text-[var(--glass-muted)] uppercase tracking-wide mb-1.5';

export type ShadeCardModalMode = 'create' | 'edit' | 'revise';

/** Existing cards that look like the one being typed, and which field found
 *  them — the callout says which, because a PM code match is near-certain
 *  while a product name match may just be a similar name. */
type DuplicateHit = {
  cards: ShadeCard[];
  /** Every match, not just the page returned — the list is capped for display. */
  total: number;
  basis: 'pm_code' | 'product_name';
};

/** Ask the register whether anything already matches. Reuses the list
 *  endpoint's field-scoped search (?field=&search=, ilike '%…%', current
 *  versions only) rather than adding a second way to query the same table.
 *  Best-effort throughout: a failed check must never block card entry. */
async function lookupExisting(
  basis: DuplicateHit['basis'],
  value: string,
): Promise<DuplicateHit | null> {
  try {
    const params = new URLSearchParams({ field: basis, search: value });
    const res = await fetch(`/api/shade-cards?${params.toString()}`);
    if (!res.ok) return null;

    const data  = await res.json();
    const cards: ShadeCard[] = data.cards ?? [];
    return cards.length > 0
      ? { cards, total: data.total ?? cards.length, basis }
      : null;
  } catch {
    return null;
  }
}

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

  // ── Duplicate check ─────────────────────────────────────────
  // 3,000+ cards came across in the import and the same product gets re-carded
  // for the same party more than once, so a card that already exists is easy
  // to add a second time. This surfaces the existing ones while the card is
  // being typed rather than after it is saved.
  const [dupes, setDupes] = useState<DuplicateHit | null>(null);

  useEffect(() => {
    // Create only. Edit and revise both start from an existing card, so every
    // lookup would match that card itself — noise, not a warning.
    if (mode !== 'create') return;

    const code = pmCode.trim();
    const name = productName.trim();
    if (code.length < 3 && name.length < 4) {
      setDupes(null);
      return;
    }

    let cancelled = false;
    const timer = setTimeout(async () => {
      // Same two-pass precedence as /api/shade-cards/for-job: pm_code is the
      // reliable identifier, product name the looser fallback for the ~19% of
      // cards that carry no PM code.
      const hit =
        (code.length >= 3 ? await lookupExisting('pm_code', code) : null) ??
        (name.length >= 4 ? await lookupExisting('product_name', name) : null);

      if (!cancelled) setDupes(hit);
    }, 350);

    return () => { cancelled = true; clearTimeout(timer); };
  }, [pmCode, productName, mode]);

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
      {/* Header and footer are sticky within .modal-panel's own scroll
          container (see ModalShell) so the primary action stays reachable
          without hunting for it once the form scrolls — this is the longest
          form in the admin panel (10 fields + notes). */}
      <form onSubmit={handleSubmit} className="flex flex-col">
        <div className="sticky top-0 z-10 border-b border-[var(--glass-border)] bg-[var(--glass-bg-strong)] px-6 py-5">
          <h2 id={titleId} className="text-base font-semibold text-[var(--glass-ink)]">
            {copy.title}
          </h2>
          <p className="text-xs text-[var(--glass-muted)] mt-1">{copy.blurb}</p>
        </div>

        <div className="px-6 py-5 space-y-5">
          {/* Identity — the two required fields, kept full-width and first */}
          <div className="space-y-4">
            <div>
              <label htmlFor="sc-party" className={labelCls}>Party <span aria-hidden="true">*</span></label>
              <input
                id="sc-party" className={inputCls} value={party} required autoFocus
                onChange={(e) => setParty(e.target.value)}
                placeholder="Who the card goes to"
              />
            </div>

            <div>
              <label htmlFor="sc-product" className={labelCls}>Product name <span aria-hidden="true">*</span></label>
              <input
                id="sc-product" className={inputCls} value={productName} required
                onChange={(e) => setProductName(e.target.value)}
                placeholder="The label this card is for"
              />
            </div>
          </div>

          {/* Identifiers — how this card is looked up and matched to a job */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div>
              <label htmlFor="sc-pm" className={labelCls}>PM code</label>
              <input
                id="sc-pm" className={inputCls} value={pmCode}
                onChange={(e) => setPmCode(e.target.value)}
              />
              <p className="text-[11px] text-[var(--glass-muted)] mt-1">
                Matches this card to its job.
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
          </div>

          {dupes && <DuplicateCallout hit={dupes} />}

          {/* Production status — independent of the party's approval below */}
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

          {/* Approval timeline — in the order these dates actually happen */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label htmlFor="sc-prepared" className={labelCls}>Prepared</label>
              <input
                id="sc-prepared" type="date" className={inputCls} value={preparedDate}
                onChange={(e) => setPreparedDate(e.target.value)}
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

            <div>
              <label htmlFor="sc-approval" className={labelCls}>Approved</label>
              <input
                id="sc-approval" type="date" className={inputCls} value={approvalDate}
                onChange={(e) => setApprovalDate(e.target.value)}
              />
            </div>
          </div>

          {/* Reference — free-text, last */}
          <div className="space-y-4">
            <div>
              <label htmlFor="sc-qnap" className={labelCls}>File location</label>
              <input
                id="sc-qnap" className={inputCls} value={qnapPath}
                onChange={(e) => setQnapPath(e.target.value)}
                placeholder="Reference only — where the artwork sits"
              />
            </div>

            <div>
              <label htmlFor="sc-notes" className={labelCls}>Notes</label>
              <textarea
                id="sc-notes" rows={3} className={inputCls} value={notes}
                onChange={(e) => setNotes(e.target.value)}
              />
            </div>
          </div>
        </div>

        <div className="sticky bottom-0 z-10 flex items-center justify-end gap-2 border-t border-[var(--glass-border)] bg-[var(--glass-bg-strong)] px-6 py-4">
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

/**
 * "This may already exist" — shown while a new card is being typed.
 *
 * Amber, not red, and nothing is blocked: a second card for the same product
 * is often legitimate (a re-card for a different party, or a fresh card after
 * a rejection). The panel exists so that call is made knowingly rather than by
 * accident — the same reasoning as the shelf-stock callout on AddJobForm.
 */
function DuplicateCallout({ hit }: { hit: DuplicateHit }) {
  const { cards, total, basis } = hit;

  // Four is enough to recognise a duplicate; the rest are a count and a link.
  const shown = cards.slice(0, 4);
  const more  = total - shown.length;

  return (
    <div
      role="status"
      className="rounded-xl border border-amber-300/40 bg-amber-400/[0.12] px-4 py-3 space-y-2"
    >
      <p className="text-sm text-[var(--glass-ink)]">
        <strong className="font-semibold">
          {total} card{total === 1 ? '' : 's'}
        </strong>{' '}
        {basis === 'pm_code'
          ? <>already {total === 1 ? 'carries' : 'carry'} this PM code.</>
          : <>already {total === 1 ? 'has' : 'have'} a matching product name.</>}
        {' '}Check the party before adding another.
      </p>

      <ul className="space-y-1.5">
        {shown.map((c) => (
          <li key={c.id} className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs">
            {/* Leads the row: this is the number written on the physical card,
                so it is what someone acts on to go and pull it from the file.
                Absent on many imported cards — say so rather than leaving a
                gap that reads as "not checked". */}
            {c.shade_card_number ? (
              <span className="font-mono font-semibold text-[var(--glass-ink)]">
                #{c.shade_card_number}
              </span>
            ) : (
              <span className="text-[var(--glass-muted)] italic">no card #</span>
            )}
            <Link
              href={`/admin/shade-cards/${c.id}`}
              target="_blank"
              className={cn(
                'font-medium text-[var(--glass-ink)] underline underline-offset-[3px]',
                'decoration-current/40 hover:decoration-current rounded',
                'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400/70',
              )}
            >
              {c.party} · {c.product_name}
            </Link>
            {c.pm_code && (
              <span className="font-mono text-[var(--glass-muted)]">{c.pm_code}</span>
            )}
            {/* Approval status only. Whether the card was physically made is
                a detail of the existing card, not a signal about whether this
                new one is a duplicate — and a second chip wraps every row. */}
            <span className={cn('px-2 py-0.5 rounded-md font-medium',
              SHADE_CARD_STATUS_COLORS[c.status]?.bg,
              SHADE_CARD_STATUS_COLORS[c.status]?.text,
              SHADE_CARD_STATUS_COLORS[c.status]?.border)}>
              {c.status}
            </span>
          </li>
        ))}
      </ul>

      {more > 0 && (
        <p className="text-[11px] text-[var(--glass-muted)]">
          + {more} more — search the register to see them all.
        </p>
      )}

      {/* The product-name rule matches on a substring, so two differently
          specced labels with similar names can both land here. */}
      {basis === 'product_name' && (
        <p className="text-[11px] text-[var(--glass-muted)]">
          Matched on product name alone — check the party and PM code to be sure.
        </p>
      )}
    </div>
  );
}
