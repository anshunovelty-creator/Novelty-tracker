'use client';
// src/components/admin/BomManager.tsx
// Bill of Material — the material requisitions Production used to raise by
// mailing the owner, and the owner's answer to each line.
//
// Two audiences, one screen, split by `canDecide`: Production raises a
// request and watches it, Admin answers it line by line. Nobody else can
// open this at all (see /admin/bom/page.tsx and the bom_* RLS policies).
//
// The decision controls sit on the LINE, not the request, because "order
// the paper, halve the foil, use 100gsm instead of 90, skip the rest" is
// the ordinary answer. The request's own status is rolled up server-side
// by trigger, so this component never computes it.
//
// The list polls quietly in the background — the same visibility-aware
// pattern Job Separation uses, not Supabase Realtime — so a request raised
// on the floor shows up in the office without a manual refresh.

import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import {
  Plus, Trash2, X, Check, PackageCheck, PackageMinus, Repeat, Ban,
  Undo2, ClipboardList, AlertTriangle, Search, RotateCcw,
} from 'lucide-react';
import toast from 'react-hot-toast';
import { cn, formatNumericDate, formatQty } from '@/lib/utils';
import { csvDate, csvTimestamp, type CsvColumn } from '@/lib/export/csv';
import type {
  BomRequestWithItems, BomRequestItem, BomDecision, BomRequestStatus, BomPriority,
  BomMaterial,
} from '@/lib/types';
import { Skeleton } from '@/components/ui/Skeleton';
import CsvExportButton from './CsvExportButton';

// Loose on purpose — a requisition is answered in hours, not seconds, and
// the poll pauses entirely while the tab is hidden.
const POLL_MS = 30_000;

// Light-theme chips: color-100 fill + color-200 border + color-700/800 text,
// per DESIGN.md §2.5. Colour encodes state only, never decoration.
const STATUS_CHIP: Record<BomRequestStatus, string> = {
  pending:             'bg-amber-100 text-amber-800 border-amber-200',
  in_review:           'bg-sky-100 text-sky-800 border-sky-200',
  ordered:             'bg-emerald-100 text-emerald-800 border-emerald-200',
  partially_fulfilled: 'bg-orange-100 text-orange-800 border-orange-200',
  rejected:            'bg-red-100 text-red-700 border-red-200',
  cancelled:           'bg-slate-100 text-slate-600 border-slate-200',
};

// The floor's words, not the database's.
const STATUS_LABEL: Record<BomRequestStatus, string> = {
  pending:             'Awaiting owner',
  in_review:           'Partly answered',
  ordered:             'Ordered',
  partially_fulfilled: 'Partly fulfilled',
  rejected:            'Declined',
  cancelled:           'Withdrawn',
};

const DECISION_CHIP: Record<BomDecision, string> = {
  pending:     'bg-slate-100 text-slate-600 border-slate-200',
  ordered:     'bg-emerald-100 text-emerald-800 border-emerald-200',
  partial:     'bg-amber-100 text-amber-800 border-amber-200',
  alternative: 'bg-sky-100 text-sky-800 border-sky-200',
  rejected:    'bg-red-100 text-red-700 border-red-200',
};

const DECISION_LABEL: Record<BomDecision, string> = {
  pending:     'Awaiting',
  ordered:     'Ordered',
  partial:     'Part order',
  alternative: 'Alternative',
  rejected:    'Declined',
};

const FILTERS: { value: string; label: string }[] = [
  { value: 'open',                label: 'Open requests' },
  { value: 'pending',             label: 'Awaiting owner' },
  { value: 'in_review',           label: 'Partly answered' },
  { value: 'ordered',             label: 'Ordered' },
  { value: 'partially_fulfilled', label: 'Partly fulfilled' },
  { value: 'rejected',            label: 'Declined' },
  { value: 'cancelled',           label: 'Withdrawn' },
  { value: 'all',                 label: 'Everything' },
];

// Common units on the shop floor — offered as a datalist so the field stays
// free text for the ones that aren't here.
const UNITS = ['rolls', 'kg', 'sheets', 'reams', 'pcs', 'boxes'];

// The export is flattened to one row per material line, with the request
// header repeated. That is the shape the office actually uses it in —
// pasted into a supplier order or totalled in Excel — where one row per
// request with the materials crammed into a cell would be useless.
type BomExportRow = { request: BomRequestWithItems; item: BomRequestItem };

const BOM_EXPORT_COLUMNS: CsvColumn<BomExportRow>[] = [
  { header: 'Ref',           value: (r) => r.request.ref },
  { header: 'Status',        value: (r) => STATUS_LABEL[r.request.status] },
  { header: 'Priority',      value: (r) => r.request.priority === 'urgent' ? 'Urgent' : 'Normal' },
  { header: 'For Job / PO',  value: (r) => r.request.job_po },
  { header: 'Party',         value: (r) => r.request.party },
  { header: 'Needed By',     value: (r) => csvDate(r.request.needed_by) },
  { header: 'Raised',        value: (r) => csvTimestamp(r.request.created_at) },
  { header: 'Raised By',     value: (r) => r.request.raised_by },
  { header: 'Request Note',  value: (r) => r.request.note },
  { header: 'Material',      value: (r) => r.item.material },
  { header: 'Specification', value: (r) => r.item.specification },
  { header: 'Size',          value: (r) => r.item.size },
  { header: 'Qty Requested', value: (r) => r.item.quantity },
  { header: 'Unit',          value: (r) => r.item.unit },
  { header: 'Line Note',     value: (r) => r.item.note },
  { header: 'Decision',      value: (r) => DECISION_LABEL[r.item.decision] },
  { header: 'Qty Approved',  value: (r) => r.item.approved_quantity },
  { header: 'Alternative',   value: (r) => r.item.alternative_material },
  { header: 'Decision Note', value: (r) => r.item.decision_note },
  { header: 'Decided At',    value: (r) => csvTimestamp(r.item.decided_at) },
  { header: 'Decided By',    value: (r) => r.item.decided_by },
];

type DraftItem = {
  material:      string;
  specification: string;
  size:          string;
  quantity:      string;
  unit:          string;
  note:          string;
};

function blankItem(): DraftItem {
  return { material: '', specification: '', size: '', quantity: '', unit: '', note: '' };
}

// The line-level editor Admin opens for the two decisions that need a value
// alongside them: how much, or what instead.
type PendingDecision = {
  itemId:   string;
  decision: Extract<BomDecision, 'partial' | 'alternative'>;
  value:    string;
  note:     string;
};

export default function BomManager({ canDecide }: { canDecide: boolean }) {
  const [requests, setRequests] = useState<BomRequestWithItems[]>([]);
  const [loading,  setLoading]  = useState(true);
  const [filter,   setFilter]   = useState('open');
  const [search,   setSearch]   = useState('');
  // The material catalogue behind the form's typeahead. Fetched once —
  // it is a shop's material list, not a growing dataset.
  const [materials, setMaterials] = useState<BomMaterial[]>([]);

  const [raising, setRaising] = useState(false);
  const [saving,  setSaving]  = useState(false);
  const [busyId,  setBusyId]  = useState<string | null>(null);
  // The request whose Withdraw or Delete has been armed, and which of the
  // two it is. Two taps, never a browser dialog — same rule the rest of the
  // admin panel follows. One slot for both, so the header can never show
  // two armed destructive actions side by side.
  const [confirming, setConfirming] = useState<
    { id: string; action: 'withdraw' | 'delete' } | null
  >(null);
  const [pending, setPending] = useState<PendingDecision | null>(null);

  // Raise-request draft
  const [jobPo,    setJobPo]    = useState('');
  const [party,    setParty]    = useState('');
  const [neededBy, setNeededBy] = useState('');
  const [priority, setPriority] = useState<BomPriority>('normal');
  const [note,     setNote]     = useState('');
  const [items,    setItems]    = useState<DraftItem[]>([blankItem()]);

  const load = useCallback(async (quiet = false) => {
    if (!quiet) setLoading(true);
    try {
      const params = new URLSearchParams({ status: filter });
      if (search.trim()) params.set('search', search.trim());

      const res  = await fetch(`/api/bom-requests?${params.toString()}`);
      const data = await res.json();
      if (res.ok) setRequests(data.requests ?? []);
      else if (!quiet) toast.error(data.error ?? 'Failed to load requests');
    } catch {
      if (!quiet) toast.error('Network error');
    } finally {
      if (!quiet) setLoading(false);
    }
  }, [filter, search]);

  // Debounced while typing in the search box, immediate otherwise — the
  // same pattern Dies and Job Separation use.
  useEffect(() => {
    const timer = setTimeout(() => load(), search ? 300 : 0);
    return () => clearTimeout(timer);
  }, [load, search]);

  // The catalogue only grows when a request is raised, so one fetch on
  // mount plus a refresh after each successful raise is enough.
  const loadMaterials = useCallback(async () => {
    try {
      const res  = await fetch('/api/bom-materials');
      if (!res.ok) return;   // Typeahead is a convenience; never toast for it.
      const data = await res.json();
      setMaterials(data.materials ?? []);
    } catch {
      // Offline or blocked: the field stays plain free text, which still works.
    }
  }, []);

  useEffect(() => { loadMaterials(); }, [loadMaterials]);

  // Exactly what's on screen, flattened one row per material line — the
  // filter and the search are already applied to `requests`.
  const exportRows = useMemo<BomExportRow[]>(
    () => requests.flatMap((request) => request.items.map((item) => ({ request, item }))),
    [requests]
  );

  // Background refresh. Skipped while the tab is hidden and while a form is
  // open, so a poll can never overwrite something half-typed.
  const raisingRef = useRef(raising);
  raisingRef.current = raising;
  const pendingRef = useRef(pending);
  pendingRef.current = pending;

  useEffect(() => {
    const timer = setInterval(() => {
      if (document.visibilityState !== 'visible') return;
      if (raisingRef.current || pendingRef.current) return;
      load(true);
    }, POLL_MS);
    return () => clearInterval(timer);
  }, [load]);

  function resetDraft() {
    setJobPo(''); setParty(''); setNeededBy('');
    setPriority('normal'); setNote(''); setItems([blankItem()]);
  }

  function updateItem(index: number, patch: Partial<DraftItem>) {
    setItems((prev) => prev.map((item, i) => (i === index ? { ...item, ...patch } : item)));
  }

  /**
   * Material field changes go through here so that landing on a catalogue
   * entry fills in the rest of the line. Only blanks are filled — something
   * typed by hand always outranks the catalogue's remembered default.
   */
  function applyMaterial(index: number, name: string) {
    const match = materials.find((m) => m.name_key === name.trim().toLowerCase());

    setItems((prev) => prev.map((item, i) => {
      if (i !== index) return item;
      const next: DraftItem = { ...item, material: name };
      if (!match) return next;
      if (!next.specification && match.specification) next.specification = match.specification;
      if (!next.size         && match.default_size)  next.size          = match.default_size;
      if (!next.unit         && match.default_unit)  next.unit          = match.default_unit;
      return next;
    }));
  }

  /**
   * Re-raise a past requisition: same materials and quantities, blank
   * needed-by, no decisions carried over. The common case is the monthly
   * restock of exactly what was ordered last time.
   */
  function reorder(request: BomRequestWithItems) {
    setJobPo(request.job_po ?? '');
    setParty(request.party ?? '');
    setNeededBy('');                       // "when" is the one thing that never repeats
    setPriority(request.priority);
    setNote(request.note ?? '');
    setItems(request.items.map((item) => ({
      material:      item.material,
      specification: item.specification ?? '',
      size:          item.size ?? '',
      quantity:      item.quantity !== null ? String(item.quantity) : '',
      unit:          item.unit ?? '',
      note:          item.note ?? '',
    })));
    setRaising(true);

    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    window.scrollTo({ top: 0, behavior: reduced ? 'auto' : 'smooth' });
    toast.success(`Copied ${request.ref} — check the quantities before sending`);
  }

  async function submitRequest() {
    const filled = items.filter((item) => item.material.trim());
    if (filled.length === 0) {
      toast.error('Add at least one material');
      return;
    }

    setSaving(true);
    try {
      const res = await fetch('/api/bom-requests', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          job_po: jobPo, party, needed_by: neededBy || null, priority, note,
          items: filled.map((item) => ({
            material:      item.material,
            specification: item.specification,
            size:          item.size,
            quantity:      item.quantity === '' ? null : Number(item.quantity),
            unit:          item.unit,
            note:          item.note,
          })),
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        toast.error(data.error ?? 'Failed to raise request');
        return;
      }
      toast.success(`${data.request.ref} raised`);
      resetDraft();
      setRaising(false);
      // Refetch rather than prepending: the current filter may exclude it.
      load(true);
      // Any new material names on that request are now in the catalogue.
      loadMaterials();
    } catch {
      toast.error('Network error');
    } finally {
      setSaving(false);
    }
  }

  // Applies one line's decision. `extra` carries the quantity or the
  // substitute material for the two decisions that need one.
  async function decide(
    requestId: string,
    item: BomRequestItem,
    decision: BomDecision,
    extra?: { approved_quantity?: number; alternative_material?: string; decision_note?: string },
  ) {
    setBusyId(item.id);
    try {
      const res = await fetch(`/api/bom-requests/${requestId}/items/${item.id}`, {
        method:  'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ decision, ...extra }),
      });
      const data = await res.json();
      if (!res.ok) {
        toast.error(data.error ?? 'Failed to save decision');
        return;
      }
      // The server hands back the whole request with its freshly rolled-up
      // status, so swap the card wholesale instead of patching one line.
      if (data.request) {
        setRequests((prev) => prev.map((r) => (r.id === requestId ? data.request : r)));
      }
      setPending(null);
      toast.success(
        decision === 'pending'
          ? 'Decision cleared'
          : `${item.material} — ${DECISION_LABEL[decision].toLowerCase()}`
      );
    } catch {
      toast.error('Network error');
    } finally {
      setBusyId(null);
    }
  }

  function savePendingDecision(requestId: string, item: BomRequestItem) {
    if (!pending) return;

    if (pending.decision === 'partial') {
      const qty = Number(pending.value);
      if (!pending.value.trim() || !Number.isFinite(qty) || qty <= 0) {
        toast.error('Enter how much you are ordering');
        return;
      }
      decide(requestId, item, 'partial', {
        approved_quantity: qty,
        decision_note: pending.note || undefined,
      });
      return;
    }

    if (!pending.value.trim()) {
      toast.error('Name the alternative material');
      return;
    }
    decide(requestId, item, 'alternative', {
      alternative_material: pending.value.trim(),
      decision_note: pending.note || undefined,
    });
  }

  async function withdraw(request: BomRequestWithItems) {
    setBusyId(request.id);
    try {
      const res = await fetch(`/api/bom-requests/${request.id}`, {
        method:  'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ action: 'cancel' }),
      });
      const data = await res.json();
      if (!res.ok) {
        toast.error(data.error ?? 'Failed to withdraw');
        return;
      }
      toast.success(`${request.ref} withdrawn`);
      load(true);
    } catch {
      toast.error('Network error');
    } finally {
      setBusyId(null);
      setConfirming(null);
    }
  }

  // Hard delete, Admin only — the API rejects everyone else. This is for
  // mis-entries and test rows, not for "we decided against it": that's what
  // Withdraw and Decline are for, and they keep the paper trail.
  async function removeRequest(request: BomRequestWithItems) {
    setBusyId(request.id);
    try {
      const res = await fetch(`/api/bom-requests/${request.id}`, { method: 'DELETE' });
      const data = await res.json();
      if (!res.ok) {
        toast.error(data.error ?? 'Failed to delete');
        return;
      }
      setRequests((prev) => prev.filter((r) => r.id !== request.id));
      toast.success(`${request.ref} deleted`);
    } catch {
      toast.error('Network error');
    } finally {
      setBusyId(null);
      setConfirming(null);
    }
  }

  return (
    <div className="space-y-4">
      {/* ── Controls ───────────────────────────────────────────── */}
      <div className="flex flex-wrap items-center gap-2">
        <label htmlFor="bom-filter" className="sr-only">Filter requests</label>
        <select
          id="bom-filter"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          className="min-h-[44px] rounded-lg border border-black/[0.08] bg-white px-3 py-2 text-sm text-[var(--glass-ink)] focus:border-emerald-400 focus:outline-none focus:ring-2 focus:ring-emerald-200"
        >
          {FILTERS.map((option) => (
            <option key={option.value} value={option.value}>{option.label}</option>
          ))}
        </select>

        {/* Searches the ref, job/PO, party and note — and the material names
            on the lines, which is how people actually look a requisition up
            ("the one with the metallic poly"). data-global-search wires it
            to the Ctrl+K shortcut the rest of the admin panel uses. */}
        <div className="relative min-w-[16rem] flex-1 sm:max-w-sm">
          <Search
            className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--glass-muted)]"
            aria-hidden="true"
          />
          <input
            type="search"
            data-global-search
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search ref, PO, party or material"
            aria-label="Search material requests"
            className={cn(inputClass, 'pl-9')}
          />
        </div>

        <div className="flex-1" />

        <CsvExportButton
          rows={exportRows}
          columns={BOM_EXPORT_COLUMNS}
          filename="bill-of-material"
        />

        <button
          type="button"
          onClick={() => { setRaising((open) => !open); if (raising) resetDraft(); }}
          className="inline-flex min-h-[44px] items-center gap-2 rounded-lg bg-[#10553F] px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-[#0C4232] focus:outline-none focus:ring-2 focus:ring-emerald-300"
        >
          {raising ? <X className="h-4 w-4" aria-hidden="true" /> : <Plus className="h-4 w-4" aria-hidden="true" />}
          {raising ? 'Cancel' : 'Raise request'}
        </button>
      </div>

      {/* ── Raise a request ────────────────────────────────────── */}
      {raising && (
        <div className="rounded-2xl border border-black/[0.08] bg-white p-4 sm:p-5 shadow-[0_2px_8px_rgba(12,42,32,0.05)]">
          <h2 className="text-base font-semibold text-[var(--glass-ink)]">New material request</h2>
          <p className="mt-1 text-xs text-[var(--glass-muted)]">
            One request, as many materials as the job needs. Admin answers each line separately.
          </p>

          <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <Field label="For job / PO (optional)">
              <input
                value={jobPo}
                onChange={(e) => setJobPo(e.target.value)}
                placeholder="PO-1187"
                className={inputClass}
              />
            </Field>
            <Field label="Party (optional)">
              <input
                value={party}
                onChange={(e) => setParty(e.target.value)}
                placeholder="Amrut Label"
                className={inputClass}
              />
            </Field>
            <Field label="Needed by">
              <input
                type="date"
                value={neededBy}
                onChange={(e) => setNeededBy(e.target.value)}
                className={inputClass}
              />
            </Field>
            <Field label="Priority">
              <select
                value={priority}
                onChange={(e) => setPriority(e.target.value as BomPriority)}
                className={inputClass}
              >
                <option value="normal">Normal</option>
                <option value="urgent">Urgent</option>
              </select>
            </Field>
          </div>

          {/* Line items */}
          <div className="mt-5 space-y-3">
            <div className="flex items-center justify-between">
              <h3 className="text-xs font-medium uppercase tracking-wide text-[var(--glass-muted)]">
                Materials
              </h3>
              <button
                type="button"
                onClick={() => setItems((prev) => [...prev, blankItem()])}
                className="inline-flex min-h-[44px] items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium text-[#10553F] transition-colors hover:bg-emerald-50"
              >
                <Plus className="h-3.5 w-3.5" aria-hidden="true" />
                Add material
              </button>
            </div>

            <datalist id="bom-units">
              {UNITS.map((unit) => <option key={unit} value={unit} />)}
            </datalist>

            {/* Every material anyone has requested before. Picking one keeps
                the spelling consistent — the whole reason bom_materials
                exists — and fills in the spec, size and unit it was last
                requested with. The field stays free text, so a material
                nobody has ordered yet is still just typed in, and joins the
                catalogue when the request is sent. */}
            <datalist id="bom-materials">
              {materials.map((material) => (
                <option key={material.id} value={material.name}>
                  {[material.specification, material.default_size]
                    .filter(Boolean).join(' · ')}
                </option>
              ))}
            </datalist>

            {items.map((item, index) => (
              <div
                key={index}
                className="grid gap-2 rounded-xl border border-black/[0.06] bg-[#F4F8F5] p-3 sm:grid-cols-12"
              >
                <div className="sm:col-span-4">
                  <label className="sr-only" htmlFor={`material-${index}`}>Material</label>
                  <input
                    id={`material-${index}`}
                    list="bom-materials"
                    value={item.material}
                    onChange={(e) => applyMaterial(index, e.target.value)}
                    placeholder="Material name"
                    className={inputClass}
                  />
                </div>
                <div className="sm:col-span-2">
                  <input
                    value={item.specification}
                    onChange={(e) => updateItem(index, { specification: e.target.value })}
                    placeholder="Specification"
                    aria-label={`Specification for material ${index + 1}`}
                    className={inputClass}
                  />
                </div>
                <div className="sm:col-span-2">
                  <input
                    value={item.size}
                    onChange={(e) => updateItem(index, { size: e.target.value })}
                    placeholder="Size, e.g. 320mm"
                    aria-label={`Size for material ${index + 1}`}
                    className={inputClass}
                  />
                </div>
                <div className="sm:col-span-1">
                  <input
                    type="number"
                    min="0"
                    step="any"
                    inputMode="decimal"
                    value={item.quantity}
                    onChange={(e) => updateItem(index, { quantity: e.target.value })}
                    placeholder="Qty"
                    aria-label={`Quantity for material ${index + 1}`}
                    className={cn(inputClass, 'font-mono tabular-nums')}
                  />
                </div>
                <div className="sm:col-span-2">
                  <input
                    list="bom-units"
                    value={item.unit}
                    onChange={(e) => updateItem(index, { unit: e.target.value })}
                    placeholder="Unit"
                    aria-label={`Unit for material ${index + 1}`}
                    className={inputClass}
                  />
                </div>
                <div className="flex items-center justify-end sm:col-span-1">
                  <button
                    type="button"
                    onClick={() => setItems((prev) =>
                      prev.length === 1 ? [blankItem()] : prev.filter((_, i) => i !== index)
                    )}
                    aria-label={`Remove material ${index + 1}`}
                    className="inline-flex h-11 w-11 items-center justify-center rounded-lg text-[var(--glass-muted)] transition-colors hover:bg-red-50 hover:text-red-600"
                  >
                    <Trash2 className="h-4 w-4" aria-hidden="true" />
                  </button>
                </div>
              </div>
            ))}
          </div>

          <div className="mt-4">
            <Field label="Note for Admin (optional)">
              <textarea
                value={note}
                onChange={(e) => setNote(e.target.value)}
                rows={2}
                placeholder="Anything the owner should know before ordering"
                className={cn(inputClass, 'resize-y')}
              />
            </Field>
          </div>

          <div className="mt-4 flex justify-end gap-2">
            <button
              type="button"
              onClick={() => { setRaising(false); resetDraft(); }}
              className="min-h-[44px] rounded-lg px-4 py-2 text-sm font-medium text-[var(--glass-muted)] transition-colors hover:bg-black/[0.04] hover:text-[var(--glass-ink)]"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={submitRequest}
              disabled={saving}
              className="inline-flex min-h-[44px] items-center gap-2 rounded-lg bg-[#10553F] px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-[#0C4232] disabled:opacity-40"
            >
              <Check className="h-4 w-4" aria-hidden="true" />
              {saving ? 'Sending…' : 'Send to Admin'}
            </button>
          </div>
        </div>
      )}

      {/* ── The requests ───────────────────────────────────────── */}
      {loading ? (
        // Shaped like the cards it replaces — a ref, a status chip, the
        // metadata line, then two material rows. SkeletonRows is table-only
        // (it emits <tr>), so it cannot be reused here.
        <div className="space-y-3">
          {[0, 1].map((card) => (
            <div
              key={card}
              className="space-y-3 rounded-2xl border border-black/[0.08] bg-white p-4"
            >
              <div className="flex items-center gap-3">
                <Skeleton className="h-4 w-20" />
                <Skeleton className="h-5 w-28 rounded-full" />
              </div>
              <Skeleton className="h-3 w-2/3" />
              <div className="space-y-2 pt-1">
                <Skeleton className="h-4 w-1/2" />
                <Skeleton className="h-4 w-2/5" />
              </div>
            </div>
          ))}
        </div>
      ) : requests.length === 0 ? (
        <EmptyState filter={filter} canDecide={canDecide} search={search} />
      ) : (
        <div className="space-y-3">
          {requests.map((request) => (
            <article
              key={request.id}
              className="rounded-2xl border border-black/[0.08] bg-white shadow-[0_2px_8px_rgba(12,42,32,0.05)]"
            >
              {/* Card header */}
              <header className="flex flex-wrap items-start gap-x-3 gap-y-2 border-b border-black/[0.06] p-4">
                <span className="font-mono text-sm font-semibold tabular-nums text-[var(--glass-ink)]">
                  {request.ref}
                </span>

                <span className={cn(
                  'rounded-full border px-2 py-0.5 text-xs font-medium',
                  STATUS_CHIP[request.status]
                )}>
                  {STATUS_LABEL[request.status]}
                </span>

                {request.priority === 'urgent' && request.status !== 'cancelled' && (
                  <span className="inline-flex items-center gap-1 rounded-full border border-red-200 bg-red-100 px-2 py-0.5 text-xs font-medium text-red-700">
                    <AlertTriangle className="h-3 w-3" aria-hidden="true" />
                    Urgent
                  </span>
                )}

                <div className="flex-1" />

                {/* Two destructive actions, one confirm slot. Withdraw is
                    offered only while nothing has been decided (the API
                    enforces that too); Delete is Admin-only and always
                    available, for mis-entries rather than change of mind. */}
                <div className="flex items-center gap-1">
                  {confirming?.id === request.id ? (
                    <>
                      <button
                        type="button"
                        onClick={() =>
                          confirming.action === 'delete'
                            ? removeRequest(request)
                            : withdraw(request)
                        }
                        disabled={busyId === request.id}
                        className="min-h-[44px] rounded-lg border border-red-200 bg-red-50 px-3 py-1.5 text-xs font-semibold text-red-700 transition-colors hover:bg-red-100 disabled:opacity-40"
                      >
                        {confirming.action === 'delete' ? 'Delete for good' : 'Confirm'}
                      </button>
                      <button
                        type="button"
                        onClick={() => setConfirming(null)}
                        className="min-h-[44px] rounded-lg px-3 py-1.5 text-xs font-medium text-[var(--glass-muted)] transition-colors hover:bg-black/[0.04]"
                      >
                        Keep
                      </button>
                    </>
                  ) : (
                    <>
                      {/* Restocking the same materials is the norm, so the
                          fastest path to a new request is copying an old
                          one rather than retyping six lines. */}
                      <button
                        type="button"
                        onClick={() => reorder(request)}
                        title={`Raise a new request with the same materials as ${request.ref}`}
                        className="inline-flex min-h-[44px] items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium text-[var(--glass-muted)] transition-colors hover:bg-black/[0.04] hover:text-[var(--glass-ink)]"
                      >
                        <RotateCcw className="h-3.5 w-3.5" aria-hidden="true" />
                        Reorder
                      </button>
                      {request.status === 'pending' && (
                        <button
                          type="button"
                          onClick={() => setConfirming({ id: request.id, action: 'withdraw' })}
                          className="min-h-[44px] rounded-lg px-3 py-1.5 text-xs font-medium text-[var(--glass-muted)] transition-colors hover:bg-black/[0.04] hover:text-[var(--glass-ink)]"
                        >
                          Withdraw
                        </button>
                      )}
                      {canDecide && (
                        <button
                          type="button"
                          onClick={() => setConfirming({ id: request.id, action: 'delete' })}
                          aria-label={`Delete ${request.ref} permanently`}
                          title="Delete permanently — use Withdraw or Decline to keep the record"
                          className="inline-flex h-11 w-11 items-center justify-center rounded-lg text-[var(--glass-muted)] transition-colors hover:bg-red-50 hover:text-red-600"
                        >
                          <Trash2 className="h-4 w-4" aria-hidden="true" />
                        </button>
                      )}
                    </>
                  )}
                </div>

                {/* Metadata line — every value in mono per the Mono Number Rule */}
                <dl className="flex w-full flex-wrap items-center gap-x-4 gap-y-1 text-xs text-[var(--glass-muted)]">
                  {request.job_po && (
                    <div className="flex items-center gap-1.5">
                      <dt>For</dt>
                      <dd className="font-mono text-[var(--glass-ink)]">{request.job_po}</dd>
                    </div>
                  )}
                  {request.party && (
                    <div className="flex items-center gap-1.5">
                      <dt className="sr-only">Party</dt>
                      <dd>{request.party}</dd>
                    </div>
                  )}
                  {request.needed_by && (
                    <div className="flex items-center gap-1.5">
                      <dt>Needed by</dt>
                      <dd className="font-mono tabular-nums text-[var(--glass-ink)]">
                        {formatNumericDate(request.needed_by)}
                      </dd>
                    </div>
                  )}
                  <div className="flex items-center gap-1.5">
                    <dt>Raised</dt>
                    <dd className="font-mono tabular-nums">{formatNumericDate(request.created_at)}</dd>
                  </div>
                  {request.raised_by && (
                    <div className="flex items-center gap-1.5">
                      <dt>by</dt>
                      <dd>{request.raised_by}</dd>
                    </div>
                  )}
                </dl>

                {request.note && (
                  <p className="w-full whitespace-pre-wrap text-xs text-[var(--glass-muted)]">
                    {request.note}
                  </p>
                )}
              </header>

              {/* Line items */}
              <ul className="divide-y divide-black/[0.06]">
                {request.items.map((item) => {
                  const editing = pending?.itemId === item.id;
                  const decided = item.decision !== 'pending';

                  return (
                    <li key={item.id} className="p-4">
                      <div className="flex flex-wrap items-start gap-x-3 gap-y-2">
                        <div className="min-w-0 flex-1">
                          <p className="text-sm font-medium text-[var(--glass-ink)]">
                            {item.material}
                          </p>
                          <p className="mt-0.5 flex flex-wrap items-center gap-x-3 text-xs text-[var(--glass-muted)]">
                            {item.specification && <span>{item.specification}</span>}
                            {item.size && <span className="font-mono">{item.size}</span>}
                            {item.quantity !== null && (
                              <span className="font-mono tabular-nums text-[var(--glass-ink)]">
                                {formatQty(item.quantity)}{item.unit ? ` ${item.unit}` : ''}
                              </span>
                            )}
                          </p>
                          {item.note && (
                            <p className="mt-1 whitespace-pre-wrap text-xs text-[var(--glass-muted)]">
                              {item.note}
                            </p>
                          )}
                        </div>

                        <span className={cn(
                          'rounded-full border px-2 py-0.5 text-xs font-medium',
                          DECISION_CHIP[item.decision]
                        )}>
                          {DECISION_LABEL[item.decision]}
                          {item.decision === 'partial' && item.approved_quantity !== null && (
                            <span className="ml-1 font-mono tabular-nums">
                              {formatQty(item.approved_quantity)}{item.unit ? ` ${item.unit}` : ''}
                            </span>
                          )}
                        </span>
                      </div>

                      {/* What the owner decided, in their own words */}
                      {item.decision === 'alternative' && item.alternative_material && (
                        <p className="mt-2 rounded-lg border border-sky-200 bg-sky-50 px-3 py-2 text-xs text-sky-900">
                          Use instead: <span className="font-medium">{item.alternative_material}</span>
                        </p>
                      )}
                      {item.decision_note && (
                        <p className="mt-2 whitespace-pre-wrap text-xs text-[var(--glass-muted)]">
                          {item.decision_note}
                        </p>
                      )}

                      {/* Admin's decision controls */}
                      {canDecide && request.status !== 'cancelled' && (
                        editing && pending ? (
                          <div className="mt-3 rounded-xl border border-black/[0.06] bg-[#F4F8F5] p-3">
                            <label className="block text-xs font-medium text-[var(--glass-ink)]">
                              {pending.decision === 'partial'
                                ? `How much are you ordering?${item.unit ? ` (${item.unit})` : ''}`
                                : 'What should they use instead?'}
                            </label>
                            <div className="mt-2 flex flex-wrap gap-2">
                              <input
                                autoFocus
                                type={pending.decision === 'partial' ? 'number' : 'text'}
                                min={pending.decision === 'partial' ? '0' : undefined}
                                step={pending.decision === 'partial' ? 'any' : undefined}
                                inputMode={pending.decision === 'partial' ? 'decimal' : undefined}
                                value={pending.value}
                                onChange={(e) => setPending({ ...pending, value: e.target.value })}
                                placeholder={
                                  pending.decision === 'partial'
                                    ? `of ${formatQty(item.quantity)}`
                                    : 'e.g. Kraft 100gsm from stock'
                                }
                                className={cn(
                                  inputClass,
                                  'flex-1 min-w-[10rem]',
                                  pending.decision === 'partial' && 'font-mono tabular-nums'
                                )}
                              />
                              <input
                                value={pending.note}
                                onChange={(e) => setPending({ ...pending, note: e.target.value })}
                                placeholder="Note (optional)"
                                aria-label="Decision note"
                                className={cn(inputClass, 'flex-1 min-w-[10rem]')}
                              />
                            </div>
                            <div className="mt-2 flex justify-end gap-2">
                              <button
                                type="button"
                                onClick={() => setPending(null)}
                                className="min-h-[44px] rounded-lg px-3 py-1.5 text-xs font-medium text-[var(--glass-muted)] transition-colors hover:bg-black/[0.04]"
                              >
                                Cancel
                              </button>
                              <button
                                type="button"
                                onClick={() => savePendingDecision(request.id, item)}
                                disabled={busyId === item.id}
                                className="min-h-[44px] rounded-lg bg-[#10553F] px-3 py-1.5 text-xs font-semibold text-white transition-colors hover:bg-[#0C4232] disabled:opacity-40"
                              >
                                Save
                              </button>
                            </div>
                          </div>
                        ) : (
                          <div className="mt-3 flex flex-wrap items-center gap-1.5">
                            <DecisionButton
                              icon={PackageCheck}
                              label="Order"
                              active={item.decision === 'ordered'}
                              tone="emerald"
                              disabled={busyId === item.id}
                              onClick={() => decide(request.id, item, 'ordered')}
                            />
                            <DecisionButton
                              icon={PackageMinus}
                              label="Part order"
                              active={item.decision === 'partial'}
                              tone="amber"
                              disabled={busyId === item.id}
                              onClick={() => setPending({
                                itemId: item.id,
                                decision: 'partial',
                                value: item.approved_quantity !== null ? String(item.approved_quantity) : '',
                                note: item.decision_note ?? '',
                              })}
                            />
                            <DecisionButton
                              icon={Repeat}
                              label="Alternative"
                              active={item.decision === 'alternative'}
                              tone="sky"
                              disabled={busyId === item.id}
                              onClick={() => setPending({
                                itemId: item.id,
                                decision: 'alternative',
                                value: item.alternative_material ?? '',
                                note: item.decision_note ?? '',
                              })}
                            />
                            <DecisionButton
                              icon={Ban}
                              label="Decline"
                              active={item.decision === 'rejected'}
                              tone="red"
                              disabled={busyId === item.id}
                              onClick={() => decide(request.id, item, 'rejected')}
                            />
                            {decided && (
                              <button
                                type="button"
                                onClick={() => decide(request.id, item, 'pending')}
                                disabled={busyId === item.id}
                                className="inline-flex min-h-[44px] items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium text-[var(--glass-muted)] transition-colors hover:bg-black/[0.04] hover:text-[var(--glass-ink)] disabled:opacity-40"
                              >
                                <Undo2 className="h-3.5 w-3.5" aria-hidden="true" />
                                Undo
                              </button>
                            )}
                          </div>
                        )
                      )}

                      {/* Production's read-only view of who answered and when */}
                      {!canDecide && decided && item.decided_at && (
                        <p className="mt-2 text-xs text-[var(--glass-muted)]">
                          Answered <span className="font-mono tabular-nums">{formatNumericDate(item.decided_at)}</span>
                          {item.decided_by ? ` by ${item.decided_by}` : ''}
                        </p>
                      )}
                    </li>
                  );
                })}
              </ul>
            </article>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Small pieces ──────────────────────────────────────────────

const inputClass =
  'w-full min-h-[44px] rounded-lg border border-black/[0.08] bg-white px-3 py-2 text-sm text-[var(--glass-ink)] placeholder:text-[var(--glass-muted)] focus:border-emerald-400 focus:outline-none focus:ring-2 focus:ring-emerald-200';

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1 block text-xs font-medium uppercase tracking-wide text-[var(--glass-muted)]">
        {label}
      </span>
      {children}
    </label>
  );
}

const TONE_ACTIVE: Record<string, string> = {
  emerald: 'border-emerald-300 bg-emerald-100 text-emerald-800',
  amber:   'border-amber-300 bg-amber-100 text-amber-800',
  sky:     'border-sky-300 bg-sky-100 text-sky-800',
  red:     'border-red-300 bg-red-100 text-red-700',
};

const TONE_HOVER: Record<string, string> = {
  emerald: 'hover:border-emerald-300 hover:bg-emerald-50 hover:text-emerald-800',
  amber:   'hover:border-amber-300 hover:bg-amber-50 hover:text-amber-800',
  sky:     'hover:border-sky-300 hover:bg-sky-50 hover:text-sky-800',
  red:     'hover:border-red-300 hover:bg-red-50 hover:text-red-700',
};

function DecisionButton({
  icon: Icon, label, active, tone, disabled, onClick,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  active: boolean;
  tone: keyof typeof TONE_ACTIVE;
  disabled: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-pressed={active}
      className={cn(
        'inline-flex min-h-[44px] items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-medium transition-colors disabled:opacity-40',
        active
          ? TONE_ACTIVE[tone]
          : cn('border-black/[0.08] bg-white text-[var(--glass-muted)]', TONE_HOVER[tone])
      )}
    >
      <Icon className="h-3.5 w-3.5" />
      {label}
    </button>
  );
}

function EmptyState({
  filter, canDecide, search,
}: { filter: string; canDecide: boolean; search: string }) {
  const isOpenFilter = filter === 'open' || filter === 'pending';
  const searching = search.trim().length > 0;

  // A search that found nothing is a different situation from an empty
  // queue, and saying "nothing waiting" there reads as a bug.
  if (searching) {
    return (
      <div className="flex flex-col items-center justify-center rounded-2xl border border-black/[0.08] bg-white px-4 py-12 text-center">
        <Search className="h-8 w-8 text-[var(--glass-muted)]" aria-hidden="true" />
        <p className="mt-3 text-sm font-medium text-[var(--glass-ink)]">
          No match for “{search.trim()}”
        </p>
        <p className="mt-1 max-w-sm text-xs text-[var(--glass-muted)]">
          Searched refs, jobs, parties, notes and material names
          {isOpenFilter ? ' in open requests — try “Everything”.' : ' in this filter.'}
        </p>
      </div>
    );
  }

  return (
    <div className="flex flex-col items-center justify-center rounded-2xl border border-black/[0.08] bg-white px-4 py-12 text-center">
      <ClipboardList className="h-8 w-8 text-[var(--glass-muted)]" aria-hidden="true" />
      <p className="mt-3 text-sm font-medium text-[var(--glass-ink)]">
        {isOpenFilter ? 'Nothing waiting' : 'Nothing here'}
      </p>
      <p className="mt-1 max-w-sm text-xs text-[var(--glass-muted)]">
        {isOpenFilter
          ? canDecide
            ? 'No open material requests from Production right now.'
            : 'Every request you have raised has been answered. Raise a new one when the floor needs stock.'
          : 'No requests match this filter.'}
      </p>
    </div>
  );
}
