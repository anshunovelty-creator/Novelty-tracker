'use client';
// src/components/admin/BrandingSettingsForm.tsx
// The self-service form behind /admin/settings. Two independent saves —
// text fields via PATCH /api/settings/branding, logo via a separate
// POST /api/settings/branding/logo (multipart) — so uploading a new logo
// doesn't require re-typing the address, and vice versa.

import { useState } from 'react';
import Image from 'next/image';
import toast from 'react-hot-toast';
import { Upload } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/Button';
import type { Branding } from '@/lib/branding-utils';

const inputCls = cn(
  'w-full rounded-[10px] border border-brand-border bg-white px-3 text-[15px] text-brand-ink',
  'placeholder:text-brand-faint focus:border-brand-primary focus:outline-none',
  'focus:shadow-[0_0_0_4px_rgba(16,85,63,0.18)]',
);

function Field({
  id, label, hint, value, onChange, type = 'text', rows, wide = false, mono = false,
}: {
  id: string;
  label: string;
  hint?: string;
  value: string;
  onChange: (v: string) => void;
  type?: string;
  /** Renders a textarea with this many rows. */
  rows?: number;
  wide?: boolean;
  mono?: boolean;
}) {
  return (
    <div className={cn('flex min-w-0 flex-col gap-1.5', wide && 'sm:col-span-2')}>
      <label htmlFor={id} className="text-[10px] font-medium uppercase tracking-[0.025em] text-brand-muted">{label}</label>
      {rows ? (
        <textarea
          id={id}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          rows={rows}
          className={cn(inputCls, 'resize-y py-2.5 leading-relaxed', mono && 'font-mono text-sm')}
        />
      ) : (
        <input id={id} type={type} value={value} onChange={(e) => onChange(e.target.value)} className={cn(inputCls, 'h-11')} />
      )}
      {hint && <p className="text-xs text-brand-muted">{hint}</p>}
    </div>
  );
}

export default function BrandingSettingsForm({ initial }: { initial: Branding }) {
  const [name, setName]                     = useState(initial.name);
  const [shortName, setShortName]           = useState(initial.shortName);
  const [productionName, setProductionName] = useState(initial.productionName);
  const [address, setAddress]               = useState(initial.address);
  const [supportEmail, setSupportEmail]     = useState(initial.supportEmail);
  const [returnAddress, setReturnAddress]   = useState(initial.returnAddress);
  const [logoUrl, setLogoUrl]               = useState(initial.logoUrl);

  const [saving, setSaving]         = useState(false);
  const [uploadingLogo, setUploadingLogo] = useState(false);

  async function handleSave() {
    setSaving(true);
    try {
      const res = await fetch('/api/settings/branding', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, shortName, productionName, address, supportEmail, returnAddress }),
      });
      const data = await res.json();
      if (!res.ok) {
        toast.error(data?.error ?? 'Failed to save settings');
        return;
      }
      toast.success('Settings saved');
    } catch {
      toast.error('Network error. Please try again.');
    } finally {
      setSaving(false);
    }
  }

  async function handleLogoChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;

    setUploadingLogo(true);
    try {
      const formData = new FormData();
      formData.append('file', file);
      const res = await fetch('/api/settings/branding/logo', { method: 'POST', body: formData });
      const data = await res.json();
      if (!res.ok) {
        toast.error(data?.error ?? 'Failed to upload logo');
        return;
      }
      setLogoUrl(data.logoUrl);
      toast.success('Logo updated');
    } catch {
      toast.error('Network error. Please try again.');
    } finally {
      setUploadingLogo(false);
    }
  }

  return (
    <section
      id="company"
      aria-labelledby="company-title"
      className="flex scroll-mt-24 flex-col gap-5 rounded-2xl border border-brand-border bg-white p-5 shadow-[0_2px_8px_rgba(12,42,32,0.04)] sm:p-6"
    >
      <div className="flex flex-col gap-1">
        <h2 id="company-title" className="text-lg font-semibold text-brand-ink">Company &amp; branding</h2>
        <p className="text-[13px] text-brand-muted">
          Used on the customer tracking page, slips and dispatch emails. Changes reach every screen within a minute.
        </p>
      </div>

      <div className="flex flex-wrap items-center gap-5">
        <div className="flex h-[88px] w-[132px] items-center justify-center overflow-hidden rounded-2xl border border-brand-border bg-white">
          <Image
            src={logoUrl || '/company-logo.png'}
            alt={`${shortName} logo`}
            width={120}
            height={72}
            className="h-auto max-h-[72px] w-auto max-w-[116px] object-contain"
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <span className="text-[10px] font-medium uppercase tracking-[0.025em] text-brand-muted">Logo</span>
          <label className={cn(
            'inline-flex min-h-10 w-fit cursor-pointer items-center gap-1.5 rounded-[10px] border border-brand-border bg-white px-3 text-[13px] font-medium text-brand-ink',
            'transition-colors hover:bg-brand-surface-alt focus-within:shadow-[0_0_0_4px_rgba(16,85,63,0.18)]',
            uploadingLogo && 'pointer-events-none opacity-60',
          )}>
            <Upload className="h-4 w-4" aria-hidden="true" />
            {uploadingLogo ? 'Uploading…' : 'Upload new'}
            <input type="file" accept="image/png,image/jpeg,image/webp,image/svg+xml" className="sr-only" onChange={handleLogoChange} />
          </label>
          <span className="text-xs text-brand-muted">PNG, JPEG, WebP or SVG, under 2 MB. Square or wide.</span>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Field id="b-name" label="Company name" hint="Login page, tracking page, email headers." value={name} onChange={setName} />
        <Field id="b-short" label="Short name" hint="Page titles and the truck on the tracking page." value={shortName} onChange={setShortName} />
        <Field id="b-trade" label="Production / trade name" hint="Printed in capitals on roll and box slips." value={productionName} onChange={setProductionName} />
        <Field id="b-email" label="Support email" hint="For customers who can’t find their order." type="email" value={supportEmail} onChange={setSupportEmail} />
        <Field id="b-address" label="Address" hint="One line — tracking page footer and email signatures." value={address} onChange={setAddress} wide />
        <Field id="b-return" label="Factory return address (on address slips)" hint="The sender on the courier slip. One line per row." value={returnAddress} onChange={setReturnAddress} rows={5} wide mono />
      </div>

      <div className="flex justify-end">
        <Button intent="primary" onClick={handleSave} disabled={saving}>
          {saving ? 'Saving…' : 'Save branding'}
        </Button>
      </div>
    </section>
  );
}
