'use client';
// src/components/admin/CsvExportButton.tsx
// One CSV download button per reference list (Label Stock, Dies, Plates).
// Exports exactly what's on screen — including whatever search is active —
// entirely client-side: the list is already loaded, so there is no server
// round trip and no extra access check beyond "can this department see the
// list at all", which the page already enforces.

import { Download } from 'lucide-react';
import { cn } from '@/lib/utils';
import { toCsv, istDateStamp, type CsvColumn } from '@/lib/export/csv';

type Props<T> = {
  rows:      T[];
  columns:   CsvColumn<T>[];
  // Base filename, no extension or date — the IST day is appended.
  filename:  string;
  label?:    string;
};

export default function CsvExportButton<T>({ rows, columns, filename, label = 'Export' }: Props<T>) {
  function handleExport() {
    const csv  = toCsv(rows, columns);
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

  return (
    <button
      type="button"
      onClick={handleExport}
      disabled={rows.length === 0}
      title={`Download ${rows.length} row${rows.length === 1 ? '' : 's'} as CSV`}
      className={cn(
        'inline-flex items-center justify-center gap-1.5 min-h-11 px-3 rounded-xl',
        'text-sm font-medium border border-black/[0.12] text-[var(--glass-muted)]',
        'hover:bg-black/[0.04] hover:text-[var(--glass-ink)] transition-colors',
        'disabled:opacity-40 disabled:cursor-not-allowed',
      )}
    >
      <Download className="w-4 h-4" aria-hidden="true" />
      {label}
    </button>
  );
}
