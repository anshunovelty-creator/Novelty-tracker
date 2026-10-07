'use client';
// src/components/admin/CsvExportButton.tsx
// One CSV download button per reference list (Label Stock, Dies, Plates).
// Exports exactly what's on screen — including whatever search is active —
// entirely client-side: the list is already loaded, so there is no server
// round trip and no extra access check beyond "can this department see the
// list at all", which the page already enforces.
//
// A list that only holds one screen's page (Shade Cards: 25 of thousands)
// passes fetchRows instead, and `count` for the label: the rows are fetched
// when the button is pressed, so the file has every match, not one page.

import { useState } from 'react';
import { Download } from 'lucide-react';
import toast from 'react-hot-toast';
import { cn } from '@/lib/utils';
import { toCsv, istDateStamp, type CsvColumn } from '@/lib/export/csv';

type Props<T> = {
  columns:   CsvColumn<T>[];
  // Base filename, no extension or date — the IST day is appended.
  filename:  string;
  label?:    string;
} & (
  | { rows: T[]; fetchRows?: never; count?: never }
  | { rows?: never; fetchRows: () => Promise<T[]>; count: number }
);

export default function CsvExportButton<T>({ rows, fetchRows, count, columns, filename, label = 'Export' }: Props<T>) {
  const [busy, setBusy] = useState(false);
  const total = rows ? rows.length : count ?? 0;

  function download(list: T[]) {
    const csv  = toCsv(list, columns);
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url  = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `${filename}-${istDateStamp()}.csv`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
  }

  async function handleExport() {
    if (rows) { download(rows); return; }
    if (!fetchRows) return;
    setBusy(true);
    try {
      download(await fetchRows());
    } catch (err) {
      toast.error((err as Error).message || 'Export failed. Please try again.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <button
      type="button"
      onClick={handleExport}
      disabled={total === 0 || busy}
      aria-busy={busy}
      title={`Download ${total} row${total === 1 ? '' : 's'} as CSV`}
      className={cn(
        'inline-flex items-center justify-center gap-1.5 min-h-11 px-3 rounded-xl',
        'text-sm font-medium border border-black/[0.12] text-[var(--glass-muted)]',
        'hover:bg-black/[0.04] hover:text-[var(--glass-ink)] transition-colors',
        'disabled:opacity-40 disabled:cursor-not-allowed',
      )}
    >
      <Download className="w-4 h-4" aria-hidden="true" />
      {busy ? 'Exporting…' : label}
    </button>
  );
}
