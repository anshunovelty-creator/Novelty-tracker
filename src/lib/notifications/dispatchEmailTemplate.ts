// src/lib/notifications/dispatchEmailTemplate.ts
// Shared subject/HTML builder for job status notification emails.
// Used by /api/notifications/email (single-job client email) and
// /api/dispatch-notifications/send (consolidated party + internal dispatch
// email, via getConsolidatedSubject/getConsolidatedEmailHTML below).

import type { Stage } from '@/lib/constants/stages';

export type NotifyPayload = {
  job_id:    string;
  job_name:  string | null;
  po_number: string;
  party:     string;
  status:    Stage;
  remark:    string | null;
  qty:       number | null;
};

export function getSubject(status: Stage, label: string): string {
  switch (status) {
    case 'Shade Card Sent':   return `Shade Card Ready — ${label}`;
    case 'Ready to Dispatch': return `Your Order Is Ready for Dispatch — ${label}`;
    case 'Dispatched':        return `Your Order Has Been Dispatched — ${label}`;
    case 'On Hold':           return `Order Update: Temporary Hold — ${label}`;
    default:                  return `Order Update — ${label}`;
  }
}

// ── Consolidated (multi-job) dispatch email ──────────────────────
// One truck run often carries several orders for the same party — rather
// than one email per job, /api/dispatch-notifications/send batches every
// queued item for a party into a single email using these instead of
// getSubject/getEmailHTML above.

export type DispatchItem = {
  job_name:  string | null;
  po_number: string;
  status:    Stage;
  qty:       number | null;
  remark:    string | null;
};

export function getConsolidatedSubject(itemCount: number, party: string): string {
  return `Dispatch Details / ${party} — ${itemCount} Order${itemCount === 1 ? '' : 's'}`;
}

// ── Green "Dispatch Notification" branding ────────────────────────
// Matches the look of the dispatch-notification emails this replaced
// (a Google Apps Script bound to the old tracking sheet) — dark green
// masthead with the wordmark + logo, a light-green subject strip, an
// alternating detail table, and a dark-green total-quantity callout row.

export function getConsolidatedEmailHTML(payload: {
  party: string;
  contactName?: string | null;   // party_contacts.contact_name — greet them by name when on file
  items: DispatchItem[];
  audience?: 'party' | 'team';   // 'team' = internal copy (Dear Team, ... for {party}); default 'party'
}): string {
  const { party, contactName, items, audience = 'party' } = payload;
  const greetingName = audience === 'team' ? 'Team' : (contactName?.trim() || party);
  const introText = audience === 'team'
    ? `These are the dispatch details of today for <strong>${party}</strong>.`
    : 'Please find the dispatch details below for your reference and records.';
  const subject  = getConsolidatedSubject(items.length, party);
  const logoUrl  = `${process.env.NEXT_PUBLIC_APP_URL}/novelty-labels-logo.png`;
  const sentAt   = new Date().toLocaleString('en-GB', {
    timeZone: 'Asia/Kolkata',
    day: '2-digit', month: 'short', year: 'numeric',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false,
  }).replace(',', '');

  const totalQty = items.reduce((sum, i) => sum + (i.qty ?? 0), 0);

  const rows = items.map((item, i) => {
    const label   = item.job_name ?? item.po_number;
    const partial = item.status === 'Partial Dispatch';
    const bg      = i % 2 === 0 ? '#f0f7f0' : '#ffffff';
    const remarkHtml = (item.remark && item.remark.trim() !== '')
      ? `<br><span style="color:#9a7800;font-size:11px;font-style:italic;">Remark: ${item.remark.trim()}</span>`
      : '';
    return `
          <tr style="background-color:${bg};">
            <td style="padding:12px 16px;color:#1a1a1a;font-weight:600;font-size:13px;border-bottom:1px solid #c8e0c7;">
              ${label}<br>
              <span style="color:#5f8a5e;font-weight:400;font-size:11.5px;font-family:monospace;">PO: ${item.po_number}</span>
              ${remarkHtml}
            </td>
            <td style="padding:12px 16px;color:#10540f;font-weight:600;font-size:12.5px;border-bottom:1px solid #c8e0c7;white-space:nowrap;">
              ${partial ? 'Partial Dispatch' : 'Dispatched'}
            </td>
            <td style="padding:12px 16px;color:#1a1a1a;font-size:13px;border-bottom:1px solid #c8e0c7;text-align:right;white-space:nowrap;">
              ${item.qty ? item.qty.toLocaleString('en-IN') : '—'}
            </td>
          </tr>`;
  }).join('');

  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
</head>
<body style="margin:0;padding:0;background-color:#eef4ee;font-family:Arial,sans-serif;">
  <div style="max-width:600px;margin:28px auto;background-color:#ffffff;border-radius:10px;overflow:hidden;border:1px solid #b8d9b7;">

    <table width="100%" cellpadding="0" cellspacing="0" style="background-color:#10540f;">
      <tr>
        <td style="padding:22px 28px;">
          <h3 style="margin:0 0 4px;color:#ffffff;font-size:15px;letter-spacing:2.5px;text-transform:uppercase;font-weight:700;">Novelty Labels</h3>
          <h2 style="margin:0;color:#ffffff;font-size:20px;font-weight:700;letter-spacing:0.8px;">Dispatch Notification</h2>
        </td>
        <td style="padding:22px 28px 22px 0;text-align:right;vertical-align:middle;width:140px;">
          <img src="${logoUrl}" alt="Novelty Labels" width="110" style="display:block;margin-left:auto;background-color:#ffffff;border-radius:6px;padding:6px 10px;" />
        </td>
      </tr>
    </table>

    <div style="height:3px;background-color:#2d8a2b;"></div>

    <div style="background-color:#f0f7f0;padding:11px 28px;border-bottom:1px solid #b8d9b7;">
      <p style="margin:0;color:#10540f;font-size:12px;letter-spacing:1px;text-transform:uppercase;font-weight:600;">${subject}</p>
    </div>

    <div style="padding:22px 28px 10px;">
      <p style="margin:0;color:#1a1a1a;font-size:15px;font-weight:500;">Dear ${greetingName},</p>
      <p style="margin:9px 0 0;color:#555555;font-size:13.5px;line-height:1.65;">
        ${introText}
      </p>
    </div>

    <div style="padding:10px 28px 26px;">
      <table style="width:100%;border-collapse:collapse;font-size:13px;border:1px solid #b8d9b7;">
        <tr style="background-color:#10540f;">
          <td style="padding:10px 16px;color:#a8d4a7;font-weight:700;font-size:11px;text-transform:uppercase;letter-spacing:0.5px;">Job / PO</td>
          <td style="padding:10px 16px;color:#a8d4a7;font-weight:700;font-size:11px;text-transform:uppercase;letter-spacing:0.5px;">Status</td>
          <td style="padding:10px 16px;color:#a8d4a7;font-weight:700;font-size:11px;text-transform:uppercase;letter-spacing:0.5px;text-align:right;">Qty</td>
        </tr>
        ${rows}
        <tr style="background-color:#10540f;">
          <td style="padding:14px 16px;color:#a8d4a7;font-weight:700;font-size:13px;" colspan="2">Total Quantity Dispatched</td>
          <td style="padding:14px 16px;color:#ffffff;font-weight:700;font-size:18px;text-align:right;">${totalQty.toLocaleString('en-IN')}</td>
        </tr>
      </table>
    </div>

    <div style="background-color:#f0f7f0;padding:15px 28px;border-top:1px solid #b8d9b7;">
      <p style="margin:0 0 5px 0;color:#10540f;font-size:12px;font-weight:600;">Novelty Labels · Dispatch Team</p>
      <p style="margin:0;color:#10540f;font-size:11px;">${sentAt} · Do not reply</p>
    </div>

  </div>
</body>
</html>`;
}

export function getEmailHTML(payload: Omit<NotifyPayload, 'job_id'> & { party: string }): string {
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
