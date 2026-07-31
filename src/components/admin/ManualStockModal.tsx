'use client';
// src/components/admin/ManualStockModal.tsx
// Adding stock the system never saw — an old run found on a shelf, or labels
// missed when a dispatch was recorded.
//
// Picking a job is the fast path: every identity field fills itself from the
// job, and the server re-reads that job rather than trusting what we send.
// The free-text fallback exists because stock is sometimes found with nothing
// but a party name on the box, and refusing to record it helps no one.

import React, { useState, useEffect, useId } from 'react';
import { Search, Check, X } from 'lucide-react';
import toast from 'react-hot-toast';
import { cn, formatJobCardNumber } from '@/lib/utils';
import { ModalShell } from './modals';
import type { Job } from '@/lib/types';

const inputCls = cn(
  'w-full px-3 py-2 rounded-lg text-sm bg-[var(--glass-bg)] border border-[var(--glass-border)]',
  'text-[var(--glass-ink)] placeholder:text-[var(--glass-muted)]',
  'focus:outline-none focus:border-emerald-300/70 focus:bg-white/[0.14]',
  'focus:shadow-[0_0_0_4px_rgba(124,240,190,0.22)] transition-all',
);

type Props = {
  onClose: () => void;
  onAdded: () => void;
};

export default function ManualStockModal({ onClose, onAdded }: Props) {
  const titleId = useId();

  const [jobQuery,   setJobQuery]   = useState('');
  const [jobResults, setJobResults] = useState<Job[]>([]);
  const [pickedJob,  setPickedJob]  = useState<Job | null>(null);
  const [searching,  setSearching]  = useState(false);

  const [qty,      setQty]      = useState<number | ''>('');
  const [party,    setParty]    = useState('');
  const [jobName,  setJobName]  = useState('');
  const [pmCode,   setPmCode]   = useState('');
  const [location, setLocation] = useState('');
  const [remark,   setRemark]   = useState('');
  const [saving,   setSaving]   = useState(false);

  // Job lookup. Skipped once a job is picked — the list would just be noise.
  useEffect(() => {
    if (pickedJob || jobQuery.trim().length < 2) {
      setJobResults([]);
      return;
    }
    let cancelled = false;
    const timer = setTimeout(async () => {
      setSearching(true);
      try {
        const res  = await fetch(`/api/jobs?search=${encodeURIComponent(jobQuery.trim())}`);
        const data = await res.json();
        if (!cancelled && res.ok) setJobResults((data.jobs ?? []).slice(0, 6));
      } catch {
        // Non-fatal: the free-text fields below still work.
      } finally {
        if (!cancelled) setSearching(false);
      }
    }, 300);
    return () => { cancelled = true; clearTimeout(timer); };
  }, [jobQuery, pickedJob]);

  function pickJob(job: Job) {
    setPickedJob(job);
    setParty(job.party);
    setJobName(job.job_name ?? '');
    setPmCode(job.pm_code ?? '');
    setJobResults([]);
  }

  function clearJob() {
    setPickedJob(null);
    setJobQuery('');
    setParty('');
    setJobName('');
    setPmCode('');
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();

    if (typeof qty !== 'number' || qty <= 0) {
      toast.error('Enter how many labels are in stock');
      return;
    }
    if (!pickedJob && !party.trim()) {
      toast.error('Pick a job, or type the party name');
      return;
    }

    setSaving(true);
    try {
      const res = await fetch('/api/stock', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          job_id:   pickedJob?.id ?? null,
          qty,
          // Ignored by the server when job_id is set — it snapshots the job.
          party:    party.trim(),
          job_name: jobName.trim(),
          pm_code:  pmCode.trim(),
          location: location.trim(),
          remark:   remark.trim(),
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        toast.error(data.error ?? 'Failed to add stock');
        return;
      }
      toast.success('Stock added');
      onAdded();
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
              Add stock
            </h2>
            <p className="text-xs text-[var(--glass-muted)] mt-0.5">
              Labels found on the shelf that the system does not know about
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
          {/* Job picker */}
          <div>
            <StockLabel>Job</StockLabel>
            {pickedJob ? (
              <div className="flex items-start justify-between gap-3 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2">
                <div className="min-w-0">
                  <p className="font-mono text-xs font-semibold text-emerald-900">
                    {formatJobCardNumber(pickedJob.job_card_number) ?? pickedJob.po_number}
                  </p>
                  <p className="text-sm font-medium text-emerald-900 mt-0.5 break-words">
                    {pickedJob.party}
                  </p>
                  {pickedJob.job_name && (
                    <p className="text-xs text-emerald-800 mt-0.5 break-words">{pickedJob.job_name}</p>
                  )}
                </div>
                <button
                  type="button"
                  onClick={clearJob}
                  className="text-xs font-medium text-emerald-900 underline underline-offset-2 shrink-0"
                >
                  Change
                </button>
              </div>
            ) : (
              <div className="relative">
                <Search
                  className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[var(--glass-muted)]"
                  aria-hidden="true"
                />
                <input
                  value={jobQuery}
                  onChange={(e) => setJobQuery(e.target.value)}
                  placeholder="Search card no, PO, party or job name"
                  aria-label="Search for a job"
                  autoComplete="off"
                  className={cn(inputCls, 'pl-9')}
                />
                {jobResults.length > 0 && (
                  <div className="absolute z-20 top-full left-0 right-0 mt-1 rounded-lg border border-black/[0.08] bg-white shadow-lg overflow-hidden">
                    {jobResults.map((job) => (
                      <button
                        key={job.id}
                        type="button"
                        onClick={() => pickJob(job)}
                        className="w-full text-left px-3 py-2 hover:bg-black/[0.04] transition-colors border-b border-black/[0.06] last:border-0"
                      >
                        <span className="block font-mono text-xs font-semibold text-[var(--glass-ink)]">
                          {formatJobCardNumber(job.job_card_number) ?? job.po_number}
                        </span>
                        <span className="block text-xs text-[var(--glass-muted)] truncate">
                          {job.party}{job.job_name ? ` · ${job.job_name}` : ''}
                        </span>
                      </button>
                    ))}
                  </div>
                )}
                <p className="text-xs text-[var(--glass-muted)] mt-1.5">
                  {searching
                    ? 'Searching…'
                    : 'Optional — leave blank and fill the details below if there is no matching job.'}
                </p>
              </div>
            )}
          </div>

          <div>
            <StockLabel required>Quantity in stock</StockLabel>
            <input
              type="number"
              inputMode="numeric"
              min={1}
              value={qty}
              onChange={(e) => setQty(e.target.value ? Number(e.target.value) : '')}
              placeholder="e.g. 12000"
              className={cn(inputCls, 'font-mono')}
            />
          </div>

          {/* Identity — auto-filled and locked when a job is picked, because
              the server takes the job's values regardless. */}
          <div>
            <StockLabel required={!pickedJob}>Party</StockLabel>
            <input
              value={party}
              onChange={(e) => setParty(e.target.value)}
              disabled={Boolean(pickedJob)}
              placeholder="e.g. DHANUKA - SANAND"
              className={cn(inputCls, 'disabled:opacity-60')}
            />
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <StockLabel>Job name</StockLabel>
              <input
                value={jobName}
                onChange={(e) => setJobName(e.target.value)}
                disabled={Boolean(pickedJob)}
                placeholder="Optional"
                className={cn(inputCls, 'disabled:opacity-60')}
              />
            </div>
            <div>
              <StockLabel>PM code</StockLabel>
              <input
                value={pmCode}
                onChange={(e) => setPmCode(e.target.value)}
                disabled={Boolean(pickedJob)}
                placeholder="Optional"
                className={cn(inputCls, 'font-mono disabled:opacity-60')}
              />
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <StockLabel>Location</StockLabel>
              <input
                value={location}
                onChange={(e) => setLocation(e.target.value)}
                placeholder="Rack / shelf"
                className={inputCls}
              />
            </div>
            <div>
              <StockLabel>Remark</StockLabel>
              <input
                value={remark}
                onChange={(e) => setRemark(e.target.value)}
                placeholder="Optional"
                className={inputCls}
              />
            </div>
          </div>
        </div>

        <div className="flex items-center justify-end gap-2 px-5 py-3.5 border-t border-white/12 shrink-0">
          <button
            type="button"
            onClick={onClose}
            disabled={saving}
            className="px-4 py-2 text-sm font-medium text-[var(--glass-muted)] hover:text-[var(--glass-ink)] disabled:opacity-40 transition-colors"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={saving}
            className={cn(
              'inline-flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium',
              'bg-brand-primary text-white hover:bg-brand-primary/90',
              'disabled:opacity-40 transition-colors',
            )}
          >
            <Check className="w-4 h-4" aria-hidden="true" />
            {saving ? 'Saving…' : 'Add to stock'}
          </button>
        </div>
      </form>
    </ModalShell>
  );
}

function StockLabel({ children, required }: { children: React.ReactNode; required?: boolean }) {
  return (
    <span className="block text-[11px] font-semibold uppercase tracking-[0.06em] text-[var(--glass-muted)] mb-1.5">
      {children}
      {required && <span className="text-red-300 ml-0.5" aria-hidden="true">*</span>}
    </span>
  );
}
