// src/lib/notifications/mailer.ts
// Gmail SMTP sender — replaces Resend, which requires a verified sending
// domain we don't have set up yet. Needs GMAIL_USER (the Gmail address) and
// GMAIL_APP_PASSWORD (a 16-char App Password, not the account password —
// generated at myaccount.google.com/apppasswords, requires 2FA on the
// account) in .env.local. Free Gmail caps around 500 sends/day.
//
// Used by /api/notifications/email (single-job client email) and
// /api/dispatch-notifications/send (consolidated party + internal dispatch
// email) — all send through this one transporter.

import nodemailer from 'nodemailer';
import { LOGO_DATA_URI, LOGO_CID } from './logoDataUri';

let transporter: nodemailer.Transporter | null = null;

function getTransporter(): nodemailer.Transporter {
  if (transporter) return transporter;

  transporter = nodemailer.createTransport({
    service: 'gmail',
    auth: {
      user: process.env.GMAIL_USER,
      pass: process.env.GMAIL_APP_PASSWORD,
    },
  });

  return transporter;
}

export function isMailerConfigured(): boolean {
  return Boolean(process.env.GMAIL_USER && process.env.GMAIL_APP_PASSWORD);
}

export async function sendMail(opts: {
  to:      string | string[];
  subject: string;
  html:    string;
  // Stable identifier for the conversation this email belongs to (e.g. one
  // PO). Every send carrying the same key threads together in the
  // recipient's client; omit it and the email stands on its own.
  threadKey?: string | null;
  // Attach the Novelty Labels logo as an inline CID image and reference it
  // in html via <img src="cid:...">. Set this instead of putting the logo
  // in the HTML as a data: URI — Outlook desktop, Outlook.com/Office 365,
  // and Yahoo Mail strip data: URIs from <img src> outright, which showed
  // as a broken image icon for recipients on those clients.
  inlineLogo?: boolean;
}): Promise<{ id?: string }> {
  // Point References/In-Reply-To at a synthetic root id that no real message
  // ever uses. Mail clients thread on a shared References root, so this
  // groups the conversation without us having to track the Message-ID of the
  // first email we ever sent about that PO. The message's own Message-ID is
  // left to nodemailer so it stays unique per send — reusing an id would let
  // Gmail treat a later dispatch as a duplicate and hide it.
  const domain = process.env.GMAIL_USER?.split('@')[1] || 'novelty-labels.local';
  const threadRoot = opts.threadKey ? `<${opts.threadKey}@${domain}>` : null;

  const info = await getTransporter().sendMail({
    from:    `"Novelty Labels & Supplies" <${process.env.GMAIL_USER}>`,
    to:      opts.to,
    subject: opts.subject,
    html:    opts.html,
    ...(threadRoot ? { references: threadRoot, inReplyTo: threadRoot } : {}),
    ...(opts.inlineLogo
      ? {
          attachments: [{
            filename:    'novelty-labels-logo.png',
            cid:         LOGO_CID,
            content:     Buffer.from(LOGO_DATA_URI.split(',')[1], 'base64'),
            contentType: 'image/png',
          }],
        }
      : {}),
  });
  return { id: info.messageId };
}
