import nodemailer from 'nodemailer';

let testTransport;
export function setMailTransport(transport) { testTransport = transport; }

export function mailConfigured() {
  const provider = process.env.MAIL_PROVIDER || 'none';
  if (provider === 'none') return false;
  if (provider !== 'smtp') throw new Error('MAIL_PROVIDER는 none 또는 smtp여야 합니다.');
  return Boolean(process.env.SMTP_HOST && process.env.MAIL_FROM);
}

function transport() {
  if (testTransport) return testTransport;
  if (!mailConfigured()) return null;
  const port = Number(process.env.SMTP_PORT || 587);
  return nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port,
    secure: process.env.SMTP_SECURE === 'true' || port === 465,
    auth: process.env.SMTP_USER ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASSWORD || '' } : undefined,
  });
}

export async function sendMail({ to, subject, text, html }) {
  const sender = transport();
  if (!sender) return { sent: false, reason: 'not_configured' };
  await sender.sendMail({ from: process.env.MAIL_FROM || 'test@localhost', to, subject, text, html });
  return { sent: true };
}
