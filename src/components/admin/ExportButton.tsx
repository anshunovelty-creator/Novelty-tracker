'use client';
// src/components/admin/ExportButton.tsx
// One-click download of the full data export (jobs + releases + runs).

import { useState } from 'react';
import { Download } from 'lucide-react';
import toast from 'react-hot-toast';
import { LoadingButton } from '@/components/ui/Loading';

export default function ExportButton() {
  const [busy, setBusy] = useState(false);

  async function handleExport() {
    if (busy) return;
    setBusy(true);

    try {
      const res = await fetch('/api/export');

      if (!res.ok) {
        // The route answers with JSON on failure and a ZIP on success.
        const data = await res.json().catch(() => null);
        toast.error(data?.error ?? 'Export failed. Please try again.');
        return;
      }

      const blob = await res.blob();
      const name = res.headers.get('X-Export-Filename') ?? 'novelty-labels-export.zip';

      // Anchor + object URL — the only way to name a file that arrived
      // over fetch() rather than a direct navigation.
      const url  = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = name;
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(url);

      toast.success('Export downloaded');
    } catch {
      toast.error('Network error. Please try again.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <LoadingButton
      onClick={handleExport}
      loading={busy}
      loadingStages={['Collecting jobs…', 'Adding releases…', 'Packing file…']}
      title="Download all jobs, scheduled releases and print runs as CSV"
      className="min-h-[44px] gap-1.5 rounded-lg border border-white/20 bg-white/10 px-3.5 text-xs font-medium text-white/85 transition-colors hover:bg-white/[0.16] hover:text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white/60 disabled:opacity-70"
    >
      <Download className="h-4 w-4" aria-hidden="true" />
      Export
    </LoadingButton>
  );
}
