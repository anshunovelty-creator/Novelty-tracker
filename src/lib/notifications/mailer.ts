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
}): Promise<{ id?: string }> {
  const info = await getTransporter().sendMail({
    from:    `"Novelty Labels & Supplies" <${process.env.GMAIL_USER}>`,
    to:      opts.to,
    subject: opts.subject,
    html:    opts.html,
  });
  return { id: info.messageId };
}
