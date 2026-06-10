// src/app/api/notifications/email/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { Resend } from 'resend';
import { createAdminClient } from '@/lib/supabase/admin';
import type { Stage } from '@/lib/constants/stages';

const resend = new Resend(process.env.RESEND_API_KEY);

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
  if (!process.env.RESEND_API_KEY) {
    return NextResponse.json({ error: 'Resend not configured' }, { status: 501 });
  }

  const body: NotifyPayload = await request.json();
  const { job_name, po_number, party, status, remark, qty } = body;

  const contact = await getClientEmail(party);
  if (!contact) {
    return NextResponse.json({ skipped: true, reason: 'no_email_on_file' });
  }

  const subject = getSubject(status, job_name ?? po_number);
  const html    = getEmailHTML({ job_name, po_number, party: contact.name, status, remark, qty });

  const { data, error } = await resend.emails.send({
    from:    process.env.RESEND_FROM_EMAIL ?? 'orders@noveltylabels.com',
    to:      contact.email,
    subject,
    html,
  });

  if (error) {
    console.error('[email notification]', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ sent: true, id: data?.id });
}

function getSubject(status: Stage, label: string): string {
  switch (status) {
    case 'Shade Card Sent':   return `Shade Card Ready — ${label}`;
    case 'Ready to Dispatch': return `Your Order Is Ready for Dispatch — ${label}`;
    case 'Dispatched':        return `Your Order Has Been Dispatched — ${label}`;
    case 'On Hold':           return `Order Update: Temporary Hold — ${label}`;
    default:                  return `Order Update — ${label}`;
  }
}

function getEmailHTML(payload: Omit<NotifyPayload, 'job_id'>): string {
  const { job_name, po_number, party, status, remark, qty } = payload;
  const trackUrl = `${process.env.NEXT_PUBLIC_APP_URL}/track/${po_number}`;

  const messageBody = (() => {
    switch (status) {
      case 'Shade Card Sent':
        return 'Your shade card has been sent for approval. Please review and confirm so we can proceed with printing.';
      case 'Ready to Dispatch':
        return 'Your order is ready for dispatch. Our team will coordinate delivery shortly.';
      case 'Dispatched':
        return `Your order has been dispatched.${qty ? ` <strong>${qty.toLocaleString('en-IN')} labels</strong> sent.` : ''}`;
      case 'On Hold':
        return `Your order has been temporarily placed on hold.<br><br><strong>Reason:</strong> ${remark ?? 'Please contact us for details.'}`;
      default:
        return `Your order status has been updated to <strong>${status}</strong>.`;
    }
  })();

  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
</head>
<body style="margin:0;padding:0;background:#f7f7f5;font-family:'DM Sans',Helvetica,Arial,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0">
    <tr>
      <td align="center" style="padding:40px 16px;">
        <table width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;">
          <tr>
            <td style="background:#1a1a18;padding:24px 32px;border-radius:10px 10px 0 0;">
              <p style="margin:0;color:#ffffff;font-size:18px;font-weight:600;">Novelty Labels &amp; Supplies</p>
              <p style="margin:4px 0 0;color:#a8a8a0;font-size:13px;">Order Status Update</p>
            </td>
          </tr>
          <tr>
            <td style="background:#ffffff;padding:32px;border:1px solid #e5e5e2;border-top:none;">
              <p style="margin:0 0 8px;color:#a8a8a0;font-size:12px;text-transform:uppercase;letter-spacing:0.5px;">Order Details</p>
              <p style="margin:0 0 4px;font-size:15px;font-weight:600;color:#1a1a18;">${job_name ?? 'Order'}</p>
              <p style="margin:0 0 24px;font-size:13px;color:#a8a8a0;font-family:monospace;">PO: ${po_number}</p>
              <p style="margin:0 0 24px;font-size:15px;color:#1a1a18;line-height:1.6;">
                Dear ${party},<br><br>${messageBody}
              </p>
              <a href="${trackUrl}" style="display:inline-block;background:#1a1a18;color:#ffffff;text-decoration:none;padding:12px 24px;border-radius:8px;font-size:14px;font-weight:500;">
                Track Your Order →
              </a>
            </td>
          </tr>
          <tr>
            <td style="background:#f7f7f5;padding:16px 32px;border-radius:0 0 10px 10px;border:1px solid #e5e5e2;border-top:none;">
              <p style="margin:0;font-size:12px;color:#a8a8a0;">
                Novelty Labels &amp; Supplies · Ankleshwar GIDC, Gujarat, India<br>
                This is an automated notification. Reply to this email to reach our team.
              </p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
}
