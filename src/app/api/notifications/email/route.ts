// src/app/api/notifications/email/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { getSubject, getEmailHTML, type NotifyPayload } from '@/lib/notifications/dispatchEmailTemplate';
import { isMailerConfigured, sendMail } from '@/lib/notifications/mailer';

async function getClientEmail(party: string): Promise<{ email: string; name: string } | null> {
  try {
    const admin = createAdminClient();
    const { data } = await admin
      .from('party_contacts')
      .select('email, contact_name')
      .eq('party', party)
      .maybeSingle();
    if (!data?.email) return null;
    return { email: data.email, name: data.contact_name ?? party };
  } catch {
    return null;
  }
}

export async function POST(request: NextRequest) {
  if (!isMailerConfigured()) {
    return NextResponse.json({ error: 'Email sending not configured' }, { status: 501 });
  }

  const body: NotifyPayload = await request.json();
  const { job_name, po_number, party, status, remark, qty } = body;

  const contact = await getClientEmail(party);
  if (!contact) {
    return NextResponse.json({ skipped: true, reason: 'no_email_on_file' });
  }

  const subject = getSubject(status, job_name ?? po_number);
  const html    = getEmailHTML({ job_name, po_number, party: contact.name, status, remark, qty });

  try {
    const { id } = await sendMail({ to: contact.email, subject, html });
    return NextResponse.json({ sent: true, id });
  } catch (error) {
    console.error('[email notification]', error);
    const message = error instanceof Error ? error.message : 'Failed to send email';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
