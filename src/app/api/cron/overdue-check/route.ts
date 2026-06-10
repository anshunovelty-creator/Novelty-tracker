// src/app/api/cron/overdue-check/route.ts
// ============================================================
// GET /api/cron/overdue-check
// Called daily at 9:00 AM IST by Vercel Cron.
// Finds all active, non-dispatched jobs past their delivery date.
// Sends internal WhatsApp/email alert to Admin.
// Protected by CRON_SECRET header (checked in middleware).
// ============================================================

import { NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { formatShortDate } from '@/lib/utils';

export async function GET() {
  const admin = createAdminClient();
  const today = new Date().toISOString().slice(0, 10); // 'YYYY-MM-DD'

  // Find overdue active jobs
  const { data: overdueJobs, error } = await admin
    .from('jobs')
    .select('id, po_number, pm_code, party, job_name, delivery_date, status')
    .eq('is_closed', false)
    .not('status', 'in', '("Dispatched","PO Closed")')
    .lt('delivery_date', today)
    .order('delivery_date', { ascending: true });

  if (error) {
    console.error('[cron overdue-check]', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  if (!overdueJobs || overdueJobs.length === 0) {
    console.log('[cron overdue-check] No overdue jobs today.');
    return NextResponse.json({ overdue: 0 });
  }

  // Format alert message
  const lines = overdueJobs.map((job) => {
    const name   = job.job_name ?? job.po_number;
    const due    = formatShortDate(job.delivery_date);
    const status = job.status;
    const party  = job.party;
    return `• ${party} — ${name} | Due: ${due} | Status: ${status}`;
  });

  const message =
    `🔴 *Overdue Orders — ${new Date().toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })}*\n\n` +
    `${overdueJobs.length} order(s) past delivery date:\n\n` +
    lines.join('\n');

  // Send to admin WhatsApp
  const adminPhone = process.env.ADMIN_WHATSAPP_NUMBER;
  const watiEndpoint = process.env.WATI_API_ENDPOINT;
  const watiToken = process.env.WATI_API_TOKEN;

  if (adminPhone && watiEndpoint && watiToken) {
    try {
      await fetch(
        `${watiEndpoint}/api/v1/sendSessionMessage/${adminPhone}`,
        {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${watiToken}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ messageText: message }),
        }
      );
    } catch (err) {
      console.error('[cron overdue-check] WhatsApp send failed:', err);
    }
  }

  console.log(`[cron overdue-check] Sent alert for ${overdueJobs.length} overdue jobs.`);
  return NextResponse.json({ overdue: overdueJobs.length, jobs: overdueJobs });
}
