'use client';
// src/components/admin/CylindersManager.tsx
// The cylinder list: one row per press cylinder, with how many of each size
// and type the shop owns on top. Same shape as PlatesManager — read-only for
// most departments; cylinders_edit can add, correct and remove records.
//
// The add/edit form lives here too: five fields don't earn their own file.

import React, { useState, useMemo, useId } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Search, Plus, Pencil, Trash2, Check, X, Cylinder as CylinderIcon } from 'lucide-react';
import toast from 'react-hot-toast';
import { cn, formatNumericDate } from '@/lib/utils';
import { Button } from '@/components/ui/Button';
import { csvDate, csvTimestamp, type CsvColumn } from '@/lib/export/csv';
import { compareValues, type SortDir } from '@/lib/sort';
import { CYLINDER_TYPES, repeatLengthMm } from '@/lib/cylinders';
import type { Cylinder } from '@/lib/types';
import CsvExportButton from './CsvExportButton';
import SortableHeaderLabel from './SortableHeaderLabel';
import { SkeletonRows } from '@/components/ui/Skeleton';
import { SearchClearButton } from '@/components/ui/SearchClearButton';
import { ModalShell } from './modals';
import { WithExample, WithUnit } from '@/components/ui/FieldAffix';

type SortField = 'serial_no' | 'teeth' | 'type' | 'manufacturer' | 'purchase_date';

// Header label → sort field, in <td> order. Repeat length follows teeth,
// so sorting by Teeth already orders it.
const COLUMNS: [string, SortField | null][] = [
  ['Serial No.', 'serial_no'], ['Teeth', 'teeth'], ['Repeat length', null], ['Type', 'type'],
  ['Manufacturer', 'manufacturer'], ['Purchase date', 'purchase_date'], ['Actions', null],
];

const SORT_KIND: Record<SortField, 'text' | 'number' | 'date'> = {
  serial_no: 'text', teeth: 'number', type: 'text', manufacturer: 'text', purchase_date: 'date',
};

const EMPTY: Cylinder[] = [];

const mm = (teeth: number) => `${repeatLengthMm(teeth).toFixed(3)} mm`;

const EXPORT_COLUMNS: CsvColumn<Cylinder>[] = [
  { header: 'Serial No.',         value: (c) => c.serial_no },
  { header: 'Teeth',              value: (c) => c.teeth },
  { header: 'Repeat Length (mm)', value: (c) => repeatLengthMm(c.teeth) },
  { header: 'Type',               value: (c) => c.type },
  { header: 'Manufacturer',       value: (c) => c.manufacturer },
  { header: 'Purchase Date',      value: (c) => csvDate(c.purchase_date) },
  { header: 'Added',              value: (c) => csvTimestamp(c.created_at) },
];

const fieldCls = cn(
  'min-h-11 px-3 rounded-xl text-sm',
  'bg-[var(--field-bg)] border border-[var(--field-border)] text-[var(--glass-ink)]',
  'placeholder:text-[var(--glass-muted)] focus:outline-none',
  'focus:border-emerald-300/70 focus:shadow-[0_0_0_4px_rgba(124,240,190,0.22)] transition-all',
);

export default function CylindersManager({ canManage }: { canManage: boolean }) {
  const queryClient = useQueryClient();
  const [search,    setSearch]    = useState('');
  const [type,      setType]      = useState<'all' | Cylinder['type']>('all');
  const [editing,   setEditing]   = useState<Cylinder | 'new' | null>(null);
  const [confirmId, setConfirmId] = useState<string | null>(null);
  const [busyId,    setBusyId]    = useState<string | null>(null);
  const [sortField, setSortField] = useState<SortField>('teeth');
  const [sortDir,   setSortDir]   = useState<SortDir>('asc');

  const query = useQuery({
    queryKey: ['cylinders'],
    queryFn: async () => {
      const res  = await fetch('/api/cylinders');
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? 'Failed to load cylinders');
      return (data.cylinders ?? []) as Cylinder[];
    },
  });
  const all = query.data ?? EMPTY;

  // Serial, manufacturer or teeth: "96" finds 96-teeth cylinders as well as
  // serials containing 96.
  const rows = useMemo(() => {
    const q = search.trim().toLowerCase();
    const hit = all.filter((c) =>
      (type === 'all' || c.type === type) &&
      (!q || c.serial_no.toLowerCase().includes(q) || (c.manufacturer ?? '').toLowerCase().includes(q) || String(c.teeth) === q),
    );
    const kind = SORT_KIND[sortField];
    return hit.sort((a, b) => {
      const diff = compareValues(a[sortField], b[sortField], kind);
      return sortDir === 'asc' ? diff : -diff;
    });
  }, [all, search, type, sortField, sortDir]);

  // "How many 96T print cylinders do we have?" — over everything, not the search.
  const counts = useMemo(() => {
    const m = new Map<string, { teeth: number; type: string; n: number }>();
    for (const c of all) {
      const k = `${c.teeth}|${c.type}`;
      const e = m.get(k) ?? { teeth: c.teeth, type: c.type, n: 0 };
      e.n += 1;
      m.set(k, e);
    }
    return Array.from(m.values()).sort((a, b) => a.teeth - b.teeth || a.type.localeCompare(b.type));
  }, [all]);

  const handleSort = (field: SortField) => {
    if (field === sortField) setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    else { setSortField(field); setSortDir('asc'); }
  };

  async function remove(c: Cylinder) {
    setBusyId(c.id);
    try {
      const res = await fetch(`/api/cylinders/${c.id}`, { method: 'DELETE' });
      const data = await res.json();
      if (!res.ok) { toast.error(data.error ?? 'Failed to delete cylinder'); return; }
      queryClient.setQueryData<Cylinder[]>(['cylinders'], (old) => old?.filter((x) => x.id !== c.id));
      toast.success('Cylinder deleted');
    } catch {
      toast.error('Network error');
    } finally {
      setBusyId(null);
      setConfirmId(null);
    }
  }

  const actions = (c: Cylinder) => canManage && (
    <div className="inline-flex items-center gap-1.5">
      <button
        onClick={() => setEditing(c)}
        aria-label={`Edit cylinder ${c.serial_no}`}
        title="Edit"
        className="inline-flex items-center justify-center min-h-11 min-w-11 rounded-lg border border-black/[0.12] text-[var(--glass-muted)] hover:bg-black/[0.04] hover:text-[var(--glass-ink)] transition-colors"
      >
        <Pencil className="w-3.5 h-3.5" aria-hidden="true" />
      </button>
      {confirmId === c.id ? (
        <>
          <button
            onClick={() => remove(c)}
            disabled={busyId === c.id}
            className="inline-flex items-center justify-center min-h-11 px-2.5 rounded-lg text-[11px] font-medium border border-red-200 bg-red-50 text-red-800 hover:bg-red-100 disabled:opacity-50 transition-colors whitespace-nowrap"
          >
            {busyId === c.id ? '…' : 'Confirm'}
          </button>
          <button
            onClick={() => setConfirmId(null)}
            disabled={busyId === c.id}
            className="inline-flex items-center justify-center min-h-11 px-1.5 text-[11px] font-medium text-[var(--glass-muted)] hover:text-[var(--glass-ink)] disabled:opacity-40 transition-colors"
          >
            Cancel
          </button>
        </>
      ) : (
        <button
          onClick={() => setConfirmId(c.id)}
          aria-label={`Delete cylinder ${c.serial_no}`}
          title="Delete"
          className="inline-flex items-center justify-center min-h-11 min-w-11 rounded-lg border border-black/[0.12] text-[var(--glass-muted)] hover:bg-red-50 hover:border-red-200 hover:text-red-800 transition-colors"
        >
          <Trash2 className="w-3.5 h-3.5" aria-hidden="true" />
        </button>
      )}
    </div>
  );

  return (
    <div className="space-y-3">
      <div className="flex flex-col sm:flex-row sm:items-center gap-2">
        <select
          value={type}
          onChange={(e) => setType(e.target.value as typeof type)}
          aria-label="Cylinder type"
          className={cn(fieldCls, 'shrink-0')}
        >
          <option value="all">All types</option>
          {CYLINDER_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
        </select>

        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[var(--glass-muted)]" aria-hidden="true" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search serial number, teeth or manufacturer"
            aria-label="Search cylinders"
            title="Search this page (/)"
            data-global-search
            className={cn(fieldCls, 'w-full pl-9 pr-11')}
          />
          <SearchClearButton value={search} onClear={() => setSearch('')} />
        </div>

        <CsvExportButton rows={rows} columns={EXPORT_COLUMNS} filename="cylinders" />

        {canManage && (
          <Button intent="primary" icon={Plus} onClick={() => setEditing('new')}>
            Add cylinder
          </Button>
        )}
      </div>

      {counts.length > 0 && (
        <ul className="flex flex-wrap gap-2" aria-label="Cylinders owned by size and type">
          {counts.map((c) => (
            <li key={`${c.teeth}|${c.type}`} className="rounded-lg border border-black/[0.08] bg-white px-3 py-1.5 text-sm">
              <span className="font-mono font-semibold text-[var(--glass-ink)]">{c.teeth}T</span>
              <span className="text-[var(--glass-muted)]"> {c.type} · </span>
              <span className="font-mono font-semibold text-[var(--glass-ink)]">{c.n}</span>
            </li>
          ))}
        </ul>
      )}

      {query.isLoading ? (
        <div className="rounded-xl glass overflow-hidden">
          <table className="w-full border-collapse text-sm"><tbody><SkeletonRows rows={5} cols={COLUMNS.length} /></tbody></table>
        </div>
      ) : rows.length === 0 ? (
        <div className="flex flex-col items-center justify-center text-center rounded-xl border border-black/[0.08] bg-white px-4 py-12">
          <CylinderIcon className="w-6 h-6 text-[var(--glass-muted)]" aria-hidden="true" />
          <p className="text-sm font-medium text-[var(--glass-ink)] mt-3">
            {all.length ? 'No cylinders match that search.' : 'No cylinders recorded yet.'}
          </p>
          <p className="text-xs text-[var(--glass-muted)] mt-1 max-w-[42ch]">
            {all.length
              ? 'Try the serial number, the teeth count or the manufacturer.'
              : 'Add each cylinder with its serial number once, and the whole team can see what sizes the shop owns.'}
          </p>
        </div>
      ) : (
        <>
          {/* Phone: cards */}
          <ul className="sm:hidden space-y-3">
            {rows.map((c) => (
              <li key={c.id} className="glass rounded-xl p-4">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="font-mono text-sm font-semibold text-[var(--glass-ink)] break-words">{c.serial_no}</p>
                    <p className="text-xs text-[var(--glass-muted)] mt-0.5">{c.type}{c.manufacturer && ` · ${c.manufacturer}`}</p>
                  </div>
                  {actions(c)}
                </div>
                <dl className="grid grid-cols-3 gap-x-4 mt-3 pt-3 border-t border-black/[0.06] text-sm">
                  <Spec label="Teeth" value={String(c.teeth)} />
                  <Spec label="Repeat" value={mm(c.teeth)} />
                  <Spec label="Bought" value={formatNumericDate(c.purchase_date) || '—'} />
                </dl>
              </li>
            ))}
          </ul>

          {/* Desk: table */}
          <div className="hidden sm:block rounded-xl glass overflow-hidden">
            <div className="table-scroll-wrapper max-h-[70vh] overflow-y-auto">
              <table className="w-full min-w-[820px] border-collapse text-sm">
                <thead>
                  <tr>
                    {COLUMNS.map(([label, field]) => (
                      <th key={label} scope="col" className={cn(
                        'sticky top-0 z-10 px-3 py-1.5 text-left text-[11px] font-semibold text-[var(--glass-muted)]',
                        'uppercase tracking-[0.06em] whitespace-nowrap bg-[var(--glass-bg-strong)] backdrop-blur-[14px]',
                        'border-b border-white/12',
                        label === 'Actions' && 'text-right',
                      )}>
                        {field ? (
                          <SortableHeaderLabel
                            label={label}
                            active={sortField === field}
                            dir={sortDir}
                            onClick={() => handleSort(field)}
                          />
                        ) : label}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {rows.map((c, i) => (
                    <tr key={c.id} className={cn('border-b border-white/8 hover:bg-black/[0.03] transition-colors', i % 2 === 1 && 'bg-[var(--glass-bg)]')}>
                      <td className="px-3 py-1.5 font-mono font-semibold text-[var(--glass-ink)] whitespace-nowrap">{c.serial_no}</td>
                      <td className="px-3 py-1.5 font-mono whitespace-nowrap">{c.teeth}</td>
                      <td className="px-3 py-1.5 font-mono whitespace-nowrap">{mm(c.teeth)}</td>
                      <td className="px-3 py-1.5 whitespace-nowrap">{c.type}</td>
                      <td className="px-3 py-1.5 whitespace-nowrap">{c.manufacturer || '—'}</td>
                      <td className="px-3 py-1.5 font-mono whitespace-nowrap text-[var(--glass-muted)]">{formatNumericDate(c.purchase_date) || '—'}</td>
                      <td className="px-3 py-1.5 text-right whitespace-nowrap">{actions(c)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}

      {editing && (
        <CylinderModal
          editing={editing === 'new' ? undefined : editing}
          onClose={() => setEditing(null)}
          onSaved={() => { setEditing(null); queryClient.invalidateQueries({ queryKey: ['cylinders'] }); }}
        />
      )}
    </div>
  );
}

function Spec({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0">
      <dt className="text-[10px] font-medium text-[var(--glass-muted)] uppercase tracking-wide">{label}</dt>
      <dd className="font-mono font-semibold text-[var(--glass-ink)] mt-0.5 truncate">{value}</dd>
    </div>
  );
}

const inputCls = cn(
  'w-full px-3 py-2 rounded-lg text-sm bg-[var(--field-bg)] border border-[var(--field-border)]',
  'text-[var(--glass-ink)] placeholder:text-[var(--glass-muted)]',
  'focus:outline-none focus:border-emerald-300/70 focus:bg-white/[0.14]',
  'focus:shadow-[0_0_0_4px_rgba(124,240,190,0.22)] transition-all',
);

function CylinderModal({ editing, onClose, onSaved }: { editing?: Cylinder; onClose: () => void; onSaved: () => void }) {
  const titleId = useId();
  const [serial,       setSerial]       = useState(editing?.serial_no ?? '');
  const [teeth,        setTeeth]        = useState(editing?.teeth.toString() ?? '');
  const [type,         setType]         = useState<Cylinder['type']>(editing?.type ?? 'Print');
  const [manufacturer, setManufacturer] = useState(editing?.manufacturer ?? '');
  const [purchaseDate, setPurchaseDate] = useState(editing?.purchase_date ?? '');
  const [saving,       setSaving]       = useState(false);

  const n = Number(teeth);
  const repeat = Number.isInteger(n) && n > 0 ? mm(n) : '—';

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    try {
      const res = await fetch(editing ? `/api/cylinders/${editing.id}` : '/api/cylinders', {
        method:  editing ? 'PATCH' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ serial_no: serial, teeth, type, manufacturer, purchase_date: purchaseDate }),
      });
      const data = await res.json();
      if (!res.ok) { toast.error(data.error ?? 'Failed to save cylinder'); return; }
      toast.success(editing ? 'Cylinder updated' : 'Cylinder added');
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
              {editing ? 'Edit cylinder' : 'Add cylinder'}
            </h2>
            <p className="text-xs text-[var(--glass-muted)] mt-0.5">One entry per cylinder: each serial number is used once</p>
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
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <label className="block">
              <FieldLabel required>Serial number</FieldLabel>
              <input value={serial} onChange={(e) => setSerial(e.target.value)} required className={cn(inputCls, 'font-mono')} />
            </label>
            <label className="block">
              <FieldLabel required>Type</FieldLabel>
              <select value={type} onChange={(e) => setType(e.target.value as Cylinder['type'])} className={inputCls}>
                {CYLINDER_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
              </select>
            </label>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <label className="block">
              <FieldLabel required>Teeth</FieldLabel>
              <WithUnit unit="teeth">
                <input
                  type="number" inputMode="numeric" min={1} step={1} required
                  value={teeth} onChange={(e) => setTeeth(e.target.value)}
                  className={cn(inputCls, 'font-mono')}
                />
              </WithUnit>
            </label>
            <div>
              <FieldLabel>Repeat length</FieldLabel>
              <p className="px-3 py-2 rounded-lg text-sm font-mono text-[var(--glass-ink)] bg-black/[0.03] border border-black/[0.06]" aria-live="polite">
                {repeat}
              </p>
              <p className="text-xs text-[var(--glass-muted)] mt-1.5">Teeth × 3.175 mm, worked out for you.</p>
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <label className="block">
              <FieldLabel>Manufacturer</FieldLabel>
              <WithExample example="Kocher + Beck">
                <input value={manufacturer} onChange={(e) => setManufacturer(e.target.value)} className={inputCls} />
              </WithExample>
            </label>
            <label className="block">
              <FieldLabel>Purchase date</FieldLabel>
              <input type="date" value={purchaseDate} onChange={(e) => setPurchaseDate(e.target.value)} className={cn(inputCls, 'font-mono')} />
            </label>
          </div>
        </div>

        <div className="flex items-center justify-end gap-2 px-5 py-3.5 border-t border-white/12 shrink-0">
          <Button type="button" onClick={onClose} disabled={saving}>Cancel</Button>
          <Button type="submit" intent="primary" icon={Check} disabled={saving}>
            {saving ? 'Saving…' : editing ? 'Save changes' : 'Add cylinder'}
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
