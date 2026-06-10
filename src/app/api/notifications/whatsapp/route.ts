// src/app/api/notifications/whatsapp/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/admin';
import type { Stage } from '@/lib/constants/stages';

async function getClientWhatsApp(party: string): Promise<{ phone: string; name: string } | null> {
  try {
    const admin = createAdminClient();
    const { data } = await admin
      .from('party_contacts')
      .select('whatsapp, contact_name')
      .eq('party', party)
      .maybeSingle();
    if (!data?.whatsapp) return null;
    return { phone: data.whatsapp, name: data.contact_name ?? party };
  } catch {
    return null;
  }
}

type NotifyPayload = {
  job_id:    string;
  job_name:  string | null;
  po_number: string;
  party:     string;
  status:    Stage;
  remark:    string | null;
  qty:       number | null;
};

export async function POST(request: NextRequest) {
  const { WATI_API_ENDPOINT, WATI_API_TOKEN } = process.env;
  if (!WATI_API_ENDPOINT || !WATI_API_TOKEN) {
    return NextResponse.json({ error: 'WATI not configured' }, { status: 501 });
  }

  const body: NotifyPayload = await request.json();
  const { job_name, po_number, party, status, remark, qty } = body;

  const contact = await getClientWhatsApp(party);
  if (!contact) {
    return NextResponse.json({ skipped: true, reason: 'no_whatsapp_on_file' });
  }

  const trackUrl = `${process.env.NEXT_PUBLIC_APP_URL}/track/${po_number}`;
  const message  = buildMessage({ name: contact.name, job_name, po_number, status, remark, qty, trackUrl });

  const res = await fetch(
    `${WATI_API_ENDPOINT}/api/v1/sendSessionMessage/${contact.phone}`,
    {
      method:  'POST',
      headers: {
        Authorization:  `Bearer ${WATI_API_TOKEN}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ messageText: message }),
    }
  );

  if (!res.ok) {
    const err = await res.text();
    console.error('[whatsapp notification]', err);
    return NextResponse.json({ error: err }, { status: 500 });
  }

  return NextResponse.json({ sent: true });
}

function buildMessage(p: {
  name:      string;
  job_name:  string | null;
  po_number: string;
  status:    Stage;
  remark:    string | null;
  qty:       number | null;
  trackUrl:  string;
}): string {
  const label = p.job_name ?? p.po_number;

  const body = (() => {
    switch (p.status) {
      case 'Shade Card Sent':
        return `Your shade card for *${label}* (PO: ${p.po_number}) has been sent for approval. Kindly review and confirm.`;
      case 'Ready to Dispatch':
        return `Your order *${label}* (PO: ${p.po_number}) is ready for dispatch. We will coordinate delivery shortly.`;
      case 'Dispatched':
        const qtyStr = p.qty ? `${p.qty.toLocaleString('en-IN')} labels` : 'Your order';
        return `✅ ${qtyStr} for *${label}* (PO: ${p.po_number}) have been dispatched.`;
      case 'On Hold':
        return `⏸ Your order *${label}* (PO: ${p.po_number}) has been temporarily placed on hold.\n\nReason: ${p.remark ?? 'Please contact us for details.'}`;
      default:
        return `Your order *${label}* (PO: ${p.po_number}) status updated to: ${p.status}.`;
    }
  })();

  return `Hi ${p.name},\n\n${body}\n\n📦 Track: ${p.trackUrl}`;
}
