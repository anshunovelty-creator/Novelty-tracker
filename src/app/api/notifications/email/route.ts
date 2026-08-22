// src/app/api/notifications/email/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { getSubject, getEmailHTML, type NotifyPayload } from '@/lib/notifications/dispatchEmailTemplate';
import { isMailerConfigured, sendMail } from '@/lib/notifications/mailer';

// A party can have several contacts on file (migration 046) — every one of
// them gets the email. The individual-name greeting only makes sense when
// there's exactly one contact; otherwise it falls back to the party name.
async function getClientContacts(party: string): Promise<{ emails: string[]; name: string } | null> {
  try {
    const admin = createAdminClient();
    const { data } = await admin
      .from('party_contacts')
      .select('email, contact_name')
      .eq('party', party);

    const emails = (data ?? [])
      .map((c) => c.email)
      .filter((email): email is string => Boolean(email));
    if (emails.length === 0) return null;

    const name = data?.length === 1 ? (data[0].contact_name ?? party) : party;
    return { emails, name };
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

  const contact = await getClientContacts(party);
  if (!contact) {
    return NextResponse.json({ skipped: true, reason: 'no_email_on_file' });
  }

  const subject = getSubject(status, job_name ?? po_number);
  const html    = getEmailHTML({ job_name, po_number, party: contact.name, status, remark, qty });

  try {
    const { id } = await sendMail({ to: contact.emails, subject, html });
    return NextResponse.json({ sent: true, id });
  } catch (error) {
    console.error('[email notification]', error);
    const message = error instanceof Error ? error.message : 'Failed to send email';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
