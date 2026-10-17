'use client';
// src/components/admin/AddCustomDispatchModal.tsx
// Add a free-text dispatch entry (no job link — for anything that skipped
// the normal Job Separation flow), or edit/correct any queued entry
// already in the list. Both cases queue/update a row in
// pending_dispatch_notifications and ride the same consolidated per-party
// send as every other entry.
//
// The PM code field searches orders the same way the slip page does
// (src/lib/slipSource.ts): pick a job or Job Separation row and its party,
// PO, job name and quantity fill in; anything can still be typed by hand.

import React, { useState, useEffect, useId, useMemo } from 'react';
import { Check, X } from 'lucide-react';
import toast from 'react-hot-toast';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/Button';
import { ModalShell } from './modals';
import PartyPicker from './PartyPicker';
import type { Party, PendingDispatchNotification } from '@/lib/types';
import { WithExample, WithUnit } from '@/components/ui/FieldAffix';
import { useListKeys } from '@/hooks/useListKeys';
import { searchSources, type SlipSource, type SourceMatches } from '@/lib/slipSource';

const NO_MATCHES: SourceMatches = { jobs: [], separations: [] };

const inputCls = cn(
  'w-full px-3 py-2 rounded-lg text-sm bg-[var(--field-bg)] border border-[var(--field-border)]',
  'text-[var(--glass-ink)] placeholder:text-[var(--glass-muted)]',
  'focus:outline-none focus:border-emerald-300/70 focus:bg-white/[0.14]',
  'focus:shadow-[0_0_0_4px_rgba(124,240,190,0.22)] transition-all',
);

type Props = {
  existing: PendingDispatchNotification | null;
  onClose:  () => void;
  onSaved:  () => void;
};

export default function AddCustomDispatchModal({ existing, onClose, onSaved }: Props) {
  const titleId = useId();

  const [parties,   setParties]   = useState<Party[]>([]);
  const [party,      setParty]      = useState(existing?.party ?? '');
  const [poNumber,   setPoNumber]   = useState(existing?.po_number ?? '');
  const [jobName,    setJobName]    = useState(existing?.job_name ?? '');
  const [status,     setStatus]     = useState<'Dispatched' | 'Partial Dispatch'>(
    (existing?.status as 'Dispatched' | 'Partial Dispatch') ?? 'Dispatched',
  );
  const [qty,        setQty]        = useState(existing?.qty != null ? String(existing.qty) : '');
  const [remark,     setRemark]     = useState(existing?.remark ?? '');
  const [pmCode,     setPmCode]     = useState(existing?.pm_code ?? '');
  const [saving,     setSaving]     = useState(false);

  // Only what's typed into the PM code box searches — not the value an
  // entry being edited opens with, nor the code a pick fills in.
  const [pmQuery,     setPmQuery]     = useState('');
  const [matches,     setMatches]     = useState<SourceMatches>(NO_MATCHES);
  const [showMatches, setShowMatches] = useState(false);
  const [searching,   setSearching]   = useState(false);

  useEffect(() => {
    const term = pmQuery.trim();
    if (term.length < 2) { setMatches(NO_MATCHES); setShowMatches(false); return; }
    let cancelled = false;
    const t = setTimeout(async () => {
      setSearching(true);
      const found = await searchSources(term);
      if (cancelled) return;
      setSearching(false);
      setMatches(found);
      setShowMatches(true);
    }, 250);
    return () => { cancelled = true; clearTimeout(t); };
  }, [pmQuery]);

  const options = useMemo(() => [...matches.jobs, ...matches.separations], [matches]);

  function pick(o: SlipSource) {
    setPmCode(o.pm_code ?? '');
    setParty(o.party);
    setPoNumber(o.po_number ?? '');
    setJobName(o.job_name ?? '');
    setQty(o.label_qty ? String(o.label_qty) : '');
    setPmQuery('');
    setShowMatches(false);
    toast.success('Filled from the order — check the qty if only part went out');
  }

  const pmKeys = useListKeys({
    items: options, open: showMatches && options.length > 0,
    onPick: pick, onClose: () => setShowMatches(false),
  });

  useEffect(() => {
    fetch('/api/parties')
      .then((res) => res.json())
      .then((data) => setParties(data.parties ?? []))
      .catch(() => toast.error('Failed to load the parties list'));
  }, []);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();

    if (!party.trim())    { toast.error('Choose a party'); return; }
    if (!poNumber.trim()) { toast.error('Enter a PO number'); return; }

    setSaving(true);
    try {
      const res = await fetch(
        existing ? `/api/dispatch-notifications/${existing.id}` : '/api/dispatch-notifications',
        {
          method:  existing ? 'PATCH' : 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            party:     party.trim(),
            po_number: poNumber.trim(),
            job_name:  jobName.trim() || undefined,
            status,
            qty:       qty.trim() ? Number(qty) : undefined,
            remark:    remark.trim() || undefined,
            pm_code:   pmCode.trim() || undefined,
          }),
        },
      );
      const data = await res.json();
      if (!res.ok) {
        toast.error(data.error ?? `Failed to ${existing ? 'save' : 'add'} entry`);
        return;
      }
      toast.success(existing ? 'Entry updated' : 'Added — it will go out in the next email for this party');
      onSaved();
    } catch {
      toast.error('Network error');
    } finally {
      setSaving(false);
    }
  }

  return (
    <ModalShell titleId={titleId} onClose={saving ? undefined : onClose}>
      <form onSubmit={handleSubmit} className="flex flex-col max-h-[85vh]">
        <div className="flex items-start justify-between gap-4 px-5 py-4 border-b border-white/12 shrink-0">
          <div>
            <h2 id={titleId} className="text-base font-semibold text-[var(--glass-ink)]">
              {existing ? 'Edit dispatch entry' : 'Add custom dispatch entry'}
            </h2>
            <p className="text-xs text-[var(--glass-muted)] mt-0.5">
              {existing
                ? 'Only affects what gets emailed — nothing on the job itself changes'
                : 'For a dispatch that happened outside the system — no job record needed'}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close without saving"
            className="p-1.5 -m-1.5 rounded-lg text-[var(--glass-muted)] hover:text-[var(--glass-ink)] hover:bg-white/10 transition-colors"
          >
            <X className="w-4 h-4" aria-hidden="true" />
          </button>
        </div>

        <div className="px-5 py-4 overflow-y-auto space-y-4">
          <div className="relative">
            <FieldLabel>PM code</FieldLabel>
            <WithExample example="PM-4521">
              <input
                type="text"
                value={pmCode}
                onChange={(e) => { setPmCode(e.target.value); setPmQuery(e.target.value); }}
                onFocus={() => options.length > 0 && setShowMatches(true)}
                onBlur={() => setTimeout(() => setShowMatches(false), 150)}
                autoComplete="off"
                aria-label="PM code"
                {...pmKeys.inputProps}
                className={cn(inputCls, 'font-mono')}
              />
            </WithExample>
            <p className="mt-1 text-xs text-[var(--glass-muted)]">
              {searching
                ? 'Searching…'
                : showMatches && options.length === 0
                  ? 'No order with this PM code — fill the details in below'
                  : 'Type a PM code and pick the order — party, PO, job name and qty fill in'}
            </p>
            {showMatches && options.length > 0 && (
              <div className="absolute z-20 top-full left-0 right-0 -mt-4 glass-strong glass rounded-lg shadow-lg overflow-hidden">
                <p className="px-3 py-1.5 text-xs text-[var(--glass-muted)] bg-white/[0.06] border-b border-white/10">
                  Pick the order to fill in (↓ ↑ and Enter work too)
                </p>
                <div {...pmKeys.listProps} aria-label="Matching orders" className="max-h-72 overflow-y-auto">
                  {options.map((o, i) => (
                    <button
                      key={`${o.from}-${o.id}`}
                      type="button"
                      {...pmKeys.optionProps(i)}
                      // onMouseDown fires before the input's onBlur closes the list
                      onMouseDown={(e) => { e.preventDefault(); pick(o); }}
                      className={cn('w-full min-h-11 text-left px-3 py-2 transition-colors border-b border-white/10 last:border-0',
                        i === pmKeys.active && 'bg-brand-surface-hover shadow-[inset_3px_0_0_#10553F]')}
                    >
                      <span className="block text-sm text-[var(--glass-ink)] truncate">
                        {o.party} — {o.job_name ?? 'Untitled'}
                      </span>
                      <span className="block text-xs text-[var(--glass-muted)] mt-0.5">
                        <span className="font-mono">{o.job_card_number ?? '—'}</span>
                        {o.from === 'separation' && ' (Job Separation)'}
                        {' · '}PO <span className="font-mono">{o.po_number ?? '—'}</span>
                        {o.pm_code ? <> · PM <span className="font-mono">{o.pm_code}</span></> : ''}
                        {o.label_qty ? <> · Qty <span className="font-mono">{o.label_qty.toLocaleString('en-IN')}</span></> : ''}
                      </span>
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>

          <div>
            <FieldLabel required>Party</FieldLabel>
            <PartyPicker parties={parties} value={party} onChange={setParty} className={inputCls} />
          </div>

          <div>
            <FieldLabel required>PO number</FieldLabel>
            <WithExample example="PO-1234">
                <input
                type="text"
                value={poNumber}
                onChange={(e) => setPoNumber(e.target.value)}
                autoComplete="off"
                className={inputCls}
              />
            </WithExample>
          </div>

          <div>
            <FieldLabel>Job name</FieldLabel>
            <input
              type="text"
              value={jobName}
              onChange={(e) => setJobName(e.target.value)}
              autoComplete="off"
              className={inputCls}
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <FieldLabel required>Status</FieldLabel>
              <select
                value={status}
                onChange={(e) => setStatus(e.target.value as 'Dispatched' | 'Partial Dispatch')}
                className={cn(inputCls, 'appearance-none')}
              >
                <option value="Dispatched">Dispatched</option>
                <option value="Partial Dispatch">Partial Dispatch</option>
              </select>
            </div>
            <div>
              <FieldLabel>Qty</FieldLabel>
              <WithUnit unit="labels">
                  <input
                  type="number"
                  min="0"
                  value={qty}
                  onChange={(e) => setQty(e.target.value)}
                  className={inputCls}
                />
              </WithUnit>
            </div>
          </div>

          <div>
            <FieldLabel>Remark</FieldLabel>
            <WithExample example="why this is manual">
                <input
                type="text"
                value={remark}
                onChange={(e) => setRemark(e.target.value)}
                autoComplete="off"
                className={inputCls}
              />
            </WithExample>
          </div>
        </div>

        <div className="flex items-center justify-end gap-2 px-5 py-3.5 border-t border-white/12 shrink-0">
          <Button
            type="button"
            onClick={onClose}
            disabled={saving}
            >
              Cancel
          </Button>
          <Button
            type="submit"
            intent="primary"
            icon={Check}
            disabled={saving}
            >
              {saving ? 'Saving…' : existing ? 'Save changes' : 'Add entry'}
          </Button>
        </div>
      </form>
    </ModalShell>
  );
}

function FieldLabel({ children, required }: { children: React.ReactNode; required?: boolean }) {
  return (
    <span className="block text-[11px] font-semibold uppercase tracking-[0.06em] text-[var(--glass-muted)] mb-1.5">
      {children}
      {required && <span className="text-red-300 ml-0.5" aria-hidden="true">*</span>}
    </span>
  );
}
