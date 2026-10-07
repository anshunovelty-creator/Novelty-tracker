// src/components/admin/OverdueAlertsCard.tsx
// Settings › Overdue alerts. Read-only on purpose: the morning alert is a
// Vercel cron (vercel.json, 03:30 UTC = 09:00 IST) that WhatsApps the
// number in ADMIN_WHATSAPP_NUMBER through WATI — hosting settings, not app
// data. This card says whether it is wired up and what tomorrow's message
// would list, so nobody has to open the Vercel dashboard to find out.

import { createAdminClient } from '@/lib/supabase/admin';
import { StateChip } from '@/components/ui/StateChip';

function masked(phone: string): string {
  const digits = phone.replace(/\D/g, '');
  return digits.length > 4 ? `•••• ${digits.slice(-4)}` : phone;
}

export default async function OverdueAlertsCard() {
  const phone = process.env.ADMIN_WHATSAPP_NUMBER?.trim();
  const wati  = Boolean(process.env.WATI_API_ENDPOINT && process.env.WATI_API_TOKEN);
  const live  = Boolean(phone && wati);

  // Same query the cron runs, so the count is what the message would carry.
  const today = new Date().toISOString().slice(0, 10);
  const { count } = await createAdminClient()
    .from('jobs')
    .select('id', { count: 'exact', head: true })
    .eq('is_closed', false)
    .not('status', 'in', '("Dispatched","PO Closed")')
    .lt('delivery_date', today);

  return (
    <section
      id="alerts"
      aria-labelledby="alerts-title"
      className="flex scroll-mt-24 flex-col gap-4 rounded-2xl border border-brand-border bg-white p-5 shadow-[0_2px_8px_rgba(12,42,32,0.04)] sm:p-6"
    >
      <div className="flex flex-col gap-1">
        <h2 id="alerts-title" className="text-base font-semibold text-brand-ink">Overdue alerts</h2>
        <p className="text-[13px] text-brand-muted">
          Every morning at <span className="font-mono">09:00 IST</span>, jobs past their delivery date go to Admin on WhatsApp.
        </p>
      </div>

      <dl className="flex flex-col">
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 py-3">
          <dt className="min-w-[140px] text-sm text-brand-muted">Admin WhatsApp</dt>
          <dd className="font-mono text-sm text-brand-ink">{phone ? masked(phone) : 'Not set'}</dd>
          <dd className="ml-auto">
            <StateChip label={live ? 'Sending' : 'Not sending'} dot={live ? '#059669' : '#D97706'} />
          </dd>
        </div>
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 border-t border-brand-line-soft py-3">
          <dt className="min-w-[140px] text-sm text-brand-muted">Overdue right now</dt>
          <dd className="text-sm text-brand-ink">
            <span className="font-mono font-semibold">{count ?? '—'}</span> {count === 1 ? 'job' : 'jobs'} would be listed
          </dd>
        </div>
      </dl>

      <p className="rounded-xl bg-brand-surface-alt px-3.5 py-3 text-[13px] leading-relaxed text-brand-muted">
        {live
          ? 'To change the number, update ADMIN_WHATSAPP_NUMBER in the hosting settings and redeploy.'
          : !phone
            ? 'Set ADMIN_WHATSAPP_NUMBER in the hosting settings and redeploy to start the morning alert.'
            : 'The number is set, but the WhatsApp service (WATI) keys are missing, so nothing is sent.'}
      </p>
    </section>
  );
}
